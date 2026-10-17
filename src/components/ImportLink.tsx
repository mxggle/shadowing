import { Link2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Resolved } from "../lib/api";
import { languageName, percent, pickSubtitle, progressText } from "../lib/imports";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { Button, fieldClass, IconButton, Kbd, TextLink } from "./ui";

/** In the sidebar header once a plugin can import links. */
export function ImportButton() {
  const can = useApp((s) => s.plugins.some((p) => p.importers.length > 0 && !p.problem));
  const open = useApp((s) => s.openImport);
  if (!can) return null;
  return (
    <IconButton title="从链接导入 (⌘V)" onClick={() => void open()}>
      <Link2 />
    </IconButton>
  );
}

function Bar({ done, total }: { done: number; total: number }) {
  const p = percent(done, total);
  return (
    <div className="h-1 overflow-hidden rounded-full bg-track">
      <div
        className={`h-full rounded-full bg-played transition-[width] duration-300 ${p === null ? "w-1/3 animate-pulse" : ""}`}
        style={p === null ? undefined : { width: `${Math.max(2, p)}%` }}
      />
    </div>
  );
}

/** Top of the track list: the download going on, or how it ended. */
export function ImportRow() {
  const job = useApp((s) => s.importJob);
  const tracks = useApp((s) => s.folder?.tracks);
  if (!job || job.state === "resolving" || job.state === "cancelled") return null;
  const s = useApp.getState();
  const track = job.state === "done" ? tracks?.find((t) => t.path === job.path) : undefined;
  return (
    <div className="mx-3 mb-2 rounded-[10px] bg-fill px-3 py-2.5 text-[12px]">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate font-script text-[13px] text-fg" title={job.title}>
          {job.title}
        </p>
        <button
          className="-mt-0.5 -mr-1 shrink-0 rounded-[6px] p-0.5 text-faint hover:bg-hover hover:text-fg"
          title={job.state === "downloading" ? "取消导入" : "关闭"}
          onClick={() => (job.state === "downloading" ? s.cancelImport() : s.dismissImport())}
        >
          <X size={14} />
        </button>
      </div>
      {job.state === "downloading" && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <Bar done={job.done} total={job.total} />
          <p className="tabular font-mono text-[11px] text-muted">{progressText(job.message, job.done, job.total)}</p>
        </div>
      )}
      {job.state === "done" && (
        <div className="mt-1 flex items-center gap-2 text-muted">
          <span className="min-w-0 flex-1">{job.subtitles ? "已导入，带字幕" : "已导入"}</span>
          {track && (
            <TextLink
              className="text-[12px]"
              onClick={() => {
                s.open(track);
                s.dismissImport();
              }}
            >
              打开
            </TextLink>
          )}
        </div>
      )}
      {job.state === "failed" && (
        <div className="mt-1 flex flex-col items-start gap-1">
          <p className="leading-relaxed text-danger">{job.message}</p>
          <TextLink className="text-[12px]" onClick={() => void s.openImport(s.importUrl)}>
            再试一次
          </TextLink>
        </div>
      )}
    </div>
  );
}

/** 从链接导入: paste a link, see what it is, choose subtitles and where it goes, download. */
export function ImportDialog() {
  const link = useApp((s) => s.linkImport);
  const close = useApp((s) => s.closeImport);

  useEffect(() => {
    if (!link) return;
    // Capture phase: Esc closes the sheet instead of also clearing the loop.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [link, close]);

  if (!link) return null;
  return (
    <div
      className="fixed inset-0 z-30 flex animate-fade justify-center bg-black/25 px-6 pt-[7vh] pb-6 dark:bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        className="flex max-h-full w-full max-w-[500px] animate-pop-in flex-col self-start overflow-hidden rounded-[16px] bg-raised shadow-lift"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-2.5 pl-6">
          <h2 id="import-title" className="text-[14px] font-semibold">
            从链接导入
          </h2>
          <IconButton title="关闭 (Esc)" onClick={close}>
            <X />
          </IconButton>
        </header>
        <div className="scrollbar-none overflow-y-auto px-6 pt-5 pb-6">
          <UrlField key={link.url} url={link.url} busy={link.resolving} />
          {link.resolving && (
            <div className="mt-4 flex flex-col gap-1.5">
              <Bar done={link.progress?.done ?? 0} total={link.progress?.total ?? 0} />
              <p className="tabular font-mono text-[11px] text-muted">
                {link.progress ? progressText(link.progress.message, link.progress.done, link.progress.total) : "读取中…"}
              </p>
            </div>
          )}
          {link.error && <Problem message={link.error} />}
          {link.resolved && <Confirm resolved={link.resolved} />}
          {!link.url && !link.resolving && (
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              在别处复制了链接后，也可以在应用里直接按 <Kbd>⌘V</Kbd>。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function UrlField({ url, busy }: { url: string; busy: boolean }) {
  const [text, setText] = useState(url);
  const resolve = useApp((s) => s.resolveImport);
  const go = () => text.trim() && text.trim() !== url && void resolve(text);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <input
        className={fieldClass}
        value={text}
        autoFocus={!url}
        placeholder="粘贴 YouTube 链接"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" disabled={busy || !text.trim() || text.trim() === url}>
        读取
      </Button>
    </form>
  );
}

function Problem({ message }: { message: string }) {
  const openSettings = () => {
    useApp.getState().closeImport();
    useApp.getState().setSettingsOpen(true);
  };
  return (
    <div className="mt-4 flex flex-col items-start gap-1.5">
      <p className="text-[13px] leading-relaxed text-danger">{message}</p>
      {message.includes("设置 → 插件") && (
        <TextLink className="text-[12px]" onClick={openSettings}>
          打开设置
        </TextLink>
      )}
    </div>
  );
}

function Confirm({ resolved }: { resolved: Resolved }) {
  const folder = useApp((s) => s.folder);
  const learning = useApp((s) => s.guide.language);
  const start = useApp((s) => s.startImport);
  const chooseFolder = useApp((s) => s.chooseFolder);
  const [subtitles, setSubtitles] = useState(() => pickSubtitle(resolved.subtitles, resolved.language, learning) ?? "");
  const [sub, setSub] = useState(resolved.via);
  const [busy, setBusy] = useState(false);
  const meta = [resolved.uploader, resolved.duration ? formatTime(resolved.duration) : null, resolved.via].filter(Boolean);

  const go = async () => {
    setBusy(true);
    await start(subtitles || null, sub);
    setBusy(false);
  };

  return (
    <div className="mt-5">
      <h3 className="font-script text-[16px] leading-snug">{resolved.title}</h3>
      <p className="mt-1 text-[12px] text-muted">
        {meta.map((m, i) => (
          <span key={i} className={i === 1 ? "tabular font-mono" : undefined}>
            {i > 0 && " · "}
            {m}
          </span>
        ))}
      </p>

      <div className="mt-5 flex flex-col gap-3 text-[13px]">
        <label className="flex items-center gap-3">
          <span className="w-12 shrink-0 text-muted">字幕</span>
          {resolved.subtitles.length > 0 ? (
            <select className={fieldClass} value={subtitles} onChange={(e) => setSubtitles(e.target.value)}>
              <option value="">不要字幕</option>
              {resolved.subtitles.map((s) => (
                <option key={s.lang} value={s.lang}>
                  {languageName(s.lang, s.name)}（人工字幕）
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[12px] leading-relaxed text-muted">没有人工字幕，导入后可以用转写生成。</span>
          )}
        </label>
        {folder && (
          <label className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-muted">存到</span>
            <span className="max-w-[40%] shrink-0 truncate text-[12px] text-faint" title={folder.root}>
              {folder.name} /
            </span>
            <input className={fieldClass} value={sub} placeholder="直接放在文件夹里" spellCheck={false} onChange={(e) => setSub(e.target.value)} />
          </label>
        )}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-faint">
        下载原始的 m4a 音轨，不转码。字幕断句不好时，可以移除后改用转写。只下载你有权使用的内容。
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={() => useApp.getState().closeImport()}>取消</Button>
        {folder ? (
          <Button primary disabled={busy} onClick={() => void go()}>
            下载
          </Button>
        ) : (
          <Button primary onClick={() => void chooseFolder()}>
            先打开一个文件夹
          </Button>
        )}
      </div>
    </div>
  );
}
