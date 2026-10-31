import { ChevronDown, Hourglass, X } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { t } from "../lib/i18n";
import { betweenPasses, paceActive, withPause } from "../lib/pace";
import { formatPrecise } from "../lib/time";
import { sectionName, sectionsOf } from "../lib/sections";
import { paceSettingsOf } from "../paceSlice";
import { useApp } from "../store";
import { takesFor } from "../lib/takes";
import { MicButton, RecorderCard } from "./Recorder";
import { IconButton, Kbd } from "./ui";
import { useKeys } from "../hooks/useKeys";

export type LoopPhase = "idle" | "armed" | "active";

export function useLoopPhase(): LoopPhase {
  return useApp((s) => (s.loop.a === null ? "idle" : s.loop.b === null ? "armed" : "active"));
}

/** "第 3 遍 · 4.5 秒": which pass is playing now, and how long one pass is. */
function PassInfo({ className = "" }: { className?: string }) {
  const repeats = useApp((s) => s.repeats);
  const length = useApp((s) => (s.loop.a !== null && s.loop.b !== null ? s.loop.b - s.loop.a : 0));
  return (
    <span className={`tabular font-mono whitespace-nowrap text-loop-text ${className}`} aria-live="polite">
      {rich(t("第 {n} 遍"), { n: <span key={repeats} className="inline-block animate-pop">{repeats + 1}</span> })}
      <span className="text-loop-text/70"> · {t("{secs} 秒", { secs: length.toFixed(1) })}</span>
    </span>
  );
}

/** Text from t() with its {name} slots drawn by `slots`: rich(t("按 {key} 设终点"), { key: <Kbd>L</Kbd> }). */
function rich(text: string, slots: Record<string, ReactNode>): ReactNode {
  return text.split(/\{(\w+)\}/).map((piece, i) => (i % 2 ? <Fragment key={i}>{slots[piece]}</Fragment> : piece));
}

/** The loop key (L, unless 设置 → 快捷键 moved it) as a key cap. */
function useLoopKey(): ReactNode {
  const key = useKeys();
  return <Kbd>{key("loop")}</Kbd>;
}

function caption(phase: LoopPhase, loopKey: ReactNode, recordKey: string): ReactNode {
  if (phase === "idle") return rich(t("听到想练的句子开头时按 {key}，结尾再按一次，这一段就会反复播放。"), { key: loopKey });
  if (phase === "armed") return rich(t("起点已设好。听到句尾时按 {key} 设终点。"), { key: loopKey });
  return rich(t("‹ › 把边界移动 0.1 秒。按 {record} 跟读录音，按 {key} 或 {esc} 取消循环。"), {
    record: <Kbd>{recordKey}</Kbd>,
    key: loopKey,
    esc: <Kbd>Esc</Kbd>,
  });
}

/**
 * Without a transcript the loop is what you're practising, so it gets the
 * main area: two readouts, A and B, that fill in as you press L. The empty
 * one you'll set next is outlined, so the next step is always visible.
 */
export function LoopPanel() {
  const phase = useLoopPhase();
  const loop = useApp((s) => s.loop);
  const { clearLoop, nudgeLoop } = useApp.getState();
  const length = loop.a !== null && loop.b !== null ? loop.b - loop.a : null;
  const takes = useApp((s) => (s.loop.a !== null && s.loop.b !== null ? takesFor(s.takes, s.loop.a, s.loop.b).length : 0));
  const recording = useApp((s) => s.recordAt === "loop");
  const key = useKeys();
  const loopKey = useLoopKey();

  return (
    <section className="@container" aria-label={t("A–B 循环")}>
      <header className="flex h-7 items-center gap-3">
        <h2 className="text-[13px] font-semibold">{t("A–B 循环")}</h2>
        {phase === "active" && <PassInfo className="text-[12px]" />}
        {phase !== "idle" && (
          <span className="ml-auto flex items-center gap-0.5">
            {phase === "active" && <MicButton at="loop" count={takes} className="!opacity-100" />}
            <IconButton title={t("取消循环 (Esc)")} onClick={clearLoop}>
              <X />
            </IconButton>
          </span>
        )}
      </header>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center">
        <Readout label="A" value={loop.a} next={phase === "idle"} onNudge={phase === "active" ? (d) => nudgeLoop("a", d) : undefined} />
        <span className="flex w-10 flex-col items-center @[520px]:w-20">
          <span className={`h-px w-full transition-colors duration-300 ${length !== null ? "bg-loop" : "bg-line-strong"}`} />
        </span>
        <Readout label="B" value={loop.b} next={phase === "armed"} onNudge={phase === "active" ? (d) => nudgeLoop("b", d) : undefined} />
      </div>

      <p key={phase} className="mt-3.5 animate-fade text-[13px] leading-relaxed text-muted">
        {caption(phase, loopKey, key("record"))}
      </p>
      {recording && phase === "active" && (
        <div className="mt-3">
          <RecorderCard at="loop" />
        </div>
      )}
    </section>
  );
}

/**
 * One loop boundary as a tinted readout. Empty, it says what pressing L will
 * do; `next` outlines the one L sets next.
 */
function Readout({ label, value, next, onNudge }: {
  label: string;
  value: number | null;
  next: boolean;
  onNudge?: (d: number) => void;
}) {
  const set = value !== null;
  const loopKey = useLoopKey();
  const outline = next ? (label === "B" ? "outline-loop-line" : "outline-line-strong") : "outline-transparent";
  return (
    <div
      className={`tint relative flex h-[84px] min-w-0 items-center justify-center rounded-[14px] outline-1 outline-offset-[3px] outline-dashed transition-[outline-color] duration-200 ${outline}`}
    >
      <span className={`absolute top-2.5 left-3 text-[11px] font-semibold ${set ? "text-loop" : next ? "text-fg" : "text-faint"}`}>
        {label}
      </span>
      {set ? (
        <span className="flex animate-fade items-center">
          {onNudge && <Nudge label={label} d={-0.1} onNudge={onNudge} />}
          <span className="tabular px-1 font-mono text-[22px] font-light tracking-[-0.02em] @[520px]:text-[30px]">
            {formatPrecise(value)}
          </span>
          {onNudge && <Nudge label={label} d={0.1} onNudge={onNudge} />}
        </span>
      ) : (
        <span className={`flex items-center gap-1.5 text-[13px] ${next ? (label === "B" ? "text-loop-text" : "text-fg") : "text-faint"}`}>
          {rich(label === "A" ? t("按 {key} 设起点") : t("按 {key} 设终点"), { key: loopKey })}
        </span>
      )}
    </div>
  );
}

function Nudge({ label, d, onNudge, small }: { label: string; d: number; onNudge: (d: number) => void; small?: boolean }) {
  return (
    <button
      title={d < 0 ? t("{label} 提前 0.1 秒", { label }) : t("{label} 推后 0.1 秒", { label })}
      onClick={() => onNudge(d)}
      className={`grid place-items-center rounded-[6px] text-muted transition-[background-color,color,scale] duration-150 hover:bg-hover hover:text-fg active:scale-90 ${
        small ? "h-6 w-5 text-[14px]" : "h-9 w-6 text-[18px] @[520px]:w-7"
      }`}
    >
      {d < 0 ? "‹" : "›"}
    </button>
  );
}

/**
 * With a transcript the sentences take the main area; the loop shows as a
 * slim readout on top of the deck instead.
 */
export function LoopStrip() {
  const phase = useLoopPhase();
  const loop = useApp((s) => s.loop);
  const loopSentence = useApp((s) => s.loopSentence);
  const loopSection = useApp((s) => (s.loopSection === null ? null : sectionName(sectionsOf(s.transcript), s.loopSection)));
  const hasTranscript = useApp((s) => !!s.transcript?.sentences.length);
  const { clearLoop, nudgeLoop } = useApp.getState();
  const loopKey = useLoopKey();
  if (phase === "idle" || !hasTranscript) return null;

  return (
    <div className="tint mb-2.5 flex h-9 animate-fade-in items-center gap-3 rounded-[10px] pr-1 pl-3.5">
      <span className="max-w-[10rem] shrink-0 truncate text-[12px] font-medium whitespace-nowrap text-loop-text">
        {loopSection ?? (loopSentence !== null ? t("第 {n} 句", { n: loopSentence + 1 }) : "A–B")}
      </span>
      <span className="h-3.5 w-px shrink-0 bg-line-strong" />
      <Boundary label="A" value={loop.a!} onNudge={phase === "active" ? (d) => nudgeLoop("a", d) : undefined} />
      {phase === "active" ? (
        <Boundary label="B" value={loop.b!} onNudge={(d) => nudgeLoop("b", d)} />
      ) : (
        <span className="flex items-center gap-1.5 text-[12px] whitespace-nowrap text-loop-text">
          {rich(t("按 {key} 设终点 B"), { key: loopKey })}
        </span>
      )}
      <span className="ml-auto flex min-w-0 items-center gap-1">
        {phase === "active" && <PassInfo className="truncate text-[11px]" />}
        {phase === "active" && loopSentence !== null && <LoopPace />}
        <IconButton title={t("取消循环 (Esc)")} onClick={clearLoop}>
          <X />
        </IconButton>
      </span>
    </div>
  );
}

/** A compact boundary with ‹ › to move it 0.1 s. */
function Boundary({ label, value, onNudge }: { label: string; value: number; onNudge?: (d: number) => void }) {
  return (
    <span className="flex shrink-0 items-center">
      <span className="mr-1 text-[11px] font-semibold text-loop">{label}</span>
      {onNudge && <Nudge small label={label} d={-0.1} onNudge={onNudge} />}
      <span className="tabular font-mono text-[12px]">{formatPrecise(value)}</span>
      {onNudge && <Nudge small label={label} d={0.1} onNudge={onNudge} />}
    </span>
  );
}

/**
 * On a sentence loop, the pause between times through (跟读停顿 in a loop): "每遍之间停 3.8 秒",
 * opening the deck key's menu; off, the question, which turns it on.
 */
function LoopPace() {
  const pace = useApp(useShallow(paceSettingsOf));
  const rate = useApp((s) => s.settings.rate);
  const length = useApp((s) => (s.loop.a !== null && s.loop.b !== null ? s.loop.b - s.loop.a : 0));
  const open = useApp((s) => s.paceMenu);
  const on = paceActive(pace);
  const { setPace, setPaceMenu } = useApp.getState();
  return (
    <>
      <span className="mx-1 hidden h-3.5 w-px shrink-0 bg-line-strong @[640px]:block" />
      <button
        title={on ? t("跟读停顿的设置") : t("跟读停顿：每遍放完停一下，留时间给你说")}
        // The menu closes on a click outside the deck key; this one toggles it instead.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => (on ? setPaceMenu(!open) : setPace(withPause(pace)))}
        className={`hidden h-[26px] shrink-0 items-center gap-1.5 rounded-[7px] pr-1.5 pl-2 text-[12px] whitespace-nowrap transition-colors duration-150 hover:bg-hover hover:text-fg @[640px]:flex ${on ? "text-fg" : "text-muted"}`}
      >
        <Hourglass size={12} strokeWidth={2} aria-hidden className={on ? "" : "opacity-70"} />
        {betweenPasses(pace, length, rate)}
        {on && <ChevronDown size={11} strokeWidth={2} aria-hidden className="text-muted" />}
      </button>
    </>
  );
}
