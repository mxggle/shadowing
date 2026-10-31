import { ChevronDown, EyeOff } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useDismiss } from "../hooks/useDismiss";
import { useKeys } from "../hooks/useKeys";
import { barWidth, HIDE_MODES, hideModeOf, type HideMode } from "../lib/hide";
import { t, tk } from "../lib/i18n";
import { useApp } from "../store";
import { Kbd } from "./ui";

/**
 * A hidden sentence: a bar as long as its text, filling as it plays. A click shows it until the
 * track moves on.
 */
export function HiddenLine({ index, text, start, end, active }: { index: number; text: string; start: number; end: number; active: boolean }) {
  return (
    <button
      title={t("点一下只看这一句")}
      aria-label={t("藏起的句子，点一下只看这一句")}
      onClick={() => useApp.getState().revealSentence(index)}
      className="flex h-[30px] w-full items-center font-script text-[18px]"
    >
      <span className="relative block h-2.5 max-w-full overflow-hidden rounded-full bg-track" style={{ width: `${barWidth(text)}em` }}>
        {active && <Played start={start} end={end} />}
      </span>
    </button>
  );
}

/** How far into the sentence the track is, as the bar's fill. */
function Played({ start, end }: { start: number; end: number }) {
  const part = useApp((s) => Math.min(1, Math.max(0, (s.time - start) / Math.max(0.1, end - start))));
  return <span aria-hidden className="absolute inset-y-0 left-0 bg-faint/55" style={{ width: `${part * 100}%` }} />;
}

const MODES: Record<HideMode, { label: string; desc: string }> = {
  show: { label: tk("显示"), desc: tk("和平常一样。") },
  hide: { label: tk("藏起"), desc: tk("每句换成和句子一样长的灰条。点一句只看这一句，放到别的句子时又藏起来。") },
  after: { label: tk("听完再看"), desc: tk("每句放完一遍才显示。开着跟读停顿时，停下来就能看到。") },
};

/** The sentence list's 藏字幕 key: one click hides (H), the arrow picks how. */
export function HideTextButton() {
  const mode = useApp((s) => hideModeOf(s.settings.hideText));
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);
  const key = useKeys()("hideText");
  const hidden = mode !== "show";
  const look = hidden ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:bg-hover hover:text-fg";
  const { toggleHideText, setHideText } = useApp.getState();

  return (
    <span ref={root} className="relative flex">
      <button
        aria-pressed={hidden}
        title={hidden ? t("显示字幕 ({key})", { key }) : t("藏字幕：不看原文，只听着跟读（按住 {key} 偷看正在放的一句）", { key })}
        onClick={toggleHideText}
        className={`flex h-7 items-center gap-1.5 rounded-l-[8px] pr-1.5 pl-2 text-[12px] font-medium whitespace-nowrap transition-colors duration-150 ${look}`}
      >
        <EyeOff size={14} strokeWidth={2} aria-hidden className={hidden ? "" : "opacity-80"} />
        {mode === "after" ? t("听完再看") : t("藏字幕")}
      </button>
      <button
        aria-expanded={open}
        title={t("怎么藏")}
        aria-label={t("怎么藏")}
        onClick={() => setOpen(!open)}
        className={`grid h-7 w-5 place-items-center rounded-r-[8px] transition-colors duration-150 ${open ? "bg-press text-fg" : hidden ? "bg-raised text-muted shadow-[inset_0_0_0_1px_var(--line-strong)] hover:text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
      >
        <ChevronDown size={11} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label={t("字幕")} className="absolute top-full right-0 z-20 mt-2 w-[284px] origin-top-right animate-pop-in rounded-[12px] bg-raised p-1 shadow-lift">
          <div role="radiogroup" aria-label={t("字幕")}>
            {HIDE_MODES.map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={m === mode}
                onClick={() => {
                  setHideText(m);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors duration-150 hover:bg-hover"
              >
                <span className="mt-[3px] grid size-3.5 shrink-0 place-items-center rounded-full shadow-[inset_0_0_0_1px_var(--line-strong)]">
                  {m === mode && <span className="size-1.5 rounded-full bg-fg" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{t(MODES[m].label)}</span>
                  <span className="mt-px block text-[11px] leading-relaxed text-faint">{t(MODES[m].desc)}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-0.5 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 border-t border-line px-2.5 py-2.5 text-[11px] text-faint">
            <Kbd className="justify-self-start">{key}</Kbd>
            <span>{t("按一下：显示 / 藏起")}</span>
            <Kbd className="justify-self-start">{key}</Kbd>
            <span>{t("按住：偷看正在放的一句")}</span>
          </div>
        </div>
      )}
    </span>
  );
}
