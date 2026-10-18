import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, FolderOpen, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { isFinished } from "../audio/logic";
import type { FolderListing, Progress, Track } from "../lib/api";
import { t } from "../lib/i18n";
import { placeDownloads } from "../lib/imports";
import { useApp } from "../store";
import { AddMenu } from "./AddMenu";
import { DownloadRow } from "./ImportLink";
import { Button, IconButton } from "./ui";

/** Shows or hides the sidebar; lives in the sidebar header while open and in the top bar once it is closed. */
export function ShelfToggle() {
  const open = useApp((s) => s.shelfOpen);
  const toggle = useApp((s) => s.toggleShelf);
  return (
    <IconButton title={open ? t("收起左侧列表 (⌘B)") : t("展开左侧列表 (⌘B)")} aria-expanded={open} onClick={toggle}>
      {open ? <PanelLeftClose /> : <PanelLeftOpen />}
    </IconButton>
  );
}

export function Library() {
  const folder = useApp((s) => s.folder);
  return folder ? <FolderView folder={folder} /> : <NoFolder />;
}

/** While practising on the sample before any folder is open. */
function NoFolder() {
  const chooseFolder = useApp((s) => s.chooseFolder);
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-line bg-shelf">
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center justify-end pr-2.5 pl-20">
        <ShelfToggle />
      </div>
      <div className="flex flex-col items-start gap-3 px-5 pt-3">
        <p className="text-[13px] leading-relaxed text-muted">
          {t("你的音频会列在这里。")}
          <br />
          {t("选一个放着 mp3、m4a 的文件夹。")}
        </p>
        <Button onClick={() => void chooseFolder()}>
          <FolderOpen size={15} strokeWidth={1.8} /> {t("打开文件夹")}
        </Button>
      </div>
    </aside>
  );
}

function FolderView({ folder }: { folder: FolderListing }) {
  const rescan = useApp((s) => s.rescan);
  const downloads = useApp((s) => s.downloads);
  const [scanning, setScanning] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const track of folder.tracks) {
      const list = map.get(track.relDir) ?? [];
      list.push(track);
      map.set(track.relDir, list);
    }
    // Links being downloaded show in the group they land in (a new one for a new folder).
    return placeDownloads([...map.entries()], downloads);
  }, [folder, downloads]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const named = groups.filter((g) => g.dir);
  const allCollapsed = named.length > 0 && named.every((g) => collapsed.has(g.dir));
  const toggle = (dir: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(dir)) next.add(dir);
      return next;
    });

  const onRescan = async () => {
    setScanning(true);
    // Keep the spin visible long enough to read as "done", even for a fast scan.
    await Promise.all([rescan(), new Promise((r) => setTimeout(r, 500))]).finally(() => setScanning(false));
  };

  return (
    <aside className="group/shelf flex h-full min-h-0 flex-col border-r border-line bg-shelf">
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center justify-end gap-0.5 pr-2.5 pl-20">
        <ShelfToggle />
        {named.length > 0 && (
          <IconButton
            title={allCollapsed ? t("展开全部") : t("折叠全部")}
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(named.map((g) => g.dir)))}
          >
            {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
          </IconButton>
        )}
        <IconButton title={t("重新扫描")} disabled={scanning} onClick={() => void onRescan()}>
          <RefreshCw className={scanning ? "animate-spin" : ""} />
        </IconButton>
        <AddMenu />
      </div>

      <div className="flex items-baseline gap-2 px-5 pb-2" title={folder.root}>
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.005em]">{folder.name}</h2>
        <span className="tabular shrink-0 font-mono text-[11px] text-faint">{folder.tracks.length}</span>
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]">
        {folder.tracks.length === 0 && downloads.length === 0 && (
          <div className="px-5 pt-2 text-[13px] leading-relaxed text-muted">
            {t("这个文件夹里没有可播放的音频。")}
            <div className="mt-1 text-[12px] text-faint">{t("支持 mp3、m4a、wav、flac 等格式，子文件夹也会扫描。")}</div>
          </div>
        )}
        {groups.map(({ dir, tracks, downloads }) => {
          const open = !collapsed.has(dir);
          return (
            <section key={dir}>
              {dir && (
                <button
                  onClick={() => toggle(dir)}
                  aria-expanded={open}
                  title={dir}
                  className="sticky top-0 z-10 flex w-full items-center gap-1 bg-shelf pt-4 pr-5 pb-1.5 pl-3.5 text-left text-[12px] font-medium text-faint transition-colors hover:text-muted"
                >
                  <ChevronRight size={12} strokeWidth={2.2} className={`shrink-0 transition-transform duration-200 ease-snappy ${open ? "rotate-90" : ""}`} />
                  <span className="min-w-0 flex-1 truncate">{dir}</span>
                  {tracks.length > 0 && <span className="tabular shrink-0 font-mono text-[11px] font-normal">{tracks.length}</span>}
                </button>
              )}
              {/* 0fr ↔ 1fr animates the group open/closed without measuring heights. */}
              <div
                inert={!open}
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-snappy ${
                  open ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  {tracks.map((track) => (
                    <TrackRow key={track.path} track={track} />
                  ))}
                  {downloads.map((d) => (
                    <DownloadRow key={d.id} download={d} />
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function TrackRow({ track }: { track: Track }) {
  const active = useApp((s) => s.current?.path === track.path);
  const playing = useApp((s) => active && s.playing);
  const progress = useApp((s) => s.progress[track.path]);
  const open = useApp((s) => s.open);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <button
      ref={ref}
      onClick={() => open(track)}
      aria-current={active || undefined}
      title={track.name}
      className={`mx-2.5 my-px flex h-[30px] w-[calc(100%-1.25rem)] items-center gap-2 rounded-[8px] pr-2.5 pl-2.5 text-left text-[13px] transition-[background-color,box-shadow,color] duration-150 ${
        active ? "bg-press font-medium text-fg" : "text-fg/80 hover:bg-hover hover:text-fg active:bg-press"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{track.name}</span>
      {active ? <NowPlayingBars paused={!playing} /> : <ProgressMark progress={progress} />}
    </button>
  );
}

function NowPlayingBars({ paused }: { paused: boolean }) {
  return (
    <span className="eq mr-0.5 shrink-0 animate-fade text-fg" data-paused={paused || undefined} aria-label={paused ? t("已暂停") : t("正在播放")}>
      <span />
      <span />
      <span />
    </span>
  );
}

/** Small ring that fills as you listen; a check once finished. */
function ProgressMark({ progress }: { progress: Progress | undefined }) {
  if (!progress || progress.duration <= 0 || progress.position < 1) return null;
  if (isFinished(progress)) {
    return (
      <span title={t("已听完")} className="shrink-0 text-faint">
        <Check size={13} strokeWidth={2.4} />
      </span>
    );
  }
  const ratio = progress.position / progress.duration;
  // A pie rather than a ring: at this size a filled wedge reads at a glance.
  const r = 5.5;
  const angle = ratio * 2 * Math.PI;
  const x = (7 + r * Math.sin(angle)).toFixed(2);
  const y = (7 - r * Math.cos(angle)).toFixed(2);
  const wedge = `M7 7V1.5A${r} ${r} 0 ${angle > Math.PI ? 1 : 0} 1 ${x} ${y}Z`;
  const heard = t("已听 {percent}%", { percent: Math.round(ratio * 100) });
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-faint" aria-label={heard}>
      <title>{heard}</title>
      <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth="1.25" />
      <path d={wedge} fill="currentColor" fillOpacity={0.75} />
    </svg>
  );
}
