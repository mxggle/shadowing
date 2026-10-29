import { ChevronUp, Hourglass } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDismiss } from "../hooks/useDismiss";
import { useFlash } from "../hooks/useFlash";
import { useKeys } from "../hooks/useKeys";
import { t } from "../lib/i18n";
import {
  clampRatio,
  clampRepeats,
  clampSeconds,
  PAUSE_MODE_LABELS,
  PAUSE_MODES,
  paceActive,
  paceLabel,
  pauseAfter,
  pauseModeOf,
  RATIO_STEP,
  REPEATS_MAX,
  SECONDS_STEP,
  type PaceSettings,
} from "../lib/pace";
import { sentenceIndexAt } from "../lib/sentences";
import { playable, useApp, type AppState } from "../store";
import { Kbd, Stepper } from "./ui";

const settingsOf = (s: AppState): PaceSettings => {
  const { paceOn, pauseMode, pauseSeconds, pauseRatio, sentenceRepeats } = s.settings;
  return { paceOn, pauseMode, pauseSeconds, pauseRatio, sentenceRepeats };
};

/** The pause after a time through, when nothing else (a recording) has the track. */
const gapOf = (s: AppState) => (s.rec || s.live || s.drill ? null : s.paceGap);

/**
 * 跟读停顿 on the deck: the key turns it on and off in one click (G too), keeping how it
 * pauses; the arrow beside it opens how. While it waits after a sentence the key counts down.
 */
export function PaceKey() {
  const pace = useApp(useShallow(settingsOf));
  const hasTrack = useApp((s) => !!s.current && playable(s.current));
  const gap = useApp(gapOf);
  const run = useApp((s) => s.pace);
  const looping = useApp((s) => s.loop.b !== null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), root);
  const flashing = useFlash("pace");
  const key = useKeys()("pace");
  const on = pace.paceOn;
  const active = paceActive(pace);

  // Which time through, outside a loop (a loop counts its own times on the strip above).
  const pass = run && !looping ? run.pass : undefined;
  const label = !on ? t("停顿") : gap ? gap.until === null ? t("该你说") : <Countdown until={gap.until} /> : paceLabel(pace, pass);
  // A narrow window: only the icon while it's off, and just the pause (or the seconds left) while on.
  const short = !on ? null : gap ? gap.until === null ? t("该你说") : <Countdown until={gap.until} short /> : paceLabel({ ...pace, sentenceRepeats: 1 });
  const look = on ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "btn text-fg/85 hover:text-fg";

  return (
    <div ref={root} className="relative flex shrink-0">
      <button
        disabled={!hasTrack}
        aria-pressed={on}
        aria-label={t("跟读停顿")}
        title={
          on
            ? gap
              ? t("停顿中：空格马上继续，Esc 等你说完再继续")
              : t("跟读停顿：开，点一下关掉 ({key})", { key })
            : t("跟读停顿：每句放完停一下，让你跟着说 ({key})", { key })
        }
        onClick={() => useApp.getState().togglePace()}
        data-flash={flashing || undefined}
        className={`relative flex h-8 min-w-0 items-center gap-1.5 overflow-hidden rounded-l-[8px] pr-2 pl-2.5 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,scale] duration-150 ease-snappy active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 data-[flash]:scale-[0.96] ${look}`}
      >
        {gap && gap.until !== null && (
          <span
            key={gap.until}
            aria-hidden
            className="absolute inset-0 origin-left bg-press"
            style={{ animation: `drain ${Math.max(0, gap.until - performance.now())}ms linear forwards` }}
          />
        )}
        <Hourglass size={14} strokeWidth={1.9} aria-hidden className={`relative shrink-0 ${on && active ? "" : "opacity-60"}`} />
        <span className="relative hidden @[640px]:inline">{label}</span>
        {short && <span className="relative @[640px]:hidden">{short}</span>}
      </button>
      <button
        disabled={!hasTrack}
        title={t("跟读停顿的设置")}
        aria-label={t("跟读停顿的设置")}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`grid h-8 w-6 shrink-0 place-items-center rounded-r-[8px] border-l border-line transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${
          open ? "bg-press text-fg" : on ? "bg-raised text-muted shadow-[inset_0_0_0_1px_var(--line-strong)] hover:text-fg" : "btn text-muted hover:text-fg"
        }`}
      >
        <ChevronUp size={12} strokeWidth={2} aria-hidden className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <PaceMenu />}
    </div>
  );
}

/** Seconds left in the pause, counting down. */
function Countdown({ until, short }: { until: number; short?: boolean }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, []);
  const left = Math.max(0, (until - now) / 1000);
  if (short) return <span className="tabular font-mono text-[12px]">{left.toFixed(1)}</span>;
  return (
    <>
      {t("该你说")} <span className="tabular font-mono text-[12px]">{left.toFixed(1)}</span>
    </>
  );
}

/** How it pauses and how many times each sentence plays; any change turns it on. */
function PaceMenu() {
  const pace = useApp(useShallow(settingsOf));
  const setPace = useApp((s) => s.setPace);
  const key = useKeys();
  const mode = pauseModeOf(pace.pauseMode);
  const repeats = clampRepeats(pace.sentenceRepeats);

  return (
    <div
      role="dialog"
      aria-label={t("跟读停顿")}
      className="absolute bottom-full left-0 z-20 mb-2.5 w-[300px] origin-bottom-left animate-pop-up divide-y divide-line rounded-[12px] bg-raised px-1 py-0.5 shadow-lift"
    >
      <div className="flex items-center justify-between gap-3 px-2.5 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">{t("跟读停顿")}</div>
          <div className="mt-px text-[11px] text-faint">{t("每句放完停一下，让你跟着说")}</div>
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
        <div className="text-[13px] font-medium">{t("每句后")}</div>
        <Segmented
          label={t("每句后")}
          value={mode}
          choices={PAUSE_MODES.map((m) => ({ value: m, label: t(PAUSE_MODE_LABELS[m]) }))}
          onChange={(pauseMode) => setPace({ pauseMode })}
          className="mt-2"
        />
        <div className="mt-2">
          {mode === "fixed" && (
            <Stepper decTitle={t("少停 {n} 秒", { n: SECONDS_STEP })} incTitle={t("多停 {n} 秒", { n: SECONDS_STEP })} onDec={() => setPace({ pauseSeconds: pace.pauseSeconds - SECONDS_STEP })} onInc={() => setPace({ pauseSeconds: pace.pauseSeconds + SECONDS_STEP })}>
              <span className="tabular font-mono text-[12px] font-medium">{t("{n} 秒", { n: clampSeconds(pace.pauseSeconds) })}</span>
            </Stepper>
          )}
          {mode === "length" && (
            <Stepper decTitle={t("短一点")} incTitle={t("长一点")} onDec={() => setPace({ pauseRatio: pace.pauseRatio - RATIO_STEP })} onInc={() => setPace({ pauseRatio: pace.pauseRatio + RATIO_STEP })}>
              <span className="tabular font-mono text-[12px] font-medium">{t("句长 ×{n}", { n: clampRatio(pace.pauseRatio) })}</span>
            </Stepper>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
            <ModeHint pace={pace} />
          </p>
        </div>
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
        <span>{t("停顿时：等我说完再继续")}</span>
      </div>
    </div>
  );
}

/** What the chosen pause means, with the sentence playing as the example when there is one. */
function ModeHint({ pace }: { pace: PaceSettings }) {
  const length = useApp((s) => {
    const list = s.transcript?.sentences ?? [];
    const sentence = list[Math.max(0, sentenceIndexAt(list, s.time))];
    return sentence ? sentence.end - sentence.start : null;
  });
  const rate = useApp((s) => s.settings.rate);
  switch (pauseModeOf(pace.pauseMode)) {
    case "none":
      return t("句子之间不停；想每句多听几遍就调下面的遍数。");
    case "fixed":
      return t("每句后都停一样长。");
    case "wait":
      return t("放完一句就停下，等你按空格（或播放键）再继续。");
    case "length": {
      if (length === null) return t("长句停得久，短句停得短。比如 3 秒的句子停 {gap} 秒。", { gap: pauseAfter(pace, 3, 1) ?? 0 });
      // As heard: slowed down, the sentence (and so the pause) is longer.
      return t("长句停得久，短句停得短。这一句 {len} 秒，停 {gap} 秒。", { len: (length / rate).toFixed(1), gap: pauseAfter(pace, length, rate) ?? 0 });
    }
  }
}

/** A row of choices, the chosen one white with a thin line (like the other pickers in the menus). */
function Segmented<V extends string | boolean>({ label, value, choices, onChange, className = "" }: {
  label: string;
  value: V | null;
  choices: { value: V; label: string }[];
  onChange: (value: V) => void;
  className?: string;
}) {
  return (
    <div className={`tint flex rounded-[10px] p-[3px] ${className}`} role="radiogroup" aria-label={label}>
      {choices.map((c) => (
        <button
          key={String(c.value)}
          role="radio"
          aria-checked={c.value === value}
          onClick={() => onChange(c.value)}
          className={`h-[26px] min-w-0 flex-1 truncate rounded-[7px] px-1 text-[12px] transition-[background-color,color,box-shadow] duration-150 ${
            c.value === value ? "bg-raised font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
