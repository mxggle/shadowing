import { Pause, Play, Repeat, RotateCcw, RotateCw, SkipBack, SkipForward } from "lucide-react";
import { RATE_PRESETS } from "../audio/logic";
import { useFlash } from "../hooks/useFlash";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { useLoopPhase } from "./Loop";
import { PlaybackMenu } from "./PlaybackMenu";
import { Scrubber } from "./Scrubber";
import { RoundButton } from "./ui";

/** Fixed bottom bar: timeline, loop button, transport, speed. Same in every state of the main area. */
export function PlayerBar() {
  const time = useApp((s) => s.time);
  const duration = useApp((s) => s.duration);
  return (
    <footer className="@container shrink-0 border-t border-line px-5 pt-2.5 pb-3">
      <div className="flex items-center gap-3">
        <span className="tabular w-12 font-mono text-[12px] text-muted">{formatTime(time)}</span>
        <div className="min-w-0 flex-1">
          <Scrubber />
        </div>
        <span className="tabular w-12 text-right font-mono text-[12px] text-faint">{formatTime(duration)}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="min-w-0">
          <LoopButton />
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

/** Walks the same cycle as the L key: set A → set B (loop starts) → off. Orange only while a loop exists. */
function LoopButton() {
  const phase = useLoopPhase();
  const loopSentence = useApp((s) => s.loopSentence);
  const hasTrack = useApp((s) => !!s.current);
  const flashing = useFlash("loop");
  const look = {
    idle: { label: "A–B 循环", title: "设起点 A (L)", style: "text-fg ring-1 ring-line ring-inset hover:bg-hover" },
    armed: { label: "设终点 B", title: "设终点 B (L)", style: "bg-loop-soft text-loop-text ring-1 ring-loop/40 ring-inset" },
    active: {
      label: loopSentence === null ? "循环中" : `循环第 ${loopSentence + 1} 句`,
      title: "取消循环 (L)",
      style: "bg-loop text-white hover:brightness-110",
    },
  }[phase];
  return (
    <button
      title={look.title}
      disabled={!hasTrack}
      aria-pressed={phase === "active"}
      onClick={() => useApp.getState().cycleLoop()}
      data-flash={flashing || undefined}
      className={`flex h-8 max-w-full items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-150 ease-snappy active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35 data-[flash]:scale-[0.96] ${look.style}`}
    >
      <Repeat size={15} strokeWidth={2.2} className="shrink-0" />
      <span className="truncate">{look.label}</span>
    </button>
  );
}

function Transport() {
  const hasTrack = useApp((s) => !!s.current);
  const hasTracks = useApp((s) => !!s.folder?.tracks.length);
  const playing = useApp((s) => s.playing);
  const seekStep = useApp((s) => s.settings.seekStep);
  const { toggle, jump, step } = useApp.getState();
  const disabled = !hasTrack;

  return (
    <div className="flex items-center gap-1">
      {/* Track skipping gives way first on a narrow window; ↑ ↓ and the list still do it. */}
      <span className="hidden @[540px]:contents">
        <RoundButton title="上一首 (↑)" flash="prev" disabled={disabled} onClick={() => step(-1)}>
          <SkipBack size={18} fill="currentColor" strokeWidth={1.5} />
        </RoundButton>
      </span>
      <RoundButton title={`后退 ${seekStep} 秒 (←)`} flash="back" disabled={disabled} onClick={() => jump(-1)}>
        <StepIcon icon={RotateCcw} seconds={seekStep} />
      </RoundButton>
      <RoundButton primary title="播放 / 暂停 (空格)" flash="toggle" disabled={!hasTracks} onClick={toggle} className="mx-1.5">
        <span key={playing ? "pause" : "play"} className="grid animate-pop place-items-center">
          {playing ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" strokeWidth={0} className="ml-0.5" />}
        </span>
      </RoundButton>
      <RoundButton title={`前进 ${seekStep} 秒 (→)`} flash="forward" disabled={disabled} onClick={() => jump(1)}>
        <StepIcon icon={RotateCw} seconds={seekStep} />
      </RoundButton>
      <span className="hidden @[540px]:contents">
        <RoundButton title="下一首 (↓)" flash="next" disabled={disabled} onClick={() => step(1)}>
          <SkipForward size={18} fill="currentColor" strokeWidth={1.5} />
        </RoundButton>
      </span>
    </div>
  );
}

/** Rewind/forward arrow with the jump length written inside, like the system podcast controls. */
function StepIcon({ icon: Icon, seconds }: { icon: typeof RotateCcw; seconds: number }) {
  return (
    <span className="relative grid place-items-center">
      <Icon size={24} strokeWidth={1.6} />
      <span className="tabular absolute pt-px text-[9px] font-bold">{seconds}</span>
    </span>
  );
}

/** One-click speeds when the bar is wide enough; the menu next to it always has the fine control. */
function RatePresets() {
  const rate = useApp((s) => s.settings.rate);
  const setRate = useApp((s) => s.setRate);
  return (
    <div className="hidden rounded-lg bg-hover p-0.5 @[640px]:flex" role="group" aria-label="常用速度">
      {RATE_PRESETS.map((p) => {
        const on = Math.abs(rate - p) < 0.001;
        return (
          <button
            key={p}
            aria-pressed={on}
            onClick={() => setRate(p)}
            className={`tabular h-7 rounded-md px-2 font-mono text-[12px] transition-[background-color,color] duration-150 ${
              on ? "bg-elevated text-fg shadow-[0_0_0_1px] shadow-line" : "text-muted hover:text-fg"
            }`}
          >
            {p === 1 ? "1.0" : p}
          </button>
        );
      })}
    </div>
  );
}
