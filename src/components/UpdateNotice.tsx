import { X } from "lucide-react";
import { highlightsSince } from "../lib/changelog";
import { t } from "../lib/i18n";
import { noteLines, percent } from "../lib/update";
import { releases } from "../releases";
import { useApp } from "../store";
import type { UpdateStatus } from "../updateSlice";
import { Button, IconButton } from "./ui";

/** Floating card under the top bar: a newer version, its download, the answer to 检查更新…, or what an update just brought. */
export function UpdateNotice() {
  const update = useApp((s) => s.update);
  const shown = useApp((s) => s.updateNotice) && update.state !== "idle";
  const updatedTo = useApp((s) => s.updatedTo);
  if (!shown && !updatedTo) return null;
  const { dismissUpdate, dismissUpdated } = useApp.getState();
  return (
    <div
      role="status"
      className="fixed top-[56px] right-3 z-20 w-[300px] animate-pop-in rounded-[12px] bg-raised p-4 text-[13px] shadow-lift"
    >
      {update.state !== "installing" && (
        <IconButton title={t("关闭", "Close")} className="absolute top-2 right-2" onClick={shown ? dismissUpdate : dismissUpdated}>
          <X />
        </IconButton>
      )}
      {shown ? <UpdateBody update={update} /> : updatedTo && <UpdatedBody version={updatedTo} />}
    </div>
  );
}

/** Once, after an update: what it (and any version skipped on the way) brought, and 新功能 for the whole story. */
function UpdatedBody({ version }: { version: string }) {
  const { dismissUpdated, setNewsOpen } = useApp.getState();
  const points = highlightsSince(releases, useApp.getState().guide.seenVersion, version);
  return (
    <>
      <h3 className="pr-6 font-semibold">
        {t(
          <>已更新到 <span className="font-mono tabular">{version}</span></>,
          <>Updated to <span className="font-mono tabular">{version}</span></>,
        )}
      </h3>
      <ul className="mt-2.5 flex list-disc flex-col gap-1 pl-4 text-[12px] leading-relaxed text-muted">
        {points.slice(0, 4).map((line, i) => (
          <li key={i} className="line-clamp-2">
            {line}
          </li>
        ))}
        {points.length > 4 && <li className="list-none text-faint">{t("……", "…")}</li>}
      </ul>
      <div className="mt-3.5 flex justify-end gap-2">
        <Button onClick={dismissUpdated}>{t("知道了", "Got It")}</Button>
        <Button primary onClick={() => setNewsOpen(true)}>
          {t("看看新功能", "See What’s New")}
        </Button>
      </div>
    </>
  );
}

function UpdateBody({ update }: { update: UpdateStatus }) {
  const { installUpdate, dismissUpdate } = useApp.getState();
  switch (update.state) {
    case "checking":
      return <p className="text-muted">{t("正在检查更新…", "Checking for updates…")}</p>;
    case "latest":
      return <p className="pr-6">{t("已是最新版本。", "You’re up to date.")}</p>;
    case "available": {
      const { lines, more } = noteLines(update.notes);
      return (
        <>
          <h3 className="pr-6 font-semibold">
            {t(
              <>新版本 <span className="font-mono tabular">{update.version}</span> 可以更新</>,
              <>Version <span className="font-mono tabular">{update.version}</span> is available</>,
            )}
          </h3>
          <p className="mt-0.5 text-[12px] text-faint">
            {t(
              <>当前 <span className="font-mono tabular">{update.current}</span>，更新后自动重新打开，设置和字幕都保留。</>,
              <>You have <span className="font-mono tabular">{update.current}</span>. It reopens by itself after the update, and settings and subtitles are kept.</>,
            )}
          </p>
          {lines.length > 0 && (
            <ul className="mt-2.5 flex list-disc flex-col gap-1 pl-4 text-[12px] leading-relaxed text-muted">
              {lines.map((line, i) => (
                <li key={i} className="line-clamp-2">
                  {line}
                </li>
              ))}
              {more && <li className="list-none text-faint">{t("……", "…")}</li>}
            </ul>
          )}
          <div className="mt-3.5 flex justify-end gap-2">
            <Button onClick={dismissUpdate}>{t("稍后", "Later")}</Button>
            <Button primary onClick={() => void installUpdate()}>
              {t("更新并重新打开", "Update and Relaunch")}
            </Button>
          </div>
        </>
      );
    }
    case "installing": {
      const p = percent(update.done, update.total);
      const finished = p === 100;
      return (
        <>
          <p>
            {finished
              ? t("正在安装，马上重新打开…", "Installing, relaunching shortly…")
              : t(`正在下载 ${update.version}${p === null ? "…" : ` · ${p}%`}`, `Downloading ${update.version}${p === null ? "…" : ` · ${p}%`}`)}
          </p>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-fill">
            <div className="h-full rounded-full bg-fg/70 transition-[width] duration-200" style={{ width: `${p ?? 0}%` }} />
          </div>
        </>
      );
    }
    case "failed":
      return (
        <>
          <p className="pr-6 leading-relaxed">{update.message}</p>
          {update.update && (
            <div className="mt-3 flex justify-end">
              <Button onClick={() => void installUpdate()}>{t("重试", "Try Again")}</Button>
            </div>
          )}
        </>
      );
    default:
      return null;
  }
}
