import { ArrowRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { matchingSentences } from "../lib/edits";
import { t } from "../lib/i18n";
import { useApp } from "../store";
import { Button, fieldClass, IconButton, TextLink } from "./ui";

/**
 * Find and replace across the sentences, under the list header. Opens with ⌘F,
 * or by itself after a correction whose old word is also in other sentences.
 * Matches are marked in the list; ↩ in a field scrolls to the next one.
 */
export function ReplaceBar() {
  const bar = useApp((s) => s.replace);
  const sentences = useApp((s) => s.transcript?.sentences);
  const { setReplace, closeReplace, replaceAll, undoEdit } = useApp.getState();
  const findField = useRef<HTMLInputElement>(null);
  const shown = useRef(-1);
  const find = bar?.find ?? "";
  const matches = useMemo(() => (find && sentences ? matchingSentences(sentences, find) : []), [sentences, find]);

  useEffect(() => {
    if (!bar?.focus) return;
    findField.current?.focus();
    findField.current?.select();
  }, [bar?.focus]);

  if (!bar) return null;

  const showNext = () => {
    if (!matches.length) return;
    shown.current = (shown.current + 1) % matches.length;
    document.querySelector(`[data-index="${matches[shown.current]}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const keys = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") closeReplace();
    else if (e.key === "Enter") showNext();
    else return;
    e.preventDefault();
  };
  const field = `${fieldClass} h-7`;

  return (
    <div className="mx-auto flex w-full max-w-[760px] animate-fade items-center gap-2 pr-8 pb-2.5 pl-10">
      {bar.suggested && <span className="shrink-0 text-[12px] text-muted">{t("其他句子里也有：")}</span>}
      <div className="grid max-w-[26rem] min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <input
          ref={findField}
          aria-label={t("查找")}
          placeholder={t("查找")}
          value={bar.find}
          onChange={(e) => setReplace({ find: e.target.value })}
          onKeyDown={keys}
          className={field}
        />
        <ArrowRight size={14} className="text-faint" aria-hidden />
        <input
          aria-label={t("替换为")}
          placeholder={t("替换为")}
          value={bar.with}
          onChange={(e) => setReplace({ with: e.target.value })}
          onKeyDown={keys}
          className={field}
        />
      </div>
      {bar.replaced !== null ? (
        <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
          {t("已替换")} <span className="tabular -mx-1 font-mono">{bar.replaced}</span> {t("句", { n: bar.replaced })}
          <TextLink className="text-[12px]" title={t("撤销 (⌘Z)")} onClick={() => void undoEdit()}>
            {t("撤销")}
          </TextLink>
        </span>
      ) : (
        <>
          {find && (
            <span className="shrink-0 text-[12px] whitespace-nowrap text-muted">
              {matches.length ? (
                <>
                  <span className="tabular font-mono">{matches.length}</span> {t("句", { n: matches.length })}
                </>
              ) : (
                t("没有找到")
              )}
            </span>
          )}
          <Button
            disabled={!matches.length || bar.find === bar.with}
            onClick={() => void replaceAll()}
            className="h-7 px-2.5 text-[12px] disabled:opacity-40"
          >
            {t("全部替换")}
          </Button>
        </>
      )}
      <IconButton title={t("关闭 (Esc)")} onClick={closeReplace} className="ml-auto">
        <X />
      </IconButton>
    </div>
  );
}
