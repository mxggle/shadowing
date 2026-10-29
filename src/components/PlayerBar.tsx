import { Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward } from "lucide-react";
import { useState } from "react";
import { useFlash } from "../hooks/useFlash";
import { t } from "../lib/i18n";
import { formatTime } from "../lib/time";
import { playKeyTitle } from "../lib/playKey";
import { sectionName, sectionsOf } from "../lib/sections";
import { playable, playKeyOf, useApp } from "../store";
import { LoopStrip, useLoopPhase } from "./Loop";
import { PaceKey } from "./Pace";
import { PlaybackMenu } from "./PlaybackMenu";
import { Scrubber } from "./Scrubber";
import { DeckButton } from "./ui";
import { useKeys } from "../hooks/useKeys";

/**
 * The deck: (the running loop, with a transcript), timeline, then three
 * zones: practice (the loop key), transport, and how it plays (one settings
 * key with the speed). Same in every state of the main area.
 */
export function PlayerBar() {
  return (
    <footer className="@container shrink-0 border-t border-line bg-deck px-5 pt-2.5 pb-3.5">
      <LoopStrip />
      <Timeline />
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <LoopKey />
          <PaceKey />
        </div>
        <Transport />
        <div className="flex min-w-0 justify-end">
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
        title={remaining ? t("显示总时长") : t("显示剩余时间")}
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
  const loopSection = useApp((s) => (s.loopSection === null ? null : sectionName(sectionsOf(s.transcript), s.loopSection)));
  const hasTrack = useApp((s) => !!s.current && playable(s.current));
  const flashing = useFlash("loop");
  const k = { key: useKeys()("loop") };
  const stop = t("取消循环 ({key})", k);
  const look = {
    idle: { label: t("A–B 循环"), short: "A–B", title: t("听到句首按一下设起点 A ({key})", k) },
    armed: { label: t("设终点 B"), short: t("设 B"), title: t("听到句尾按一下设终点 B ({key})", k) },
    active: loopSection !== null
      ? { label: t("循环{name}", { name: loopSection }), short: loopSection, title: stop }
      : loopSentence === null
        ? { label: t("循环中"), short: t("循环中"), title: stop }
        : { label: t("循环第 {n} 句", { n: loopSentence + 1 }), short: t("第 {n} 句", { n: loopSentence + 1 }), title: stop },
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
      className={`flex h-8 max-w-full min-w-0 items-center gap-2 rounded-[8px] pr-3 pl-[11px] text-[13px] font-medium whitespace-nowrap transition-[background-color,color,scale] duration-150 ease-snappy active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 data-[flash]:scale-[0.96] ${
        {
          idle: "btn text-fg/85 hover:text-fg",
          armed: "text-loop-text outline-1 -outline-offset-1 outline-loop-line outline-dashed hover:bg-loop-soft",
          active: "bg-loop-soft text-loop-text hover:bg-loop/15",
        }[phase]
      }`}
    >
      <Dot phase={phase} />
      <span className="truncate @[640px]:hidden">{look.short}</span>
      <span className="hidden truncate @[640px]:inline">{look.label}</span>
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
  const hasTrack = useApp((s) => !!s.current && playable(s.current));
  // Whatever is going on: a recording or a playback, else the track.
  const running = useApp((s) => playKeyOf(s).running);
  const enabled = useApp((s) => playKeyOf(s).enabled);
  const key = useKeys();
  // Waiting after a sentence (跟读停顿): the key goes on now.
  const waiting = useApp((s) => !!s.paceGap && playKeyOf(s).target === "track");
  const title = useApp((s) => (waiting ? t("马上继续 ({key})", { key: key("toggle") }) : playKeyTitle(playKeyOf(s), key("toggle"))));
  const seekStep = useApp((s) => s.settings.seekStep);
  const { toggle, jump, step } = useApp.getState();
  const disabled = !hasTrack;

  return (
    <div className="flex items-center gap-1">
      {/* Track skipping gives way first on a narrow window; ↑ ↓ and the list still do it. */}
      <span className="hidden @[560px]:contents">
        <DeckButton title={t("上一首 ({key})", { key: key("prevTrack") })} flash="prev" disabled={disabled} onClick={() => step(-1)} className="size-9 rounded-full">
          <SkipBack size={15} fill="currentColor" strokeWidth={1.5} />
        </DeckButton>
      </span>
      <DeckButton title={t("后退 {n} 秒 ({key})", { n: seekStep, key: key("back") })} flash="back" disabled={disabled} onClick={() => jump(-1)} className="size-10 rounded-full">
        <StepIcon icon={RotateCcw} seconds={seekStep} />
      </DeckButton>
      <DeckButton ink title={title} flash="toggle" disabled={!enabled} onClick={toggle} className="mx-1.5 size-11 rounded-full">
        <span key={running ? "pause" : "play"} className="grid animate-pop place-items-center">
          {running ? <Pause size={19} fill="currentColor" strokeWidth={0} /> : <Play size={19} fill="currentColor" strokeWidth={0} className="ml-0.5" />}
        </span>
      </DeckButton>
      <DeckButton title={t("前进 {n} 秒 ({key})", { n: seekStep, key: key("forward") })} flash="forward" disabled={disabled} onClick={() => jump(1)} className="size-10 rounded-full">
        <StepIcon icon={RotateCw} seconds={seekStep} />
      </DeckButton>
      <span className="hidden @[560px]:contents">
        <DeckButton title={t("下一首 ({key})", { key: key("nextTrack") })} flash="next" disabled={disabled} onClick={() => step(1)} className="size-9 rounded-full">
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
