import { Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward } from "lucide-react";
import { useState } from "react";
import { RATE_PRESETS } from "../audio/logic";
import { useFlash } from "../hooks/useFlash";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { LoopStrip, useLoopPhase } from "./Loop";
import { PlaybackMenu } from "./PlaybackMenu";
import { Scrubber } from "./Scrubber";
import { DeckButton } from "./ui";

/**
 * The deck: (the running loop, with a transcript), timeline, loop key,
 * transport, speed. Same in every state of the main area.
 */
export function PlayerBar() {
  return (
    <footer className="@container shrink-0 border-t border-line bg-deck px-5 pt-2.5 pb-3.5">
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
 * Walks the same cycle as the L key: set A → set B (loop starts) → off. The
 * dot shows the state; the button turns orange-tinted while a loop runs.
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
      className={`flex h-9 max-w-full items-center gap-2 rounded-[10px] pr-3.5 pl-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,scale] duration-150 ease-snappy active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 data-[flash]:scale-[0.96] ${
        {
          idle: "btn text-fg/85 hover:text-fg",
          armed: "text-loop-text outline-1 -outline-offset-1 outline-loop-line outline-dashed hover:bg-loop-soft",
          active: "bg-loop-soft text-loop-text hover:bg-loop/15",
        }[phase]
      }`}
    >
      <Dot phase={phase} />
      <span className="truncate">{look.label}</span>
    </button>
  );
}

/** No loop: an empty ring. Waiting for B: an orange ring. Looping: a solid orange dot. Never blinks. */
function Dot({ phase }: { phase: "idle" | "armed" | "active" }) {
  const look = {
    idle: "border-current opacity-45",
    armed: "border-loop",
    active: "border-loop bg-loop",
  }[phase];
  return <span aria-hidden className={`size-2 shrink-0 rounded-full border-[1.5px] transition-[background-color,border-color,opacity] duration-200 ${look}`} />;
}

function Transport() {
  const hasTrack = useApp((s) => !!s.current);
  const hasTracks = useApp((s) => !!s.current || !!s.folder?.tracks.length);
  const playing = useApp((s) => s.playing);
  const seekStep = useApp((s) => s.settings.seekStep);
  const { toggle, jump, step } = useApp.getState();
  const disabled = !hasTrack;

  return (
    <div className="flex items-center gap-1">
      {/* Track skipping gives way first on a narrow window; ↑ ↓ and the list still do it. */}
      <span className="hidden @[560px]:contents">
        <DeckButton title="上一首 (↑)" flash="prev" disabled={disabled} onClick={() => step(-1)} className="size-9 rounded-full">
          <SkipBack size={15} fill="currentColor" strokeWidth={1.5} />
        </DeckButton>
      </span>
      <DeckButton title={`后退 ${seekStep} 秒 (←)`} flash="back" disabled={disabled} onClick={() => jump(-1)} className="size-10 rounded-full">
        <StepIcon icon={RotateCcw} seconds={seekStep} />
      </DeckButton>
      <DeckButton ink title="播放 / 暂停 (空格)" flash="toggle" disabled={!hasTracks} onClick={toggle} className="mx-1.5 size-11 rounded-full">
        <span key={playing ? "pause" : "play"} className="grid animate-pop place-items-center">
          {playing ? <Pause size={19} fill="currentColor" strokeWidth={0} /> : <Play size={19} fill="currentColor" strokeWidth={0} className="ml-0.5" />}
        </span>
      </DeckButton>
      <DeckButton title={`前进 ${seekStep} 秒 (→)`} flash="forward" disabled={disabled} onClick={() => jump(1)} className="size-10 rounded-full">
        <StepIcon icon={RotateCw} seconds={seekStep} />
      </DeckButton>
      <span className="hidden @[560px]:contents">
        <DeckButton title="下一首 (↓)" flash="next" disabled={disabled} onClick={() => step(1)} className="size-9 rounded-full">
          <SkipForward size={15} fill="currentColor" strokeWidth={1.5} />
        </DeckButton>
      </span>
    </div>
  );
}

/** Rewind/forward arrow with the jump length written inside, like the system podcast controls. */
function StepIcon({ icon: Icon, seconds }: { icon: typeof RotateCcw; seconds: number }) {
  return (
    <span className="relative grid place-items-center">
      <Icon size={22} strokeWidth={1.5} />
      <span className="tabular absolute pt-px text-[8.5px] font-semibold tracking-[-0.02em]">{seconds}</span>
    </span>
  );
}

/** One-click speeds as a segmented control; the menu next to it has the fine control. */
function RatePresets() {
  const rate = useApp((s) => s.settings.rate);
  const setRate = useApp((s) => s.setRate);
  return (
    <div className="tint hidden rounded-[10px] p-[3px] @[660px]:flex" role="group" aria-label="常用速度">
      {RATE_PRESETS.map((p) => {
        const on = Math.abs(rate - p) < 0.001;
        return (
          <button
            key={p}
            aria-pressed={on}
            title={`${p.toFixed(2)}×`}
            onClick={() => setRate(p)}
            className={`tabular h-[26px] min-w-[38px] rounded-[7px] px-1.5 font-mono text-[11px] transition-[background-color,color,box-shadow] duration-150 ${
              on ? "bg-raised font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
            }`}
          >
            {p === 1 ? "1.0" : p}
          </button>
        );
      })}
    </div>
  );
}
