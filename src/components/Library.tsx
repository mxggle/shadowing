import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FolderOpen, RefreshCw } from "lucide-react";
import { isFinished } from "../audio/logic";
import type { Progress, Track } from "../lib/api";
import { useApp } from "../store";

export function Library() {
  const folder = useApp((s) => s.folder)!;
  const chooseFolder = useApp((s) => s.chooseFolder);
  const rescan = useApp((s) => s.rescan);

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

  return (
    <aside className="flex min-h-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center justify-end gap-1 pl-20 pr-2">
        {named.length > 0 && (
          <IconButton
            title={allCollapsed ? "展开全部" : "折叠全部"}
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(named.map(([d]) => d)))}
          >
            {allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
          </IconButton>
        )}
        <IconButton title="重新扫描" onClick={() => void rescan()}>
          <RefreshCw size={15} />
        </IconButton>
        <IconButton title="打开其他文件夹" onClick={() => void chooseFolder()}>
          <FolderOpen size={15} />
        </IconButton>
      </div>
      <div className="truncate px-4 pb-2 text-xs font-semibold text-zinc-500" title={folder.root}>
        {folder.name} · {folder.tracks.length}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {folder.tracks.length === 0 && (
          <p className="px-4 py-6 text-sm text-zinc-500">这个文件夹里没有可播放的音频。</p>
        )}
        {groups.map(([dir, tracks]) => (
          <section key={dir}>
            {dir && (
              <button
                onClick={() => toggle(dir)}
                className="sticky top-0 flex w-full items-center gap-1 bg-zinc-50 px-3 pb-1 pt-2 text-left text-[11px] font-medium text-zinc-400 hover:text-zinc-600 dark:bg-zinc-950 dark:hover:text-zinc-300"
                title={dir}
              >
                {collapsed.has(dir) ? <ChevronRight size={12} className="shrink-0" /> : <ChevronDown size={12} className="shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{dir}</span>
                <span className="tabular shrink-0">{tracks.length}</span>
              </button>
            )}
            {!collapsed.has(dir) && tracks.map((t) => <TrackRow key={t.path} track={t} />)}
          </section>
        ))}
      </div>
    </aside>
  );
}

function TrackRow({ track }: { track: Track }) {
  const active = useApp((s) => s.current?.path === track.path);
  const progress = useApp((s) => s.progress[track.path]);
  const open = useApp((s) => s.open);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <button
      ref={ref}
      onClick={() => open(track)}
      className={`mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${
        active
          ? "bg-accent-soft font-medium text-accent"
          : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
      }`}
      title={track.name}
    >
      <span className="min-w-0 flex-1 truncate">{track.name}</span>
      <ProgressMark progress={progress} />
    </button>
  );
}

function ProgressMark({ progress }: { progress: Progress | undefined }) {
  if (!progress || progress.duration <= 0 || progress.position < 1) return null;
  if (isFinished(progress)) return <Check size={13} className="shrink-0 text-zinc-400" />;
  const pct = Math.round((progress.position / progress.duration) * 100);
  return <span className="tabular shrink-0 text-[11px] text-zinc-400">{pct}%</span>;
}

export function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  const { active, className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-800 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${
        active ? "bg-accent-soft text-accent" : ""
      } ${className}`}
    />
  );
}
