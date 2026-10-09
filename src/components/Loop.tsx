import { X } from "lucide-react";
import { formatPrecise } from "../lib/time";
import { useApp } from "../store";
import { IconButton, Kbd } from "./ui";

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
      第 <span key={repeats} className="inline-block animate-pop">{repeats + 1}</span> 遍
      <span className="text-loop-text/70"> · {length.toFixed(1)} 秒</span>
    </span>
  );
}

const CAPTION = {
  idle: (
    <>
      听到想练的句子开头时按 <Kbd>L</Kbd>，结尾再按一次，这一段就会反复播放。
    </>
  ),
  armed: (
    <>
      起点已设好。听到句尾时按 <Kbd>L</Kbd> 设终点。
    </>
  ),
  active: (
    <>
      ‹ › 把边界移动 0.1 秒。按 <Kbd>L</Kbd> 或 <Kbd>Esc</Kbd> 取消循环。
    </>
  ),
};

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

  return (
    <section className="@container" aria-label="A–B 循环">
      <header className="flex h-7 items-center gap-3">
        <h2 className="text-[13px] font-semibold">A–B 循环</h2>
        {phase === "active" && <PassInfo className="text-[12px]" />}
        {phase !== "idle" && (
          <IconButton className="ml-auto" title="取消循环 (Esc)" onClick={clearLoop}>
            <X size={15} />
          </IconButton>
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
        {CAPTION[phase]}
      </p>
    </section>
  );
}

/**
 * One loop boundary as a readout window set into the page. Empty, it says what
 * pressing L will do; `next` outlines the one L sets next.
 */
function Readout({ label, value, next, onNudge }: {
  label: string;
  value: number | null;
  next: boolean;
  onNudge?: (d: number) => void;
}) {
  const set = value !== null;
  const outline = next ? (label === "B" ? "outline-loop-line" : "outline-line-strong") : "outline-transparent";
  return (
    <div
      className={`well relative flex h-[84px] min-w-0 items-center justify-center rounded-[14px] outline-1 outline-offset-[3px] outline-dashed transition-[outline-color] duration-200 ${outline}`}
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
          按 <Kbd>L</Kbd> 设{label === "A" ? "起点" : "终点"}
        </span>
      )}
    </div>
  );
}

function Nudge({ label, d, onNudge, small }: { label: string; d: number; onNudge: (d: number) => void; small?: boolean }) {
  return (
    <button
      title={`${label} ${d < 0 ? "提前" : "推后"} 0.1 秒`}
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
 * small display window on top of the deck instead.
 */
export function LoopStrip() {
  const phase = useLoopPhase();
  const loop = useApp((s) => s.loop);
  const loopSentence = useApp((s) => s.loopSentence);
  const hasTranscript = useApp((s) => !!s.transcript?.sentences.length);
  const { clearLoop, nudgeLoop } = useApp.getState();
  if (phase === "idle" || !hasTranscript) return null;

  return (
    <div className="well mb-2.5 flex h-9 animate-fade-in items-center gap-3 rounded-[10px] pr-1 pl-3.5">
      <span className="shrink-0 text-[12px] font-medium whitespace-nowrap text-loop-text">
        {loopSentence !== null ? `第 ${loopSentence + 1} 句` : "A–B"}
      </span>
      <span className="h-3.5 w-px shrink-0 bg-line-strong" />
      <Boundary label="A" value={loop.a!} onNudge={phase === "active" ? (d) => nudgeLoop("a", d) : undefined} />
      {phase === "active" ? (
        <Boundary label="B" value={loop.b!} onNudge={(d) => nudgeLoop("b", d)} />
      ) : (
        <span className="flex items-center gap-1.5 text-[12px] whitespace-nowrap text-loop-text">
          按 <Kbd>L</Kbd> 设终点 B
        </span>
      )}
      <span className="ml-auto flex min-w-0 items-center gap-1">
        {phase === "active" && <PassInfo className="truncate text-[11px]" />}
        <IconButton title="取消循环 (Esc)" onClick={clearLoop}>
          <X size={14} />
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
