import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, FolderOpen, RefreshCw } from "lucide-react";
import { isFinished } from "../audio/logic";
import type { Progress, Track } from "../lib/api";
import { useApp } from "../store";
import { IconButton } from "./ui";

export function Library() {
  const folder = useApp((s) => s.folder)!;
  const chooseFolder = useApp((s) => s.chooseFolder);
  const rescan = useApp((s) => s.rescan);
  const [scanning, setScanning] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const t of folder.tracks) {
      const list = map.get(t.relDir) ?? [];
      list.push(t);
      map.set(t.relDir, list);
    }
    return [...map.entries()];
  }, [folder]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const named = groups.filter(([dir]) => dir);
  const allCollapsed = named.length > 0 && named.every(([dir]) => collapsed.has(dir));
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
    <aside className="flex min-h-0 flex-col border-r border-line bg-sidebar">
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center justify-end gap-0.5 pr-2.5 pl-20">
        {named.length > 0 && (
          <IconButton
            title={allCollapsed ? "展开全部" : "折叠全部"}
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(named.map(([d]) => d)))}
          >
            {allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
          </IconButton>
        )}
        <IconButton title="重新扫描" disabled={scanning} onClick={() => void onRescan()}>
          <RefreshCw size={15} className={scanning ? "animate-spin" : ""} />
        </IconButton>
        <IconButton title="打开其他文件夹" onClick={() => void chooseFolder()}>
          <FolderOpen size={15} />
        </IconButton>
      </div>

      <div className="flex items-baseline gap-2 px-4 pb-2" title={folder.root}>
        <h2 className="min-w-0 truncate text-[13px] font-semibold">{folder.name}</h2>
        <span className="tabular shrink-0 text-[11px] text-faint">{folder.tracks.length} 个音频</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {folder.tracks.length === 0 && (
          <div className="mx-3 mt-2 rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
            这个文件夹里没有可播放的音频
            <div className="mt-1 text-[11px] text-faint">支持 mp3、m4a、wav、flac 等格式</div>
          </div>
        )}
        {groups.map(([dir, tracks]) => {
          const open = !collapsed.has(dir);
          return (
            <section key={dir}>
              {dir && (
                <button
                  onClick={() => toggle(dir)}
                  aria-expanded={open}
                  title={dir}
                  className="sticky top-0 z-10 flex w-full items-center gap-1 bg-sidebar px-3 pt-3 pb-1 text-left text-[11px] font-semibold text-faint transition-colors hover:text-muted"
                >
                  <ChevronRight size={12} className={`shrink-0 transition-transform duration-200 ease-snappy ${open ? "rotate-90" : ""}`} />
                  <span className="min-w-0 flex-1 truncate">{dir}</span>
                  <span className="tabular shrink-0 font-medium">{tracks.length}</span>
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
                  {tracks.map((t) => (
                    <TrackRow key={t.path} track={t} />
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
      className={`mx-2 my-px flex h-8 w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition-[background-color,color] duration-150 ${
        active ? "bg-accent-soft font-medium text-accent-text" : "hover:bg-hover active:bg-press"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{track.name}</span>
      {active ? <NowPlayingBars paused={!playing} /> : <ProgressMark progress={progress} />}
    </button>
  );
}

function NowPlayingBars({ paused }: { paused: boolean }) {
  return (
    <span className="eq shrink-0 animate-fade" data-paused={paused || undefined} aria-label={paused ? "已暂停" : "正在播放"}>
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
      <span title="已听完" className="shrink-0 text-faint">
        <Check size={13} strokeWidth={2.5} />
      </span>
    );
  }
  const ratio = progress.position / progress.duration;
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 -rotate-90 text-faint" aria-label={`已听 ${Math.round(ratio * 100)}%`}>
      <title>{`已听 ${Math.round(ratio * 100)}%`}</title>
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth="2" />
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} strokeLinecap="round" />
    </svg>
  );
}
