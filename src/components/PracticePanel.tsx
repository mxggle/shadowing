import { ArrowRight, Repeat, X } from "lucide-react";
import { useState } from "react";
import { RATE_STEP, SEEK_STEP_MAX, SEEK_STEP_MIN } from "../audio/logic";
import { useFlash } from "../hooks/useFlash";
import { formatPrecise } from "../lib/time";
import { useApp } from "../store";
import { IconButton, Kbd, Stepper, Switch } from "./ui";

/** The practice settings, grouped in one panel: A–B loop on top, the rest below. */
export function PracticePanel() {
  return (
    <section className="@container rounded-2xl border border-line bg-panel">
      <LoopSection />
      <div className="grid grid-cols-3 divide-x divide-line border-t border-line">
        <Cell label="速度" keys={["−", "="]}>
          <RateControl />
        </Cell>
        <Cell label="跳转步长" keys={["←", "→"]}>
          <SeekStepControl />
        </Cell>
        <Cell label="连续播放">
          <AutoAdvance />
        </Cell>
      </div>
    </section>
  );
}

function Cell({ label, keys, children }: { label: string; keys?: string[]; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 px-3 pt-2.5 pb-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-muted">{label}</span>
        {keys && (
          <span className="flex gap-0.5">
            {keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** One button walks through the same cycle as the L key: set A → set B (loop starts) → off. */
function LoopSection() {
  const loop = useApp((s) => s.loop);
  const hasTrack = useApp((s) => !!s.current);
  const { cycleLoop, clearLoop, nudgeLoop } = useApp.getState();
  const flashing = useFlash("loop");
  const phase = loop.a === null ? "idle" : loop.b === null ? "armed" : "active";

  const button = {
    idle: { label: "A–B 循环", title: "设起点 A (L)", style: "bg-hover text-fg hover:bg-press" },
    armed: { label: "设终点 B", title: "设终点 B (L)", style: "bg-accent-soft text-accent-text ring-1 ring-accent/40 ring-inset" },
    active: { label: "循环中", title: "取消循环 (L)", style: "bg-accent text-white hover:brightness-110" },
  }[phase];

  return (
    <div className="flex min-h-[60px] items-center gap-3 px-3 py-2.5">
      <button
        title={button.title}
        disabled={!hasTrack}
        aria-pressed={phase === "active"}
        onClick={cycleLoop}
        data-flash={flashing || undefined}
        className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-150 ease-snappy active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35 data-[flash]:scale-[0.96] ${button.style}`}
      >
        <Repeat size={15} strokeWidth={2.2} />
        {button.label}
      </button>

      <div key={phase} className="flex min-w-0 flex-1 animate-fade-in items-center gap-1.5">
        {phase === "idle" && (
          <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
            <Kbd>L</Kbd>
            <span className="truncate">句首、句尾各按一次，开始反复播放</span>
          </p>
        )}
        {phase === "armed" && (
          <>
            <Boundary label="A" value={loop.a!} />
            <ArrowRight size={13} className="shrink-0 text-faint" />
            <span className="flex h-7 items-center gap-1 rounded-md border border-dashed border-accent/50 px-2 text-[12px] whitespace-nowrap text-accent-text">
              按 <Kbd>L</Kbd> 设 B
            </span>
          </>
        )}
        {phase === "active" && (
          <>
            <Boundary label="A" value={loop.a!} onNudge={(d) => nudgeLoop("a", d)} />
            <ArrowRight size={13} className="shrink-0 text-faint" />
            <Boundary label="B" value={loop.b!} onNudge={(d) => nudgeLoop("b", d)} />
            <span className="tabular ml-1 hidden text-[11px] whitespace-nowrap text-faint @[470px]:inline">
              {(loop.b! - loop.a!).toFixed(1)} 秒
            </span>
          </>
        )}
      </div>

      {phase !== "idle" && (
        <IconButton title="取消循环 (Esc)" onClick={clearLoop} className="animate-fade">
          <X size={15} />
        </IconButton>
      )}
    </div>
  );
}

function Boundary({ label, value, onNudge }: { label: string; value: number; onNudge?: (d: number) => void }) {
  const nudge = (d: number, verb: string) =>
    onNudge && (
      <button
        title={`${label} ${verb} 0.1 秒`}
        onClick={() => onNudge(d)}
        className="grid h-7 w-6 place-items-center rounded-md text-muted transition-[background-color,color,scale] duration-150 hover:bg-hover hover:text-fg active:scale-90"
      >
        {d < 0 ? "‹" : "›"}
      </button>
    );
  return (
    <span className="tabular flex h-7 shrink-0 items-center rounded-md bg-canvas text-[12px] shadow-[0_0_0_1px] shadow-line">
      {nudge(-0.1, "提前")}
      <span className={`whitespace-nowrap ${onNudge ? "" : "px-2"}`}>
        <span className="mr-1 font-semibold text-accent-text">{label}</span>
        {formatPrecise(value)}
      </span>
      {nudge(0.1, "推后")}
    </span>
  );
}

function RateControl() {
  const rate = useApp((s) => s.settings.rate);
  const setRate = useApp((s) => s.setRate);
  return (
    <Stepper
      decTitle="减速 (−)"
      incTitle="加速 (=)"
      decFlash="slower"
      incFlash="faster"
      onDec={() => setRate(rate - RATE_STEP)}
      onInc={() => setRate(rate + RATE_STEP)}
    >
      <button
        title="点击恢复 1.0×"
        onClick={() => setRate(1)}
        className={`tabular h-8 w-full text-[13px] font-semibold transition-colors ${rate === 1 ? "text-fg" : "text-accent-text"}`}
      >
        {rate.toFixed(2)}×
      </button>
    </Stepper>
  );
}

/** Free-typed step in seconds; saved as you type, tidied up on blur. */
function SeekStepControl() {
  const seekStep = useApp((s) => s.settings.seekStep);
  const setSeekStep = useApp((s) => s.setSeekStep);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Stepper
      decTitle="减少 1 秒"
      incTitle="增加 1 秒"
      onDec={() => setSeekStep(seekStep - 1)}
      onInc={() => setSeekStep(seekStep + 1)}
    >
      <label title={`快退 / 快进的秒数（${SEEK_STEP_MIN}–${SEEK_STEP_MAX}）`} className="flex items-baseline">
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
          className="tabular w-6 [appearance:textfield] rounded bg-transparent text-right text-[13px] font-semibold outline-none focus:bg-canvas focus:ring-1 focus:ring-accent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="ml-0.5 text-[12px] text-muted">秒</span>
      </label>
    </Stepper>
  );
}

function AutoAdvance() {
  const on = useApp((s) => s.settings.autoAdvance);
  const set = useApp((s) => s.setAutoAdvance);
  return (
    <div className="flex h-8 items-center justify-between gap-2">
      <span className="truncate text-[12px] text-muted">{on ? "已开启" : "已关闭"}</span>
      <Switch on={on} onChange={set} label="连续播放" />
    </div>
  );
}
