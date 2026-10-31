import { useShallow } from "zustand/react/shallow";
import { useKeys } from "../hooks/useKeys";
import { t } from "../lib/i18n";
import {
  clampRatio,
  clampRepeats,
  clampSeconds,
  PAUSE_LENGTH_LABELS,
  PAUSE_LENGTHS,
  PAUSE_MODE_LABELS,
  PAUSE_MODES,
  pauseAfter,
  pauseLengthOf,
  pauseModeOf,
  pauseWaitOf,
  QUICK_SECONDS,
  RATIO_STEP,
  REPEATS_MAX,
  SECONDS_MAX,
  SECONDS_STEP,
  type PaceSettings,
  type PauseWait,
} from "../lib/pace";
import { sentenceIndexAt } from "../lib/sentences";
import { paceSettingsOf } from "../paceSlice";
import { useApp } from "../store";
import { Kbd, Stepper, TextLink } from "./ui";

/** 等我说完 (the mic decides when the pause ends) isn't ready yet: only waiting for a key is offered. */
const VOICE_WAIT = false;

/** How long it pauses and how many times each sentence plays; any change turns it on. */
export function PaceMenu() {
  const pace = useApp(useShallow(paceSettingsOf));
  const setPace = useApp((s) => s.setPace);
  const key = useKeys();
  const mode = pauseModeOf(pace.pauseMode);
  const size = pauseLengthOf(pace.pauseLength);
  const repeats = clampRepeats(pace.sentenceRepeats);
  const seconds = clampSeconds(pace.pauseSeconds);

  return (
    <div
      role="dialog"
      aria-label={t("跟读停顿")}
      className="absolute bottom-full left-0 z-20 mb-2.5 w-[316px] origin-bottom-left animate-pop-up divide-y divide-line rounded-[12px] bg-raised px-1 py-0.5 shadow-lift"
    >
      <div className="flex items-center justify-between gap-3 px-2.5 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">{t("跟读停顿")}</div>
          <div className="mt-px text-[11px] text-faint">{t("每句放完停一下，留时间给你说")}</div>
        </div>
        <Segmented
          label={t("跟读停顿")}
          value={pace.paceOn}
          choices={[
            { value: false, label: t("关") },
            { value: true, label: t("开") },
          ]}
          onChange={(paceOn) => setPace({ paceOn })}
          className="w-[92px]"
        />
      </div>

      <div className="px-2.5 pt-2.5 pb-3">
        <div className="text-[13px] font-medium">{t("停多久")}</div>
        <Segmented
          label={t("停多久")}
          value={mode}
          choices={PAUSE_MODES.map((m) => ({ value: m, label: t(PAUSE_MODE_LABELS[m]) }))}
          onChange={(pauseMode) => setPace({ pauseMode })}
          className="mt-2"
        />
        {mode === "length" && (
          <div className="mt-2 flex items-center gap-2">
            {size === "custom" ? (
              <div className="min-w-0 flex-1">
                <Stepper decTitle={t("短一点")} incTitle={t("长一点")} onDec={() => setPace({ pauseRatio: pace.pauseRatio - RATIO_STEP })} onInc={() => setPace({ pauseRatio: pace.pauseRatio + RATIO_STEP })}>
                  <span className="tabular font-mono text-[12px] font-medium">{t("句长 ×{n}", { n: clampRatio(pace.pauseRatio) })}</span>
                </Stepper>
              </div>
            ) : (
              <Segmented
                label={t("长短")}
                value={size}
                choices={PAUSE_LENGTHS.map((l) => ({ value: l, label: t(PAUSE_LENGTH_LABELS[l]) }))}
                onChange={(pauseLength) => setPace({ pauseLength })}
                className="min-w-0 flex-1"
                small
              />
            )}
            <TextLink className="shrink-0 !text-[12px]" onClick={() => setPace({ pauseLength: size === "custom" ? "standard" : "custom" })}>
              {size === "custom" ? t("用三档") : t("自定义…")}
            </TextLink>
          </div>
        )}
        {mode === "fixed" && (
          <div className="mt-2 flex items-center gap-1">
            <div role="radiogroup" aria-label={t("停几秒")} className="flex gap-1">
              {QUICK_SECONDS.map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={seconds === n}
                  onClick={() => setPace({ pauseSeconds: n })}
                  className={`tabular h-8 w-[34px] rounded-[8px] font-mono text-[12px] transition-[background-color,color,box-shadow] duration-150 ${
                    seconds === n ? "bg-raised font-medium text-fg shadow-[0_0_0_1px_var(--line-strong)]" : "tint text-muted hover:text-fg"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="px-0.5 text-[12px] text-muted">{t("秒")}</span>
            <div className="ml-auto w-[108px] shrink-0">
              <Stepper
                decTitle={t("少停 {n} 秒", { n: SECONDS_STEP })}
                incTitle={t("多停 {n} 秒", { n: SECONDS_STEP })}
                onDec={() => setPace({ pauseSeconds: seconds - SECONDS_STEP })}
                onInc={() => setPace({ pauseSeconds: Math.min(SECONDS_MAX, seconds + SECONDS_STEP) })}
              >
                <span className="tabular font-mono text-[12px] font-medium">{t("{n} 秒", { n: seconds })}</span>
              </Stepper>
            </div>
          </div>
        )}
        {mode === "wait" && VOICE_WAIT && (
          <Segmented<PauseWait>
            label={t("等到什么时候")}
            value={pauseWaitOf(pace.pauseWait)}
            choices={[
              { value: "key", label: t("按键继续") },
              { value: "voice", label: t("说完继续") },
            ]}
            onChange={(pauseWait) => setPace({ pauseWait })}
            className="mt-2"
            small
          />
        )}
        <ModeResult pace={pace} />
        <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
          <ModeHint pace={pace} goOn={key("toggle")} />
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 px-2.5 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">{t("每句放")}</div>
          <div className="mt-px text-[11px] text-faint">{repeats > 1 ? t("放够了再到下一句") : t("放一遍就到下一句")}</div>
        </div>
        <div className="w-[124px] shrink-0">
          <Stepper decTitle={t("少一遍")} incTitle={t("多一遍")} onDec={() => setPace({ sentenceRepeats: repeats - 1 })} onInc={() => setPace({ sentenceRepeats: Math.min(REPEATS_MAX, repeats + 1) })}>
            <span className="tabular font-mono text-[12px] font-medium">{t("{n} 遍", { n: repeats })}</span>
          </Stepper>
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 px-2.5 py-2.5 text-[11px] text-faint">
        <Kbd className="justify-self-start">{key("pace")}</Kbd>
        <span>{t("开 / 关")}</span>
        <Kbd className="justify-self-start">{key("toggle")}</Kbd>
        <span>{t("停顿时：马上继续")}</span>
        <Kbd className="justify-self-start">Esc</Kbd>
        <span>{t("停顿时：一直等我")}</span>
      </div>
    </div>
  );
}

/** The sentence playing (or about to), as heard at the speed set; null without a transcript. */
function useHeardLength() {
  return useApp((s) => {
    const list = s.transcript?.sentences ?? [];
    const sentence = list[Math.max(0, sentenceIndexAt(list, s.time))];
    return sentence ? sentence.end - sentence.start : null;
  });
}

/** "这一句 2.8 秒 → 停 3.8 秒": the pause worked out on the sentence playing, not as a formula. */
function ModeResult({ pace }: { pace: PaceSettings }) {
  const length = useHeardLength();
  const rate = useApp((s) => s.settings.rate);
  const gap = length === null ? null : pauseAfter(pace, length, rate);
  if (length === null || gap === null) return null;
  return (
    <div className="mt-2.5 flex items-baseline gap-1.5 text-[12px] text-muted">
      <span>{t("这一句")}</span>
      <span className="tabular font-mono text-fg">{t("{n} 秒", { n: (length / rate).toFixed(1) })}</span>
      <span className="text-faint">→</span>
      <span>{t("停")}</span>
      <span className="tabular font-mono font-semibold text-fg">{t("{n} 秒", { n: gap })}</span>
    </div>
  );
}

/** What the chosen pause means. */
function ModeHint({ pace, goOn }: { pace: PaceSettings; goOn: string }) {
  switch (pauseModeOf(pace.pauseMode)) {
    case "fixed":
      return t("每句后都停一样长。0 秒就是不停，最多 30 秒。");
    case "wait":
      return pauseWaitOf(pace.pauseWait) === "voice"
        ? t("听到你说完就继续，不用按键。麦克风只用来听你说完没有，不录下来。")
        : t("放完一句就停下，按 {key}（或播放键）再继续。", { key: goOn });
    case "length":
      return pauseLengthOf(pace.pauseLength) === "custom" ? t("长句停得久，短句停得短：停的时间 = 句长 × 倍数，至少 1 秒。") : t("长句停得久，短句停得短。标准是句长再加 1 秒。");
  }
}

/** A row of choices, the chosen one white with a thin line (like the other pickers in the menus). */
function Segmented<V extends string | boolean>({ label, value, choices, onChange, className = "", small }: {
  label: string;
  value: V | null;
  choices: { value: V; label: string }[];
  onChange: (value: V) => void;
  className?: string;
  small?: boolean;
}) {
  return (
    <div className={`tint flex rounded-[10px] p-[3px] ${className}`} role="radiogroup" aria-label={label}>
      {choices.map((c) => (
        <button
          key={String(c.value)}
          role="radio"
          aria-checked={c.value === value}
          onClick={() => onChange(c.value)}
          className={`${small ? "h-[24px]" : "h-[26px]"} min-w-0 flex-1 truncate rounded-[7px] px-1 text-[12px] transition-[background-color,color,box-shadow] duration-150 ${
            c.value === value ? "bg-raised font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
