import { ChevronDown, Languages, LoaderCircle } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useDismiss } from "../hooks/useDismiss";
import { useKeys } from "../hooks/useKeys";
import { t, tk } from "../lib/i18n";
import { fromSubtitles, targetLanguage, TRANSLATE_LANGUAGES, TRANSLATION_MODES, translationModeOf, translationOf, type TranslationMode } from "../lib/translation";
import { useApp } from "../store";
import { Button, fieldClass, Kbd, TextLink } from "./ui";

/**
 * 译文 under a sentence's text. Blurred (模糊), it's there to check yourself: hovering shows it,
 * a click keeps it shown (until it's blurred again).
 */
export function TranslationLine({ text, big }: { text: string; big?: boolean }) {
  const mode = useApp((s) => translationModeOf(s.settings.translation));
  const translation = useApp((s) => translationOf(text, s.transcript, s.translations.byText));
  if (mode === "off" || !translation) return null;
  // Keyed by the mode: blurring again blurs every line, including those clicked open.
  return <Line key={mode} translation={translation} blur={mode === "blur"} big={big} />;
}

function Line({ translation, blur, big }: { translation: string; blur: boolean; big?: boolean }) {
  const [seen, setSeen] = useState(false);
  const blurred = blur && !seen;
  const size = big ? "text-[15px]" : "text-[13px]";
  if (!blur) return <p className={`mt-0.5 mb-1 ${size} leading-relaxed break-words text-faint select-text`}>{translation}</p>;
  return (
    <p
      role="button"
      tabIndex={0}
      aria-pressed={seen}
      aria-label={blurred ? t("译文（模糊），点一下显示") : undefined}
      title={blurred ? t("悬停看译文，点一下一直显示") : t("点一下再模糊")}
      onClick={(e) => {
        e.stopPropagation();
        if (window.getSelection()?.isCollapsed === false) return;
        setSeen(!seen);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        setSeen(!seen);
      }}
      className={`mt-0.5 mb-1 w-fit max-w-full cursor-pointer rounded-[4px] ${size} leading-relaxed break-words text-faint outline-none transition-[filter] duration-150 focus-visible:shadow-[0_0_0_2px_var(--line-strong)] ${
        blurred ? "blur-[5px] select-none hover:blur-none focus-visible:blur-none" : "select-text"
      }`}
    >
      {translation}
    </p>
  );
}

const MODES: Record<TranslationMode, { label: string; desc: string }> = {
  show: { label: tk("显示"), desc: tk("每句下面一行译文。") },
  blur: { label: tk("模糊"), desc: tk("译文先模糊着，跟读完再对一下意思：悬停看，点一下一直显示。") },
  off: { label: tk("不显示"), desc: tk("只看原文。") },
};

/** The sentence list's 译文 key: a click goes 显示 → 模糊 → 不显示 (T), the arrow picks how and the language. */
export function TranslationButton() {
  const mode = useApp((s) => translationModeOf(s.settings.translation));
  const status = useApp((s) => s.translations.status);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);
  const key = useKeys()("translation");
  const on = mode !== "off";
  const look = on ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:bg-hover hover:text-fg";
  const { cycleTranslation } = useApp.getState();
  const running = on && status.state === "running";
  const trouble = on && (status.state === "failed" || status.state === "unset");

  return (
    <span ref={root} className="relative flex">
      <button
        aria-pressed={on}
        title={t("译文：显示 → 模糊 → 不显示 ({key})", { key })}
        onClick={cycleTranslation}
        className={`relative flex h-7 items-center gap-1.5 rounded-l-[8px] pr-1.5 pl-2 text-[12px] font-medium whitespace-nowrap transition-colors duration-150 ${look}`}
      >
        {running ? (
          <LoaderCircle size={14} strokeWidth={2} aria-hidden className="animate-spin" />
        ) : (
          <Languages size={14} strokeWidth={2} aria-hidden className={on ? "" : "opacity-80"} />
        )}
        {mode === "blur" ? t("模糊译文") : t("译文")}
        {trouble && <span aria-hidden className="absolute top-1 left-[22px] size-1.5 rounded-full bg-warn" />}
      </button>
      <button
        aria-expanded={open}
        title={t("译文设置")}
        aria-label={t("译文设置")}
        onClick={() => setOpen(!open)}
        className={`grid h-7 w-5 place-items-center rounded-r-[8px] transition-colors duration-150 ${open ? "bg-press text-fg" : on ? "bg-raised text-muted shadow-[inset_0_0_0_1px_var(--line-strong)] hover:text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
      >
        <ChevronDown size={11} strokeWidth={2} aria-hidden />
      </button>
      {open && <TranslationMenu mode={mode} keyName={key} close={close} />}
    </span>
  );
}

function TranslationMenu({ mode, keyName, close }: { mode: TranslationMode; keyName: string; close: () => void }) {
  const { setTranslation, setTranslateTo } = useApp.getState();
  const translateTo = useApp((s) => s.settings.translateTo);
  const target = useApp((s) => targetLanguage(s.settings.translateTo, s.lang));
  const subtitles = useApp((s) => fromSubtitles(s.transcript));
  return (
    <div role="dialog" aria-label={t("译文")} className="absolute top-full right-0 z-20 mt-2 w-[284px] origin-top-right animate-pop-in rounded-[12px] bg-raised p-1 shadow-lift">
      <div role="radiogroup" aria-label={t("译文")}>
        {TRANSLATION_MODES.map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={m === mode}
            onClick={() => {
              setTranslation(m);
              close();
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
      <div className="mt-0.5 border-t border-line px-2.5 pt-2.5 pb-2">
        <label className="flex items-center gap-2 text-[12px] text-muted">
          <span className="shrink-0">{t("翻译成")}</span>
          <select value={translateTo} onChange={(e) => setTranslateTo(e.target.value)} className={`${fieldClass} h-7 text-[12px]`}>
            <option value="">{t("跟随界面（{name}）", { name: TRANSLATE_LANGUAGES.find((l) => l.code === target)?.name ?? target })}</option>
            {TRANSLATE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          {subtitles ? t("字幕文件自带译文，直接用它的；没有译文的句子由「句子解释」的 AI 翻译。") : t("由「句子解释」的 AI 一次翻译整个音频；翻译过的会保存下来，不会重复翻译。")}
        </p>
        <Status />
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 border-t border-line px-2.5 py-2.5 text-[11px] text-faint">
        <Kbd className="justify-self-start">{keyName}</Kbd>
        <span>{t("显示 → 模糊 → 不显示")}</span>
      </div>
    </div>
  );
}

/** Where the translating is: how far, why it stopped, or what it needs. */
function Status() {
  const status = useApp((s) => s.translations.status);
  const on = useApp((s) => s.settings.translation !== "off");
  const { loadTranslations, setSettingsOpen } = useApp.getState();
  if (!on) return null;
  if (status.state === "running")
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
        <LoaderCircle size={13} className="shrink-0 animate-spin" />
        {t("正在翻译")} <span className="tabular font-mono">{status.done} / {status.total}</span>
      </p>
    );
  if (status.state === "failed")
    return (
      <div className="mt-2 text-[12px] text-muted">
        <p className="break-words">{t("翻译没有完成：{message}", { message: status.message })}</p>
        <TextLink className="mt-1 text-[12px]" onClick={() => void loadTranslations()}>
          {t("再试一次")}
        </TextLink>
      </div>
    );
  if (status.state === "unset")
    return (
      <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-muted">
        <span className="min-w-0">{t("翻译用「句子解释」的服务，还没有设置好。")}</span>
        <Button className="h-6 shrink-0 px-2 text-[12px]" onClick={() => setSettingsOpen(true)}>
          {t("去设置")}
        </Button>
      </div>
    );
  return null;
}
