import { Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward } from "lucide-react";
import { useState } from "react";
import { RATE_PRESETS } from "../audio/logic";
import { useFlash } from "../hooks/useFlash";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { LoopStrip, useLoopPhase } from "./Loop";
import { PlaybackMenu } from "./PlaybackMenu";
import { Scrubber } from "./Scrubber";
import { Key } from "./ui";

/**
 * The deck: (the running loop, with a transcript), timeline, loop key,
 * transport, speed. Same in every state of the main area.
 */
export function PlayerBar() {
  return (
    <footer className="@container shrink-0 border-t border-line bg-deck px-5 pt-2.5 pb-3.5 shadow-[inset_0_1px_0_var(--raised)] dark:shadow-[inset_0_1px_0_oklch(100%_0_0/0.04)]">
      <LoopStrip />
      <Timeline />
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="min-w-0">
          <LoopKey />
        </div>
        <Transport />
        <div className="flex min-w-0 items-center justify-end gap-1.5">
          <RatePresets />
          <PlaybackMenu />
        </div>
      </div>
    </footer>
  );
}

/** Elapsed · track · total; click the total to see what's left instead. */
function Timeline() {
  const time = useApp((s) => s.time);
  const duration = useApp((s) => s.duration);
  const [remaining, setRemaining] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <span className="tabular w-[52px] font-mono text-[11px] text-muted">{formatTime(time)}</span>
      <div className="min-w-0 flex-1">
        <Scrubber />
      </div>
      <button
        title={remaining ? "显示总时长" : "显示剩余时间"}
        onClick={() => setRemaining(!remaining)}
        className="tabular w-[52px] rounded text-right font-mono text-[11px] text-faint transition-colors hover:text-muted"
      >
        {remaining ? `−${formatTime(Math.max(0, duration - time))}` : formatTime(duration)}
      </button>
    </div>
  );
}

/**
 * Walks the same cycle as the L key: set A → set B (loop starts) → off. A
 * latching key: it stays down while a loop runs, and its LED lights orange.
 */
function LoopKey() {
  const phase = useLoopPhase();
  const loopSentence = useApp((s) => s.loopSentence);
  const hasTrack = useApp((s) => !!s.current);
  const flashing = useFlash("loop");
  const look = {
    idle: { label: "A–B 循环", title: "听到句首按一下设起点 A (L)" },
    armed: { label: "设终点 B", title: "听到句尾按一下设终点 B (L)" },
    active: { label: loopSentence === null ? "循环中" : `循环第 ${loopSentence + 1} 句`, title: "取消循环 (L)" },
  }[phase];
  return (
    <button
      title={look.title}
      disabled={!hasTrack}
      aria-pressed={phase === "active"}
      onClick={() => {
        useApp.getState().cycleLoop();
        useApp.getState().tip("abLoop");
      }}
      data-flash={flashing || undefined}
      className={`key flex h-9 max-w-full items-center gap-2 rounded-[10px] pr-3.5 pl-3 text-[13px] font-medium whitespace-nowrap disabled:pointer-events-none ${
        phase === "idle" ? "text-fg/85 hover:text-fg" : "text-loop-text"
      }`}
    >
      <Led phase={phase} />
      <span className="truncate">{look.label}</span>
    </button>
  );
}

/** Off: a dark socket. Waiting for B: half lit. Looping: lit. Never blinks. */
function Led({ phase }: { phase: "idle" | "armed" | "active" }) {
  const look = {
    idle: "bg-track shadow-recess",
    armed: "bg-loop/45 shadow-[0_0_0_1px_var(--loop-line)]",
    active: "bg-loop shadow-[var(--led-glow)]",
  }[phase];
  return <span aria-hidden className={`size-[7px] shrink-0 rounded-full transition-[background-color,box-shadow] duration-200 ${look}`} />;
}

function Transport() {
  const hasTrack = useApp((s) => !!s.current);
  const hasTracks = useApp((s) => !!s.current || !!s.folder?.tracks.length);
  const playing = useApp((s) => s.playing);
  const seekStep = useApp((s) => s.settings.seekStep);
  const { toggle, jump, step } = useApp.getState();
  const disabled = !hasTrack;

  return (
    <div className="flex items-center gap-2">
      {/* Track skipping gives way first on a narrow window; ↑ ↓ and the list still do it. */}
      <span className="hidden @[560px]:contents">
        <Key title="上一首 (↑)" flash="prev" disabled={disabled} onClick={() => step(-1)} className="size-8 rounded-[9px]">
          <SkipBack size={14} fill="currentColor" strokeWidth={1.5} />
        </Key>
      </span>
      <Key title={`后退 ${seekStep} 秒 (←)`} flash="back" disabled={disabled} onClick={() => jump(-1)} className="size-9 rounded-[10px]">
        <StepIcon icon={RotateCcw} seconds={seekStep} />
      </Key>
      <Key ink title="播放 / 暂停 (空格)" flash="toggle" disabled={!hasTracks} onClick={toggle} className="mx-1 h-11 w-[52px] rounded-[13px]">
        <span key={playing ? "pause" : "play"} className="grid animate-pop place-items-center">
          {playing ? <Pause size={19} fill="currentColor" strokeWidth={0} /> : <Play size={19} fill="currentColor" strokeWidth={0} className="ml-0.5" />}
        </span>
      </Key>
      <Key title={`前进 ${seekStep} 秒 (→)`} flash="forward" disabled={disabled} onClick={() => jump(1)} className="size-9 rounded-[10px]">
        <StepIcon icon={RotateCw} seconds={seekStep} />
      </Key>
      <span className="hidden @[560px]:contents">
        <Key title="下一首 (↓)" flash="next" disabled={disabled} onClick={() => step(1)} className="size-8 rounded-[9px]">
          <SkipForward size={14} fill="currentColor" strokeWidth={1.5} />
        </Key>
      </span>
    </div>
  );
}

/** Rewind/forward arrow with the jump length written inside, like the system podcast controls. */
function StepIcon({ icon: Icon, seconds }: { icon: typeof RotateCcw; seconds: number }) {
  return (
    <span className="relative grid place-items-center">
      <Icon size={21} strokeWidth={1.5} />
      <span className="tabular absolute pt-px text-[8.5px] font-semibold tracking-[-0.02em]">{seconds}</span>
    </span>
  );
}

/** One-click speeds as a selector set into the deck; the menu next to it has the fine control. */
function RatePresets() {
  const rate = useApp((s) => s.settings.rate);
  const setRate = useApp((s) => s.setRate);
  return (
    <div className="well hidden rounded-[10px] p-[3px] @[660px]:flex" role="group" aria-label="常用速度">
      {RATE_PRESETS.map((p) => {
        const on = Math.abs(rate - p) < 0.001;
        return (
          <button
            key={p}
            aria-pressed={on}
            title={`${p.toFixed(2)}×`}
            onClick={() => setRate(p)}
            className={`tabular h-[26px] min-w-[38px] rounded-[7px] px-1.5 font-mono text-[11px] transition-[background-color,color,box-shadow] duration-150 ${
              on ? "bg-raised font-medium text-fg shadow-cap" : "text-muted hover:text-fg"
            }`}
          >
            {p === 1 ? "1.0" : p}
          </button>
        );
      })}
    </div>
  );
}
