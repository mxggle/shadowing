import { AlertCircle, Columns2, Maximize2, Rows2 } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { useStageWide } from "../hooks/useStageWide";
import { mediaUrl, type PictureLayout } from "../lib/api";
import { t, tk } from "../lib/i18n";
import { layoutShown } from "../lib/picture";
import { nextLead, soundJumped, syncPicture, type Playhead } from "../lib/videoSync";
import { playhead, useApp } from "../store";
import { PICTURE_MAX, PICTURE_MIN } from "../videoSlice";
import { PictureMask } from "./PictureMask";
import { useKeys } from "../hooks/useKeys";

/** Above the sentences, the picture never takes more than this much of the window, so they keep room. */
const MOST_OF_WINDOW = "50vh";
const KEY_STEP = 20;
/** A guess at how long a jump takes, until the first one is timed. */
const FIRST_LEAD = 0.15;

/** How the box around the picture and the picture itself are sized in each layout. */
const FRAME: Record<PictureLayout, { wrap: string; video: string }> = {
  stack: { wrap: "h-full w-fit max-w-full", video: "h-full max-w-full" },
  side: { wrap: "w-full", video: "block max-h-[60vh] w-full" },
  theater: { wrap: "h-full w-fit max-w-full", video: "h-full max-w-full" },
};

/**
 * A video's picture. The engine plays the sound (speed, loops, recording all happen
 * there); this muted <video> follows it, checked 20 times a second (lib/videoSync.ts).
 * It has no controls of its own: the deck has them all, and a click plays or pauses.
 */
export function Picture({ layout }: { layout: PictureLayout }) {
  const path = useApp((s) => (s.current?.kind === "video" && !s.settings.pictureHidden ? s.current.path : null));
  return path ? <Screen key={path} path={path} layout={layout} /> : null;
}

function Screen({ path, layout }: { path: string; layout: PictureLayout }) {
  const key = useKeys();
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const height = useApp((s) => s.settings.pictureHeight);
  const look = useApp((s) => s.pictureLook);
  const setLook = useApp((s) => s.setPictureLook);
  useFollow(video);
  useNoSound(video);

  // "none": the file has only sound (an mp4 can), so it shows as audio does.
  if (look === "none") return null;
  if (look === "failed") {
    return (
      <div className={layout === "stack" ? "mx-auto w-full max-w-[760px] shrink-0 px-10 pt-3" : "w-full shrink-0 pt-3"}>
        <p className="tint flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] text-muted">
          <AlertCircle size={14} className="shrink-0" />
          {t("这个视频的画面放不了，只放声音。")}
        </p>
      </div>
    );
  }
  const frame = (
    <div className={`group relative ${FRAME[layout].wrap}`}>
      <video
        ref={video}
        src={mediaUrl(path)}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        aria-label={t("视频画面")}
        title={t("播放 / 暂停 ({key})", { key: key("toggle") })}
        onClick={() => useApp.getState().toggle()}
        onLoadedMetadata={(e) => setLook(e.currentTarget.videoWidth > 0 ? "shown" : "none")}
        onError={() => setLook("failed")}
        className={`${FRAME[layout].video} rounded-[12px] bg-black object-contain transition-opacity duration-200 ${look === "shown" ? "opacity-100" : "opacity-0"}`}
      />
      <PictureMask video={video} />
      <LayoutButtons />
    </div>
  );
  if (layout === "side") return <div className="w-full shrink-0 pt-3">{frame}</div>;
  if (layout === "theater") return <div className="flex h-full min-h-0 w-full justify-center">{frame}</div>;
  return (
    <div className="mx-auto w-full max-w-[760px] shrink-0 px-10 pt-3">
      <div ref={box} className="flex justify-center" style={{ height: `min(${height}px, ${MOST_OF_WINDOW})` }}>
        {frame}
      </div>
      <Resizer box={box} />
    </div>
  );
}

/**
 * WebKit keeps a muted video's own sound track running, and after every jump its
 * picture froze for half a second to line up with it again (jumps took 0.1–0.35 s
 * instead of 0.05). The engine plays the sound; the picture needs none of it.
 * (WebView2 doesn't list audio tracks: nothing to do there.)
 */
function useNoSound(ref: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const tracks = (ref.current as (HTMLVideoElement & { audioTracks?: AudioTrackList }) | null)?.audioTracks;
    if (!tracks) return;
    // Tracks are listed as the file is read, after the element exists.
    const off = () => {
      for (let i = 0; i < tracks.length; i++) tracks[i].enabled = false;
    };
    off();
    tracks.addEventListener("addtrack", off);
    tracks.addEventListener("change", off);
    return () => {
      tracks.removeEventListener("addtrack", off);
      tracks.removeEventListener("change", off);
    };
  }, [ref]);
}

interface AudioTrackList extends EventTarget {
  length: number;
  [i: number]: { enabled: boolean };
}

/** How often the picture is checked against the sound. */
const FOLLOW_MS = 50;

/** Show what the engine is playing (or holding still). */
function useFollow(ref: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // How far ahead to jump while playing, learnt from where each jump lands (lib/videoSync.ts).
    let lead = FIRST_LEAD;
    let askedAt: number | null = null;
    let ahead = false;
    let check = false;
    let landedAt = -Infinity;
    // Where the sound was at the last check, to tell when it jumps (a seek, a loop going round).
    let before: { head: Playhead; at: number } | null = null;
    let moved = false;
    const landed = () => {
      askedAt = null;
      landedAt = performance.now();
      check = ahead;
    };
    video.addEventListener("seeked", landed);
    const tick = () => {
      // Nobody sees a covered window's picture: it rests (no decoding while only listening)
      // and catches up the moment it shows again.
      if (document.visibilityState === "hidden") {
        if (!video.paused) video.pause();
        return;
      }
      const head = playhead();
      if (head && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        const now = performance.now();
        if (check && !video.seeking) {
          if (head.playing) lead = nextLead(lead, head.time - video.currentTime);
          check = false;
        }
        if (before && soundJumped(before.head, head, (now - before.at) / 1000)) moved = true;
        before = { head, at: now };
        const since = (t: number | null) => (t === null ? 0 : (now - t) / 1000);
        const state = {
          time: video.currentTime,
          paused: video.paused,
          seeking: video.seeking,
          rate: video.playbackRate,
          duration: video.duration,
          settled: (now - landedAt) / 1000,
          seekingFor: video.seeking ? since(askedAt) : 0,
          soundMoved: moved,
        };
        const act = syncPicture(head, state, lead);
        if (act.rate !== undefined) video.playbackRate = act.rate;
        if (act.seek !== undefined) {
          askedAt = now;
          ahead = head.playing;
          moved = false;
          video.currentTime = act.seek;
        }
        if (act.pause) video.pause();
        if (act.play) void video.play().catch(() => {});
      }
    };
    const timer = window.setInterval(tick, FOLLOW_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      video.removeEventListener("seeked", landed);
    };
  }, [ref]);
}

const LAYOUTS: { value: PictureLayout; icon: typeof Rows2; label: string }[] = [
  { value: "stack", icon: Rows2, label: tk("画面在上") },
  { value: "side", icon: Columns2, label: tk("并排") },
  { value: "theater", icon: Maximize2, label: tk("影院") },
];

/** Over the picture's corner while the pointer is on it: the three layouts (V goes round them too). */
function LayoutButtons() {
  const key = useKeys();
  const wide = useStageWide();
  const shown = useApp((s) => layoutShown(s.settings.pictureLayout, wide));
  const setLayout = useApp((s) => s.setPictureLayout);
  return (
    <div
      role="radiogroup"
      aria-label={t("画面布局")}
      className="absolute top-2.5 right-2.5 flex gap-0.5 rounded-[10px] bg-black/55 p-[3px] text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100"
    >
      {LAYOUTS.map(({ value, icon: Icon, label }) => {
        const narrow = value === "side" && !wide;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={shown === value}
            aria-label={t(label)}
            disabled={narrow}
            title={narrow ? t("{label}（窗口太窄）", { label: t(label) }) : t("{label} ({key})", { label: t(label), key: key("picture") })}
            onClick={() => setLayout(value)}
            className={`grid h-[26px] w-7 place-items-center rounded-[7px] transition-colors duration-150 disabled:opacity-35 ${
              shown === value ? "bg-white/25" : "hover:bg-white/15"
            }`}
          >
            <Icon size={15} strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
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
