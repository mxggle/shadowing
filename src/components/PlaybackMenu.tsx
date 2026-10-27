import { ChevronUp } from "lucide-react";
import { useRef, useState } from "react";
import { formatRate, RATE_PRESETS, RATE_STEP, SEEK_STEP_MAX, SEEK_STEP_MIN } from "../audio/logic";
import { useDismiss } from "../hooks/useDismiss";
import { useFlash } from "../hooks/useFlash";
import { t } from "../lib/i18n";
import { rubyKey, transcriptLanguage } from "../lib/ruby";
import { useApp } from "../store";
import { PictureMenu } from "./PictureMenu";
import { PLAY_MODE_LOOK, PlayModePicker } from "./PlayMode";
import { Stepper } from "./ui";

/**
 * The deck's one settings key: shows the speed (and the play mode when it
 * isn't plain "in order"), opens speed presets, fine speed, jump step and
 * play mode. Their shortcuts press it, so the change is seen where it lives.
 */
export function PlaybackMenu() {
  const [open, setOpen] = useState(false);
  const rate = useApp((s) => s.settings.rate);
  const playMode = useApp((s) => s.settings.playMode);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), root);
  const flashing = [useFlash("slower"), useFlash("faster"), useFlash("playMode")].some(Boolean);
  const { icon: ModeIcon, label } = PLAY_MODE_LOOK[playMode];
  const modeLabel = t(label);
  const showMode = playMode !== "next";

  return (
    <div ref={root} className="relative">
      <button
        title={showMode ? t("播放设置：速度、跳转步长、播放顺序\n现在：{mode}", { mode: modeLabel }) : t("播放设置：速度、跳转步长、播放顺序")}
        aria-label={
          showMode
            ? t("播放设置，速度 {rate}，{mode}", { rate: formatRate(rate), mode: modeLabel })
            : t("播放设置，速度 {rate}", { rate: formatRate(rate) })
        }
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-flash={flashing || undefined}
        className={`flex h-8 items-center gap-1.5 rounded-[8px] pr-2 pl-2.5 text-fg ${open ? "bg-press" : "btn"}`}
      >
        {showMode && (
          <>
            <ModeIcon size={15} strokeWidth={1.8} aria-hidden />
            <span aria-hidden className="h-3.5 w-px bg-line-strong" />
          </>
        )}
        <span className="tabular font-mono text-[12px] font-medium">{formatRate(rate)}</span>
        <ChevronUp size={12} strokeWidth={2} aria-hidden className={`opacity-55 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("播放设置")}
          className="absolute right-0 bottom-full z-20 mb-2.5 w-[288px] origin-bottom-right animate-pop-up divide-y divide-line rounded-[12px] bg-raised px-1 py-0.5 shadow-lift"
        >
          <SpeedSection />
          <Row label={t("跳转步长")} hint="← / →">
            <SeekStepControl />
          </Row>
          <Row label={t("播放顺序")} hint={`${modeLabel} · R`}>
            <PlayModePicker />
          </Row>
          <Row label={t("高亮")} hint={t("逐字只限转写的字幕")}>
            <HighlightPicker />
          </Row>
          <RubyRow />
          <PictureMenu />
        </div>
      )}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2.5 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="mt-px text-[11px] text-faint">{hint}</div>
      </div>
      <div className="w-[124px] shrink-0">{children}</div>
    </div>
  );
}

/**
 * The sentence playing lights up a character (a word) at a time, or whole.
 * Only transcription times the characters: other subtitles light whole either way.
 */
function HighlightPicker() {
  const on = useApp((s) => s.settings.wordHighlight);
  const setWordHighlight = useApp((s) => s.setWordHighlight);
  const choices = [
    { value: true, label: t("逐字"), hint: t("正在放的句子跟着声音一个字一个字亮起来（英文一个词一个词）") },
    { value: false, label: t("整句"), hint: t("正在放的句子整句亮着") },
  ];
  return (
    <div className="tint flex rounded-[10px] p-[3px]" role="radiogroup" aria-label={t("高亮")}>
      {choices.map((c) => (
        <button
          key={c.label}
          role="radio"
          aria-checked={c.value === on}
          title={c.hint}
          onClick={() => setWordHighlight(c.value)}
          className={`h-[26px] flex-1 rounded-[7px] text-[12px] transition-[background-color,color,box-shadow] duration-150 ${
            c.value === on ? "bg-raised font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** 注音 on or off, when a plugin reads the open transcript's language (how it reads: 设置 → 插件). */
function RubyRow() {
  const reads = useApp((s) => !!rubyKey(s.plugins, transcriptLanguage(s.transcript?.sentences.map((x) => x.text) ?? [])));
  const on = useApp((s) => s.settings.ruby);
  const setRuby = useApp((s) => s.setRuby);
  if (!reads) return null;
  const choices = [
    { value: true, label: t("显示") },
    { value: false, label: t("隐藏") },
  ];
  return (
    <Row label={t("注音")} hint={t("写法在设置的插件里")}>
      <div className="tint flex rounded-[10px] p-[3px]" role="radiogroup" aria-label={t("注音")}>
        {choices.map((c) => (
          <button
            key={c.label}
            role="radio"
            aria-checked={c.value === on}
            onClick={() => setRuby(c.value)}
            className={`h-[26px] flex-1 rounded-[7px] text-[12px] transition-[background-color,color,box-shadow] duration-150 ${
              c.value === on ? "bg-raised font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </Row>
  );
}

/** Presets for one click, then − value + for the 0.05 steps in between. */
function SpeedSection() {
  const rate = useApp((s) => s.settings.rate);
  const setRate = useApp((s) => s.setRate);
  return (
    <div className="px-2.5 pt-3 pb-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{t("速度")}</span>
        <span className="text-[11px] text-faint">− / =</span>
      </div>
      <div className="tint mt-2.5 grid grid-cols-4 gap-0.5 rounded-[10px] p-[3px]" role="group" aria-label={t("常用速度")}>
        {RATE_PRESETS.map((p) => {
          const on = Math.abs(rate - p) < 0.001;
          return (
            <button
              key={p}
              aria-pressed={on}
              onClick={() => setRate(p)}
              className={`tabular h-7 rounded-[7px] font-mono text-[12px] transition-[background-color,color,box-shadow] duration-150 ${
                on ? "bg-raised font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
              }`}
            >
              {formatRate(p).slice(0, -1)}
            </button>
          );
        })}
      </div>
      <div className="mt-2">
        <Stepper
          decTitle={t("减速 (−)")}
          incTitle={t("加速 (=)")}
          decFlash="slower"
          incFlash="faster"
          onDec={() => (setRate(rate - RATE_STEP), useApp.getState().tip("rate"))}
          onInc={() => (setRate(rate + RATE_STEP), useApp.getState().tip("rate"))}
        >
          <button title={t("点击恢复 1.0×")} onClick={() => setRate(1)} className="tabular h-7 w-full font-mono text-[12px] font-medium">
            {rate.toFixed(2)}×
          </button>
        </Stepper>
      </div>
    </div>
  );
}

/** Free-typed step in seconds; saved as you type, tidied up on blur. */
function SeekStepControl() {
  const seekStep = useApp((s) => s.settings.seekStep);
  const setSeekStep = useApp((s) => s.setSeekStep);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Stepper decTitle={t("减少 1 秒")} incTitle={t("增加 1 秒")} onDec={() => setSeekStep(seekStep - 1)} onInc={() => setSeekStep(seekStep + 1)}>
      <label title={t("快退 / 快进的秒数（{min}–{max}）", { min: SEEK_STEP_MIN, max: SEEK_STEP_MAX })} className="flex items-baseline">
        <input
          type="number"
          inputMode="numeric"
          min={SEEK_STEP_MIN}
          max={SEEK_STEP_MAX}
          step={1}
          value={draft ?? seekStep}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) setSeekStep(n);
          }}
          onBlur={() => setDraft(null)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
          }}
          className="tabular w-6 [appearance:textfield] rounded-[4px] bg-transparent text-right font-mono text-[12px] font-medium outline-none focus:bg-raised focus:ring-1 focus:ring-line-strong [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="ml-0.5 text-[11px] text-muted">{t("秒")}</span>
      </label>
    </Stepper>
  );
}
