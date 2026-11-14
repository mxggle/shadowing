import { Check, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText } from "../lib/clipboard";
import { t } from "../lib/i18n";
import { useApp } from "../store";
import { Button, IconButton } from "./ui";

/** AnkiConnect's code on AnkiWeb (ankiweb.net/shared/info/2055492159). */
const ADDON = "2055492159";

/**
 * 加入 Anki when Anki can't be reached: it has to be open, with the AnkiConnect add-on (once).
 * 再试一次 adds the sentence that was asked for; the dialog stays, saying so, while Anki still isn't there.
 */
export function AnkiHelpDialog() {
  const open = useApp((s) => s.ankiWaiting !== null);
  const busy = useApp((s) => s.ankiAdding !== null);
  const [missed, setMissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const { retryAnki, closeAnkiHelp } = useApp.getState();

  useEffect(() => {
    if (!open) {
      setMissed(false);
      setCopied(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeAnkiHelp();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, closeAnkiHelp]);

  if (!open) return null;
  const retry = async () => setMissed(!(await retryAnki()));
  const copy = async () => setCopied(await copyText(ADDON));

  return (
    <div
      className="fixed inset-0 z-30 flex animate-fade justify-center bg-black/25 px-6 pt-[7vh] pb-6 dark:bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && closeAnkiHelp()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="anki-title"
        className="flex max-h-full w-full max-w-[460px] animate-pop-in flex-col self-start overflow-hidden rounded-[16px] bg-raised shadow-lift"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-2.5 pl-6">
          <h2 id="anki-title" className="text-[14px] font-semibold">
            {t("连接 Anki")}
          </h2>
          <IconButton title={t("关闭 (Esc)")} onClick={closeAnkiHelp}>
            <X />
          </IconButton>
        </header>
        <div className="scrollbar-none overflow-y-auto px-6 pt-4 pb-5 text-[13px] leading-relaxed">
          <p className="text-muted">{t("这一句会直接加进电脑上的 Anki。要先做好两件事：")}</p>
          <ol className="mt-3 flex flex-col gap-2.5">
            <li className="flex gap-2.5">
              <Step n={1} />
              <span>{t("打开 Anki 电脑版，让它开着。")}</span>
            </li>
            <li className="flex gap-2.5">
              <Step n={2} />
              <span className="min-w-0">
                {t("第一次用：在 Anki 里选「工具 → 插件 → 获取插件…」，填入 AnkiConnect 的代码，装好后重启 Anki。")}
                <span className="mt-1.5 flex items-center gap-2">
                  <code className="tint tabular rounded-[7px] px-2 py-0.5 font-mono text-[13px]">{ADDON}</code>
                  <Button onClick={() => void copy()}>
                    {copied ? <Check size={12} strokeWidth={2.4} /> : <Copy size={12} strokeWidth={2} />} {copied ? t("已复制") : t("复制代码")}
                  </Button>
                </span>
              </span>
            </li>
          </ol>
          <p className="mt-4 text-[12px] text-faint">{t("卡片放在「Shadowing」牌组：正面是这一句和它的录音，背面是译文和保存过的解释。")}</p>
          {missed && !busy && <p className="mt-3 text-[12px] text-danger">{t("还是连不上 Anki：确认 Anki 开着；刚装好 AnkiConnect 的话，要重启一次 Anki。")}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={closeAnkiHelp}>{t("取消")}</Button>
            <Button primary disabled={busy} onClick={() => void retry()}>
              {busy ? t("连接中…") : t("再试一次")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return <span className="tabular grid size-[20px] shrink-0 place-items-center rounded-full bg-press font-mono text-[11px] text-muted">{n}</span>;
}
