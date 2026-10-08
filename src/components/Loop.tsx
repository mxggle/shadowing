import { Repeat, X } from "lucide-react";
import { formatPrecise } from "../lib/time";
import { useApp } from "../store";
import { IconButton, Kbd } from "./ui";

export type LoopPhase = "idle" | "armed" | "active";

export function useLoopPhase(): LoopPhase {
  return useApp((s) => (s.loop.a === null ? "idle" : s.loop.b === null ? "armed" : "active"));
}

/** "第 3 遍 · 4.5 秒": which pass is playing now, and how long one pass is. */
function PassInfo() {
  const repeats = useApp((s) => s.repeats);
  const length = useApp((s) => (s.loop.a !== null && s.loop.b !== null ? s.loop.b - s.loop.a : 0));
  return (
    <span className="tabular font-mono text-[13px] whitespace-nowrap text-loop-text" aria-live="polite">
      第 {repeats + 1} 遍 · {length.toFixed(1)} 秒
    </span>
  );
}

/**
 * Without a transcript the loop is what you're practising, so it gets the
 * main area: large A and B times you can nudge, and the pass counter.
 */
export function LoopPanel() {
  const phase = useLoopPhase();
  const loop = useApp((s) => s.loop);
  const { clearLoop, nudgeLoop } = useApp.getState();

  return (
    <section key={phase} className="@container animate-fade-in">
      <div className="flex h-8 items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-muted">{phase === "active" ? "循环片段" : "A–B 循环"}</h2>
        {phase !== "idle" && (
          <span className="flex items-center gap-2">
            {phase === "active" && <PassInfo />}
            <IconButton title="取消循环 (Esc)" onClick={clearLoop}>
              <X size={15} />
            </IconButton>
          </span>
        )}
      </div>

      {phase === "idle" ? (
        <p className="mt-2 max-w-[32em] text-[15px] leading-relaxed text-muted">
          听到句首按 <Kbd>L</Kbd> 设起点，句尾再按一次，这一段就会反复播放。
        </p>
      ) : (
        <div className="mt-3 flex items-center gap-2 @[480px]:gap-4">
          <Boundary large label="A" value={loop.a!} onNudge={phase === "active" ? (d) => nudgeLoop("a", d) : undefined} />
          <span className="h-px min-w-2 flex-1 bg-line" />
          {phase === "active" ? (
            <Boundary large label="B" value={loop.b!} onNudge={(d) => nudgeLoop("b", d)} />
          ) : (
            <span className="flex h-12 items-center gap-1.5 rounded-lg border border-dashed border-loop/50 px-3 text-[14px] whitespace-nowrap text-loop-text">
              按 <Kbd>L</Kbd> 设终点 B
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/** With a transcript the sentences take the main area; the loop sits in a slim strip above the player bar. */
export function LoopStrip() {
  const phase = useLoopPhase();
  const loop = useApp((s) => s.loop);
  const loopSentence = useApp((s) => s.loopSentence);
  const { clearLoop, nudgeLoop } = useApp.getState();
  if (phase === "idle") return null;

  return (
    <div className="shrink-0 animate-fade-in border-t border-line">
      <div className="mx-auto flex h-11 w-full max-w-[760px] items-center gap-3 px-10">
        <Repeat size={14} strokeWidth={2.2} className="shrink-0 text-loop" />
        <span className="shrink-0 text-[13px] font-medium whitespace-nowrap">
          {loopSentence !== null ? `第 ${loopSentence + 1} 句` : "A–B"}
        </span>
        <Boundary label="A" value={loop.a!} onNudge={phase === "active" ? (d) => nudgeLoop("a", d) : undefined} />
        {phase === "active" ? (
          <Boundary label="B" value={loop.b!} onNudge={(d) => nudgeLoop("b", d)} />
        ) : (
          <span className="text-[13px] whitespace-nowrap text-loop-text">
            按 <Kbd>L</Kbd> 设终点 B
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {phase === "active" && <PassInfo />}
          <IconButton title="取消循环 (Esc)" onClick={clearLoop}>
            <X size={15} />
          </IconButton>
        </span>
      </div>
    </div>
  );
}

/** A loop boundary; with `onNudge` it gets ‹ › buttons that move it by 0.1 s. */
function Boundary({ label, value, onNudge, large }: {
  label: string;
  value: number;
  onNudge?: (d: number) => void;
  large?: boolean;
}) {
  const nudge = (d: number, verb: string) =>
    onNudge && (
      <button
        title={`${label} ${verb} 0.1 秒`}
        onClick={() => onNudge(d)}
        className={`grid place-items-center rounded-md text-muted transition-[background-color,color,scale] duration-150 hover:bg-hover hover:text-fg active:scale-90 ${
          large ? "h-10 w-6 text-lg @[480px]:w-7" : "h-7 w-6"
        }`}
      >
        {d < 0 ? "‹" : "›"}
      </button>
    );
  return (
    <span className="flex shrink-0 items-center">
      {nudge(-0.1, "提前")}
      <span className={`tabular font-mono whitespace-nowrap ${large ? "text-[24px] leading-none font-medium tracking-tight @[480px]:text-[34px]" : "text-[13px]"}`}>
        <span className={`font-sans font-semibold text-loop ${large ? "mr-1.5 text-[15px]" : "mr-1"}`}>{label}</span>
        {formatPrecise(value)}
      </span>
      {nudge(0.1, "推后")}
    </span>
  );
}
