import { ListEnd, Pause, Play, Repeat, RotateCcw, RotateCw, SkipBack, SkipForward } from "lucide-react";
import { useState } from "react";
import { RATE_STEP, SEEK_STEP_MAX, SEEK_STEP_MIN } from "../audio/logic";
import { formatPrecise, formatTime } from "../lib/time";
import { useApp } from "../store";
import { IconButton } from "./Library";
import { Scrubber } from "./Scrubber";

export function PlayerBar() {
  const current = useApp((s) => s.current);
  const playing = useApp((s) => s.playing);
  const time = useApp((s) => s.time);
  const duration = useApp((s) => s.duration);
  const seekStep = useApp((s) => s.settings.seekStep);
  const { toggle, jump, step } = useApp.getState();
  const disabled = !current;

  return (
    <footer className="shrink-0 border-t border-zinc-200 px-5 pb-3 pt-2 dark:border-zinc-800">
      <LoopBoundaries />
      <Scrubber />
      <div className="tabular mt-0.5 grid grid-cols-[1fr_auto_1fr] items-center text-[11px] text-zinc-400">
        <span>{formatTime(time)}</span>
        <SeekStepControl />
        <span className="text-right">{formatTime(duration)}</span>
      </div>
      <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div>
          <LoopButton />
        </div>
        <div className="flex items-center gap-1">
          <IconButton title="上一首 (↑)" disabled={disabled} onClick={() => step(-1)}>
            <SkipBack size={16} />
          </IconButton>
          <IconButton title={`后退 ${seekStep} 秒 (←)`} disabled={disabled} onClick={() => jump(-1)}>
            <RotateCcw size={16} />
          </IconButton>
          <button
            title="播放 / 暂停 (空格)"
            onClick={toggle}
            className="mx-1 flex size-10 items-center justify-center rounded-full bg-accent text-white hover:opacity-90"
          >
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
          </button>
          <IconButton title={`前进 ${seekStep} 秒 (→)`} disabled={disabled} onClick={() => jump(1)}>
            <RotateCw size={16} />
          </IconButton>
          <IconButton title="下一首 (↓)" disabled={disabled} onClick={() => step(1)}>
            <SkipForward size={16} />
          </IconButton>
        </div>
        <div className="flex items-center justify-end gap-2">
          <RateControl />
          <AutoAdvanceToggle />
        </div>
      </div>
    </footer>
  );
}

function LoopButton() {
  const loop = useApp((s) => s.loop);
  const hasTrack = useApp((s) => !!s.current);
  const cycleLoop = useApp((s) => s.cycleLoop);
  const label = loop.a === null ? "A–B" : loop.b === null ? "设 B" : "取消";
  return (
    <IconButton title="A–B 循环 (L)" disabled={!hasTrack} active={loop.a !== null} onClick={cycleLoop}>
      <Repeat size={15} />
      <span className="ml-1 whitespace-nowrap text-xs">{label}</span>
    </IconButton>
  );
}

/** Shown above the progress bar only while a loop is being set or active. */
function LoopBoundaries() {
  const loop = useApp((s) => s.loop);
  const nudgeLoop = useApp((s) => s.nudgeLoop);
  if (loop.a === null) return null;
  const active = loop.b !== null;
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <Boundary label="A" value={loop.a} onNudge={active ? (d) => nudgeLoop("a", d) : undefined} />
      {active ? (
        <Boundary label="B" value={loop.b!} onNudge={(d) => nudgeLoop("b", d)} />
      ) : (
        <span className="text-[11px] text-zinc-400">再按 L 设定 B 点</span>
      )}
    </div>
  );
}

function Boundary({ label, value, onNudge }: { label: string; value: number; onNudge?: (d: number) => void }) {
  return (
    <span className="tabular flex items-center rounded-md bg-zinc-100 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {onNudge && (
        <button className="px-1.5 py-1 hover:text-accent" title={`${label} 提前 0.1 秒`} onClick={() => onNudge(-0.1)}>
          ‹
        </button>
      )}
      <span className={onNudge ? "" : "px-2 py-1"}>
        {label} {formatPrecise(value)}
      </span>
      {onNudge && (
        <button className="px-1.5 py-1 hover:text-accent" title={`${label} 推后 0.1 秒`} onClick={() => onNudge(0.1)}>
          ›
        </button>
      )}
    </span>
  );
}

/**
 * Free-typed step in seconds; saved as you type, tidied up on blur.
 * Lives in the time row: the button row has no spare width at the 720px minimum.
 */
function SeekStepControl() {
  const seekStep = useApp((s) => s.settings.seekStep);
  const setSeekStep = useApp((s) => s.setSeekStep);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label
      title={`快退 / 快进步长（${SEEK_STEP_MIN}–${SEEK_STEP_MAX} 秒）`}
      className="flex items-center gap-1 whitespace-nowrap"
    >
      <span>步长</span>
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
        className="tabular w-7 [appearance:textfield] rounded bg-zinc-100 text-center font-medium text-zinc-700 outline-none focus:ring-1 focus:ring-accent dark:bg-zinc-800 dark:text-zinc-200 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span>秒</span>
    </label>
  );
}

function RateControl() {
  const rate = useApp((s) => s.settings.rate);
  const setRate = useApp((s) => s.setRate);
  return (
    <div className="flex items-center rounded-md bg-zinc-100 text-xs dark:bg-zinc-800">
      <button className="px-2 py-1 text-zinc-500 hover:text-accent" title="减速 (-)" onClick={() => setRate(rate - RATE_STEP)}>
        −
      </button>
      <button className="tabular w-11 py-1 text-center font-medium" title="点击恢复 1.0×" onClick={() => setRate(1)}>
        {rate.toFixed(2)}×
      </button>
      <button className="px-2 py-1 text-zinc-500 hover:text-accent" title="加速 (=)" onClick={() => setRate(rate + RATE_STEP)}>
        +
      </button>
    </div>
  );
}

function AutoAdvanceToggle() {
  const on = useApp((s) => s.settings.autoAdvance);
  const set = useApp((s) => s.setAutoAdvance);
  return (
    <IconButton title={on ? "连续播放：开" : "连续播放：关"} active={on} onClick={() => set(!on)}>
      <ListEnd size={16} />
    </IconButton>
  );
}
