import { AlertCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Resolved } from "../lib/api";
import { t } from "../lib/i18n";
import { downloadLine, languageName, percent, pickSubtitle, progressText, type Download } from "../lib/imports";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { Button, fieldClass, IconButton, Kbd, TextLink } from "./ui";

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

/**
 * A link downloading, waiting its turn or failed, in the folder group it lands
 * in. Once in the folder it gives way to the track itself.
 */
export function DownloadRow({ download: d }: { download: Download }) {
  const drop = useApp((s) => s.dropDownload);
  const retry = useApp((s) => s.retryDownload);
  const failed = d.state === "failed";
  return (
    <div title={d.url} className="group/dl mx-2.5 my-px flex w-[calc(100%-1.25rem)] items-start gap-2 rounded-[8px] px-2.5 py-1.5 text-[13px]">
      <DownloadMark download={d} />
      <div className="min-w-0 flex-1">
        <p className={`truncate leading-[18px] ${d.state === "downloading" ? "text-fg" : "text-fg/80"}`}>{d.title}</p>
        <p className={`text-[11px] leading-4 ${failed ? "text-danger" : "tabular font-mono text-faint"}`}>{downloadLine(d)}</p>
        {failed && (
          <span className="mt-0.5 flex gap-3">
            <TextLink className="text-[11px]" onClick={() => retry(d.id)}>
              {t("再试一次", "Try Again")}
            </TextLink>
            <TextLink className="text-[11px]" onClick={() => drop(d.id)}>
              {t("不要了", "Never Mind")}
            </TextLink>
          </span>
        )}
      </div>
      {!failed && d.state !== "finishing" && (
        <button
          title={d.state === "downloading" ? t("取消下载", "Cancel Download") : t("不下载了", "Remove from Queue")}
          onClick={() => drop(d.id)}
          className="-mr-1 grid size-[18px] shrink-0 place-items-center rounded-[5px] text-faint opacity-0 transition-opacity duration-150 group-hover/dl:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
        >
          <X size={12} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

/** A ring that fills as the download goes (spinning while the size isn't known); dashed while waiting. */
function DownloadMark({ download: d }: { download: Download }) {
  if (d.state === "failed") return <AlertCircle size={16} strokeWidth={2} className="mt-px shrink-0 text-danger" aria-hidden />;
  const r = 6.5;
  const around = 2 * Math.PI * r;
  const p = d.state === "finishing" ? 100 : percent(d.done, d.total);
  const spinning = d.state === "downloading" && p === null;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className={`mt-px shrink-0 ${spinning ? "animate-spin" : ""}`}>
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--track)" strokeWidth="2" strokeDasharray={d.state === "queued" ? "2.5 2.5" : undefined} />
      {d.state !== "queued" && (
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${((spinning ? 25 : (p ?? 0)) / 100) * around} ${around}`}
          transform="rotate(-90 8 8)"
          className="text-fg transition-[stroke-dasharray] duration-300"
        />
      )}
    </svg>
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
            {t("从链接导入", "Import from Link")}
          </h2>
          <IconButton title={t("关闭 (Esc)", "Close (Esc)")} onClick={close}>
            <X />
          </IconButton>
        </header>
        <div className="scrollbar-none overflow-y-auto px-6 pt-5 pb-6">
          <UrlField key={link.url} url={link.url} busy={link.resolving} />
          {link.resolving && (
            <div className="mt-4 flex flex-col gap-1.5">
              <Bar done={link.progress?.done ?? 0} total={link.progress?.total ?? 0} />
              <p className="tabular font-mono text-[11px] text-muted">
                {link.progress ? progressText(link.progress.message, link.progress.done, link.progress.total) : t("读取中…", "Loading…")}
              </p>
            </div>
          )}
          {link.error && <Problem message={link.error} />}
          {link.resolved && <Confirm resolved={link.resolved} />}
          {!link.url && !link.resolving && (
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              {t(
                <>在别处复制了链接后，也可以在应用里直接按 <Kbd>⌘V</Kbd>。</>,
                <>Or copy a link elsewhere, then press <Kbd>⌘V</Kbd> in the app.</>,
              )}
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
        placeholder={t("粘贴 YouTube 链接", "Paste a YouTube link")}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" disabled={busy || !text.trim() || text.trim() === url}>
        {t("读取", "Load")}
      </Button>
    </form>
  );
}

function Problem({ message }: { message: string }) {
  const openSettings = () => useApp.getState().showPlugins();
  return (
    <div className="mt-4 flex flex-col items-start gap-1.5">
      <p className="text-[13px] leading-relaxed text-danger">{message}</p>
      {/* The plugin message from Rust, in either language. */}
      {(message.includes("设置 → 插件") || message.includes("Settings → Plugins")) && (
        <TextLink className="text-[12px]" onClick={openSettings}>
          {t("打开设置", "Open Settings")}
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
  const meta = [resolved.uploader, resolved.duration ? formatTime(resolved.duration) : null, resolved.via].filter(Boolean);


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
          <span className="w-16 shrink-0 text-muted">{t("字幕", "Subtitles")}</span>
          {resolved.subtitles.length > 0 ? (
            <select className={fieldClass} value={subtitles} onChange={(e) => setSubtitles(e.target.value)}>
              <option value="">{t("不要字幕", "No subtitles")}</option>
              {resolved.subtitles.map((s) => (
                <option key={s.lang} value={s.lang}>
                  {languageName(s.lang, s.name)}
                  {t("（人工字幕）", " (manual)")}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[12px] leading-relaxed text-muted">{t("没有人工字幕，导入后可以用转写生成。", "No manual subtitles. Transcribe after importing.")}</span>
          )}
        </label>
        {folder && (
          <label className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-muted">{t("存到", "Save to")}</span>
            <span className="max-w-[40%] shrink-0 truncate text-[12px] text-faint" title={folder.root}>
              {folder.name} /
            </span>
            <input
              className={fieldClass}
              value={sub}
              placeholder={t("直接放在文件夹里", "Directly in the folder")}
              spellCheck={false}
              onChange={(e) => setSub(e.target.value)}
            />
          </label>
        )}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-faint">
        {t(
          "下载原始的 m4a 音轨，不转码。字幕断句不好时，可以移除后改用转写。只下载你有权使用的内容。",
          "Downloads the original m4a track, not converted. If the subtitle line breaks are poor, remove them and transcribe instead. Only download content you’re allowed to use.",
        )}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={() => useApp.getState().closeImport()}>{t("取消", "Cancel")}</Button>
        {folder ? (
          <Button primary onClick={() => start(subtitles || null, sub)}>
            {t("下载", "Download")}
          </Button>
        ) : (
          <Button primary onClick={() => void chooseFolder()}>
            {t("先打开一个文件夹", "Open a Folder First")}
          </Button>
        )}
      </div>
    </div>
  );
}
