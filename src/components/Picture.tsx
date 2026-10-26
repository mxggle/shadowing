import { AlertCircle } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { mediaUrl } from "../lib/api";
import { t } from "../lib/i18n";
import { nextLead, syncPicture } from "../lib/videoSync";
import { playhead, useApp } from "../store";
import { PICTURE_MAX, PICTURE_MIN } from "../videoSlice";
import { Button } from "./ui";

/** The picture never takes more than this much of the window, so the sentences keep room. */
const MOST_OF_WINDOW = "50vh";
const KEY_STEP = 20;
/** A guess at how long a jump takes, until the first one is timed. */
const FIRST_LEAD = 0.15;

/**
 * A video's picture, above the sentences. The engine plays the sound (speed, loops,
 * recording all happen there); this muted <video> follows it, checked 20 times a
 * second (lib/videoSync.ts). It has no controls of its own: the deck has them all.
 */
export function Picture() {
  const path = useApp((s) => (s.current?.kind === "video" ? s.current.path : null));
  return path ? <Screen key={path} path={path} /> : null;
}

function Screen({ path }: { path: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const height = useApp((s) => s.settings.pictureHeight);
  // "none": the file has only sound (an mp4 can), so it shows as audio does.
  const [look, setLook] = useState<"loading" | "shown" | "none" | "failed">("loading");
  useFollow(video);

  if (look === "none") return null;
  if (look === "failed") {
    return (
      <div className="mx-auto w-full max-w-[760px] shrink-0 px-10 pt-3">
        <p className="tint flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] text-muted">
          <AlertCircle size={14} className="shrink-0" />
          {t("这个视频的画面放不了，只放声音。")}
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[760px] shrink-0 px-10 pt-3">
      <div ref={box} className="flex justify-center" style={{ height: `min(${height}px, ${MOST_OF_WINDOW})` }}>
        <video
          ref={video}
          src={mediaUrl(path)}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-label={t("视频画面")}
          title={t("播放 / 暂停 (空格)")}
          onClick={() => useApp.getState().toggle()}
          onLoadedMetadata={(e) => setLook(e.currentTarget.videoWidth > 0 ? "shown" : "none")}
          onError={() => setLook("failed")}
          className={`h-full max-w-full rounded-[12px] bg-black object-contain transition-opacity duration-200 ${look === "shown" ? "opacity-100" : "opacity-0"}`}
        />
      </div>
      <Resizer box={box} />
    </div>
  );
}

/** How often the picture is checked against the sound. A timer, not animation frames:
 * those stop while the window is covered, and the picture should be in step when it shows again. */
const FOLLOW_MS = 50;

/** Show what the engine is playing (or holding still). */
function useFollow(ref: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // How long jumps take here, learnt from each one (lib/videoSync.ts).
    let lead = FIRST_LEAD;
    let askedAt: number | null = null;
    let landedAt = -Infinity;
    let nudgedAt: number | null = null;
    const landed = () => {
      const now = performance.now();
      if (askedAt !== null) lead = nextLead(lead, (now - askedAt) / 1000);
      askedAt = null;
      landedAt = now;
    };
    video.addEventListener("seeked", landed);
    const tick = () => {
      const head = playhead();
      if (head && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        const now = performance.now();
        const since = (t: number | null) => (t === null ? 0 : (now - t) / 1000);
        const state = {
          time: video.currentTime,
          paused: video.paused,
          seeking: video.seeking,
          rate: video.playbackRate,
          duration: video.duration,
          settled: (now - landedAt) / 1000,
          seekingFor: video.seeking ? since(askedAt) : 0,
          nudgedFor: since(nudgedAt),
        };
        const act = syncPicture(head, state, lead);
        if (act.rate !== undefined) {
          video.playbackRate = act.rate;
          nudgedAt = act.rate === head.rate ? null : now;
        }
        if (act.seek !== undefined) {
          askedAt = now;
          video.currentTime = act.seek;
        }
        if (act.pause) video.pause();
        if (act.play) void video.play().catch(() => {});
      }
    };
    const timer = window.setInterval(tick, FOLLOW_MS);
    return () => {
      window.clearInterval(timer);
      video.removeEventListener("seeked", landed);
    };
  }, [ref]);
}

/** The bar under the picture: drag it (or ↑ ↓ once it has focus) to make the picture taller or shorter. */
function Resizer({ box }: { box: RefObject<HTMLDivElement | null> }) {
  const height = useApp((s) => s.settings.pictureHeight);
  const setHeight = useApp((s) => s.setPictureHeight);
  const drag = useRef<{ y: number; from: number } | null>(null);
  // From the height shown, which the window may have made smaller than the one kept.
  const shown = () => box.current?.getBoundingClientRect().height ?? height;
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("画面高度")}
      aria-valuemin={PICTURE_MIN}
      aria-valuemax={PICTURE_MAX}
      aria-valuenow={Math.round(height)}
      tabIndex={0}
      title={t("拖动调整画面大小")}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, from: shown() };
      }}
      onPointerMove={(e) => drag.current && setHeight(drag.current.from + e.clientY - drag.current.y)}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        // Not the global ↑ ↓ (previous / next track) while the bar has focus.
        e.preventDefault();
        e.stopPropagation();
        setHeight(shown() + (e.key === "ArrowDown" ? KEY_STEP : -KEY_STEP));
      }}
      className="group flex h-4 cursor-row-resize touch-none items-center justify-center rounded-full"
    >
      <span className="h-1 w-9 rounded-full bg-track transition-colors duration-150 group-hover:bg-line-strong" />
    </div>
  );
}

/** A WebM or MKV from the list: why it can't play, and what to do instead. */
export function Unsupported() {
  const track = useApp((s) => s.current)!;
  const format = (track.path.split(".").pop() ?? "").toUpperCase();
  return (
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div key={track.path} className="mx-auto w-full max-w-[760px] animate-fade-in px-10 pt-1 pb-10">
        <h1 className="line-clamp-2 font-script text-[28px] leading-[1.22] font-semibold tracking-[-0.012em] break-words text-balance">{track.name}</h1>
        <p className="mt-1 text-[12px] text-faint">{t("{format} 视频", { format })}</p>
        <section className="mt-8 flex max-w-[520px] flex-col gap-3 rounded-[12px] px-5 py-4 ring-1 ring-line">
          <h2 className="flex items-center gap-2 font-heading text-[17px] font-semibold">
            <AlertCircle size={17} className="shrink-0 text-warn" />
            {t("这个视频放不了")}
          </h2>
          <p className="text-[14px] leading-relaxed text-muted">
            {t("这种视频里的声音多半是 Opus 格式，应用的播放器还解不了。能放的视频是 mp4、m4v、mov（画面 H.264，声音 AAC）。")}
          </p>
          <ul className="list-disc pl-[18px] text-[13px] leading-[1.8] text-muted">
            <li>{t("从 YouTube 下载的：可以用「从链接导入」重新下载它的声音。")}</li>
            <li>{t("或者用 HandBrake 之类的工具转成 mp4，放进这个文件夹再打开。")}</li>
          </ul>
          <div>
            <Button onClick={() => void useApp.getState().openImport()}>{t("从链接导入…")}</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
