import { ChevronLeft, ChevronRight, Ear, LoaderCircle, Mic, Play, Repeat2, Square, Trash2, X } from "lucide-react";
import { useMemo } from "react";
import { isLoopActive } from "../audio/logic";
import type { RecordMode, Take, TakePart } from "../lib/api";
import { advanceLabel, advanceOf, countOf, hintOf, readyNote, recordsAgain } from "../lib/rounds";
import { comparePart, inTurns, lagNote, paceNote, playheadAt, takesFor, whenRecorded } from "../lib/takes";
import { recordTarget, type Rec, type RecordAt } from "../recordSlice";
import { useApp } from "../store";
import { TakeWaves } from "./TakeWaves";
import { Button, IconButton, Kbd } from "./ui";

/**
 * 跟读录音, under the sentence (or the A–B loop) being practised: while
 * recording, what's happening and what to do; afterwards your take against
 * the original, earlier takes, and 录一遍 / 连续录 (again and again until you
 * keep one, lib/rounds.ts; M is that while it loops).
 */
export function RecorderCard({ at }: { at: RecordAt }) {
  const rec = useApp((s) => (s.rec?.at === at ? s.rec : null));
  const error = useApp((s) => s.recError);
  const start = useApp((s) => recordTarget(s, at)?.start ?? null);
  const end = useApp((s) => recordTarget(s, at)?.end ?? null);
  const all = useApp((s) => s.takes);
  const shown = useApp((s) => s.shownTake);
  const takes = useMemo(() => (start !== null && end !== null ? takesFor(all, start, end) : []), [all, start, end]);
  const take = takes.find((t) => t.id === shown) ?? takes[takes.length - 1];
  const looping = useApp((s) => recordsAgain(at, s.loopSentence, isLoopActive(s.loop)));
  const { closeRecorder } = useApp.getState();

  return (
    <div className="relative mt-1 mb-2 animate-fade rounded-[10px] border border-line px-3 pt-2 pb-2.5 text-[13px] text-muted">
      <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 pr-7">
        <ModeSwitch disabled={!!rec} />
        {!rec && takes.length > 1 && take && <History takes={takes} take={take} />}
      </div>
      <div className="mt-2">
        {rec ? <Live rec={rec} /> : error ? <Problem message={error} at={at} looping={looping} /> : take ? <Result take={take} at={at} looping={looping} /> : <Ready at={at} looping={looping} />}
      </div>
      <IconButton title="收起 (Esc)" onClick={closeRecorder} className="absolute top-2 right-1.5 !h-6 !min-w-6">
        <X />
      </IconButton>
    </div>
  );
}

const MODES: { mode: RecordMode; label: string; title: string }[] = [
  { mode: "listen", label: "听完再说", title: "先听一遍原句，轮到你时再说" },
  { mode: "shadow", label: "边听边说", title: "跟着原句一起说（不戴耳机也可以：录完会自动去掉录进来的原声）" },
];

function ModeSwitch({ disabled }: { disabled: boolean }) {
  const mode = useApp((s) => s.settings.recordMode);
  return (
    <div className="tint flex h-7 rounded-[8px] p-0.5" role="radiogroup" aria-label="跟读方式">
      {MODES.map((m) => (
        <button
          key={m.mode}
          role="radio"
          aria-checked={mode === m.mode}
          title={m.title}
          disabled={disabled}
          onClick={() => useApp.getState().setRecordMode(m.mode)}
          className={`rounded-[6px] px-2.5 text-[12px] font-medium transition-[background-color,color] duration-150 disabled:opacity-50 ${
            mode === m.mode ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** ‹ 第 2 / 3 次 · 5 分钟前 › */
function History({ takes, take }: { takes: Take[]; take: Take }) {
  const i = takes.indexOf(take);
  const { showTake } = useApp.getState();
  return (
    <div className="ml-auto flex items-center gap-0.5 text-[12px]">
      <IconButton title="上一次" disabled={i <= 0} onClick={() => showTake(takes[i - 1].id)} className="!h-6 !min-w-6">
        <ChevronLeft />
      </IconButton>
      <span className="tabular min-w-[8.5rem] text-center whitespace-nowrap">
        第 <span className="font-mono text-fg">{i + 1}</span> / {takes.length} 次 · {whenRecorded(take.created)}
      </span>
      <IconButton title="下一次" disabled={i >= takes.length - 1} onClick={() => showTake(takes[i + 1].id)} className="!h-6 !min-w-6">
        <ChevronRight />
      </IconButton>
    </div>
  );
}

function Ready({ at, looping }: { at: RecordAt; looping: boolean }) {
  const note = useApp((s) => readyNote(s.settings.recordMode));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <RecordButtons at={at} looping={looping} />
      <span>{note}</span>
    </div>
  );
}

/** 录一遍 and 连续录; M is the one that fits: 连续录 while it loops (`looping`). */
function RecordButtons({ at, looping }: { at: RecordAt; looping: boolean }) {
  const { startTake } = useApp.getState();
  return (
    <span className="flex items-center gap-1.5">
      <Button title={looping ? "录一遍" : "录一遍 (M)"} onClick={() => void startTake(at, { again: false })} className="h-7 px-2.5">
        <span className="size-2 rounded-full bg-danger" />
        录一遍
      </Button>
      <Button
        title={`一遍遍接着说，满意了按空格留下${looping ? " (M)" : "（循环这一句时按 M 也是它）"}`}
        onClick={() => void startTake(at, { again: true })}
        className="h-7 px-2.5"
      >
        <Repeat2 size={13} />
        连续录
      </Button>
    </span>
  );
}

function Live({ rec }: { rec: Rec }) {
  const { advanceTake, cancelTake } = useApp.getState();
  if (rec.phase === "starting" || rec.phase === "saving") {
    return (
      <p className="flex h-[52px] items-center gap-2">
        <LoaderCircle size={14} className="shrink-0 animate-spin" />
        {rec.phase === "starting" ? "正在打开麦克风…" : rec.mode === "shadow" ? "正在去掉录进来的原声…" : "正在整理录音…"}
      </p>
    );
  }
  const listening = rec.phase === "listening";
  const label = advanceLabel(rec);
  const count = countOf(rec);
  const hint = hintOf(rec);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-9 items-center gap-3">
        {listening ? (
          <span className="flex items-center gap-1.5 font-medium text-fg">
            <Ear size={15} className="shrink-0" /> 先听原句
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-medium text-fg">
            <span className="relative grid size-2.5 place-items-center">
              <span className="absolute size-2.5 rounded-full bg-danger/25" />
              <span className="size-2 rounded-full bg-danger" />
            </span>
            {rec.along ? "跟着说" : "轮到你了"}
          </span>
        )}
        {count && <span className="tabular -ml-1 text-[12px] whitespace-nowrap text-muted">{count}</span>}
        {listening || rec.along ? <OriginalProgress rec={rec} /> : <Meter levels={rec.levels} />}
        {!listening && !rec.along && <span className="tabular w-10 text-right font-mono text-[12px] text-fg">{rec.secs.toFixed(1)}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button className="h-7 px-2.5" title={`${label} (空格)`} onClick={advanceTake}>
          {advanceOf(rec) !== "skip" && <Square size={10} fill="currentColor" strokeWidth={0} />}
          {label}
        </Button>
        <button title="取消 (Esc)" className="text-[12px] text-faint hover:text-fg" onClick={cancelTake}>
          取消
        </button>
        <span className="ml-auto text-right text-[12px] text-faint" title={rec.mic ? `用「${rec.mic}」录音` : undefined}>
          {hint.text}
          {hint.space !== undefined && (
            <>
              {" "}
              <Kbd>空格</Kbd>
              {hint.space}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/** How far through the original playback is. */
function OriginalProgress({ rec }: { rec: Rec }) {
  const ratio = useApp((s) => Math.round(Math.min(1, Math.max(0, (s.time - rec.start) / (rec.end - rec.start))) * 80) / 80);
  return (
    <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
      <span className="block h-full origin-left rounded-full bg-fg/70 transition-[scale] duration-100 ease-linear" style={{ scale: `${ratio} 1` }} />
    </span>
  );
}

/** Your voice as it comes in: recent levels as bars, newest at the right. */
function Meter({ levels }: { levels: number[] }) {
  const n = 48;
  const bars = [...Array(Math.max(0, n - levels.length)).fill(0), ...levels.slice(-n)] as number[];
  return (
    <span className="flex h-7 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
      {bars.map((v, i) => (
        <span key={i} className="min-w-0 flex-1 rounded-full bg-fg/75" style={{ height: `${Math.max(8, Math.min(1, v * 1.15) ** 2 * 100)}%`, opacity: v < 0.05 ? 0.25 : 1 }} />
      ))}
    </span>
  );
}

function Problem({ message, at, looping }: { message: string; at: RecordAt; looping: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="min-w-0 text-danger">{message}</span>
      <RecordButtons at={at} looping={looping} />
    </div>
  );
}

function Result({ take, at, looping }: { take: Take; at: RecordAt; looping: boolean }) {
  const playing = useApp((s) => (s.playingTake?.id === take.id ? s.playingTake : null));
  const { playTake, stopTake, deleteTake } = useApp.getState();
  const turns = inTurns(take);
  const both: TakePart = comparePart(take);
  const toggle = (what: TakePart) => (playing?.what === what ? stopTake() : void playTake(take.id, what));
  const note = turns ? paceNote(take) : lagNote(take.lagMs, take.bluetooth);
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <TakeWaves take={take} head={playing ? playheadAt(playing.parts, playing.secs) : NOWHERE} onPlay={(lane) => toggle(lane)} playing={playing?.what} />
        {note && <p className="mt-0.5 pl-[3.75rem] text-[12px] text-faint">{note}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        <PlayButton active={playing?.what === both} onClick={() => toggle(both)} title={turns ? "从这句听下去：每句先放原句，再放你的 (P)" : "从这句听下去：原句和你的一起放，听合不合拍 (P)"}>
          {turns ? "对比" : "一起听"}
        </PlayButton>
        <span className="ml-auto flex items-center gap-1">
          <IconButton title="删除这次录音" onClick={() => void deleteTake(take.id)}>
            <Trash2 />
          </IconButton>
          <RecordButtons at={at} looping={looping} />
        </span>
      </div>
    </div>
  );
}

const NOWHERE = { original: null, mine: null };

function PlayButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: string }) {
  return (
    <Button title={title} aria-pressed={active} onClick={onClick} className={`h-7 px-2.5 ${active ? "!bg-press" : ""}`}>
      {active ? <Square size={9} fill="currentColor" strokeWidth={0} /> : <Play size={10} fill="currentColor" strokeWidth={0} />}
      {children}
    </Button>
  );
}

/** The mic on a sentence row (or the loop panel): opens the card; visible while there are takes. */
export function MicButton({ at, count, className = "" }: { at: RecordAt; count: number; className?: string }) {
  const open = useApp((s) => s.recordAt === at);
  const live = useApp((s) => s.rec?.at === at);
  return (
    <button
      title={open ? "收起跟读录音" : count ? `跟读录音（录过 ${count} 次）(M)` : "跟读录音 (M)"}
      aria-pressed={open}
      onClick={() => useApp.getState().toggleRecorder(at)}
      className={`relative grid size-[28px] place-items-center rounded-[8px] transition-[opacity,background-color,color,scale] duration-150 active:scale-90 ${
        live ? "text-danger" : open ? "bg-press text-fg" : count ? "text-muted hover:bg-hover hover:text-fg" : "text-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
      } ${className}`}
    >
      <Mic size={14} strokeWidth={2.1} />
      {count > 0 && !open && (
        <span className="tabular absolute -top-0.5 -right-0.5 min-w-[13px] rounded-full bg-paper px-0.5 text-center font-mono text-[11px] leading-[13px] text-muted">{count}</span>
      )}
    </button>
  );
}
