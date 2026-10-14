import { ChevronLeft, ChevronRight, Play, Square, Trash2, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef } from "react";
import type { Reading, ReadingWhat } from "../lib/api";
import { partHead, readingNote, readingsFor, saidCount } from "../lib/readings";
import { sentenceIndexAt } from "../lib/sentences";
import { comparePart, inTurns, lagNote, paceNote, whenRecorded } from "../lib/takes";
import { useApp } from "../store";
import { Button, IconButton } from "./ui";

/**
 * A paragraph once it's been read, folded into the script: this line above its
 * first sentence (how it went, and playing it back — all of you, or sentence
 * by sentence against the original), and under each sentence your part of it
 * (`ReadingStrip`).
 */
export function ReadingBar({ reading }: { reading: Reading }) {
  const all = useApp((s) => s.readings);
  const others = useMemo(() => readingsFor(all, reading.start, reading.end), [all, reading.start, reading.end]);
  const playing = useApp((s) => (s.playingReading?.id === reading.id ? s.playingReading : null));
  const error = useApp((s) => s.readingError);
  const { playReading, stopReadingPlayback, deleteReading, showReading, startReading } = useApp.getState();
  const toggle = (what: ReadingWhat) => (playing?.what === what ? stopReadingPlayback() : void playReading(reading.id, what));
  const i = others.findIndex((r) => r.id === reading.id);
  const said = saidCount(reading);
  const first = useApp((s) => sentenceIndexAt(s.transcript?.sentences ?? [], reading.parts[0]?.start + 0.01));
  const bar = useRef<HTMLDivElement>(null);
  // Just read (the list followed you to the end) or picked from the menu: bring it into view.
  useEffect(() => {
    bar.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [reading.id]);
  return (
    <div ref={bar} className="mt-1 mb-1 scroll-mt-2 animate-fade pr-1.5 pl-2 text-[12px] text-faint">
      <div className="flex h-7 items-center gap-2">
        <span className="font-heading text-[13px] font-semibold text-fg">{reading.mode === "read" ? "整段朗读" : "整段跟读"}</span>
        <span className="min-w-0 truncate">
          {said < reading.parts.length ? `${said} / ${reading.parts.length}` : said} 句{readingNote(reading) && ` · ${readingNote(reading)}`}
        </span>
        <span className="h-px min-w-4 flex-1 bg-line" />
        {others.length > 1 ? (
          <span className="flex shrink-0 items-center gap-0.5">
            <IconButton title="上一次" disabled={i <= 0} onClick={() => showReading(others[i - 1].id)} className="!h-6 !min-w-6">
              <ChevronLeft />
            </IconButton>
            <span className="tabular whitespace-nowrap">
              第 <span className="font-mono text-muted">{i + 1}</span> / {others.length} 次 · {whenRecorded(reading.created)}
            </span>
            <IconButton title="下一次" disabled={i >= others.length - 1} onClick={() => showReading(others[i + 1].id)} className="!h-6 !min-w-6">
              <ChevronRight />
            </IconButton>
          </span>
        ) : (
          <span className="shrink-0">{whenRecorded(reading.created)}</span>
        )}
        <IconButton title="收起 (Esc)" onClick={() => showReading(null)} className="!h-6 !min-w-6">
          <X />
        </IconButton>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <PlayButton active={playing?.what === "turns"} onClick={() => toggle("turns")} title="每句先放原文，再放你的">
          逐句对比
        </PlayButton>
        <PlayButton active={playing?.what === "mine"} onClick={() => toggle("mine")} title="从头到尾听你读的">
          我的整段
        </PlayButton>
        {reading.mode === "shadow" && (
          <PlayButton active={playing?.what === "together"} onClick={() => toggle("together")} title="原文和你一起放，听合不合拍">
            一起听
          </PlayButton>
        )}
        <span className="ml-auto flex items-center gap-1">
          <IconButton title="删除这次整段录音（连同分出来的每句）" onClick={() => void deleteReading(reading.id)}>
            <Trash2 />
          </IconButton>
          <Button className="h-7 px-2.5" title="再读一遍 (⇧M)" onClick={() => void startReading({ mode: reading.mode, at: first, scope: "section" })}>
            <span className="size-2 rounded-full bg-danger" />
            再读一遍
          </Button>
        </span>
      </div>
      {error && <p className="mt-1 text-danger">{error}</p>}
    </div>
  );
}

/** Bars per second of your voice; a strip is at most this many bars wide. */
const BARS_PER_SEC = 12;
const MAX_BARS = 120;

/**
 * Under a sentence of the paragraph: your part of the reading, drawn to one
 * scale for the whole paragraph (so a long sentence is a long strip), and how
 * it compares. A click plays it against the original; the playhead runs along
 * while the reading plays this sentence of you.
 */
export const ReadingStrip = memo(function ReadingStrip({ reading, part: k }: { reading: Reading; part: number }) {
  const part = reading.parts[k];
  const take = useApp((s) => (part.take ? s.takes.find((t) => t.id === part.take) : undefined));
  const head = useApp((s) => (s.playingReading?.id === reading.id ? partHead(s.playingReading, s.playingReading.secs, k) : null));
  const takePlaying = useApp((s) => !!take && s.playingTake?.id === take.id);
  const longest = useMemo(() => Math.max(1, ...reading.parts.map((p) => p.mine[1] - p.mine[0])), [reading.parts]);
  const [a, b] = part.mine;
  const bars = Math.max(4, Math.min(MAX_BARS, Math.round((b - a) * BARS_PER_SEC)));
  const heights = useMemo(() => {
    const from = a * 50;
    const per = ((b - a) * 50) / bars;
    return Array.from({ length: bars }, (_, i) => {
      let p = 0;
      for (let j = Math.floor(from + i * per); j < Math.floor(from + (i + 1) * per); j++) p = Math.max(p, reading.peaks[j] ?? 0);
      return Math.sqrt(p / 255);
    });
  }, [reading.peaks, a, b, bars]);
  if (!take) return null;
  const { playTake, stopTake } = useApp.getState();
  const note = inTurns(take) ? paceNote(take) : lagNote(take.lagMs);
  const lit = head !== null || takePlaying;
  return (
    <div className="mb-1 flex h-5 items-center gap-3">
      <span className="h-full min-w-0 flex-1">
        <button
          title={takePlaying ? "停" : inTurns(take) ? "听这句：先原文，再你的" : "听这句：原文和你一起"}
          aria-pressed={takePlaying}
          onClick={() => (takePlaying ? stopTake() : void playTake(take.id, comparePart(take)))}
          className={`relative block h-full min-w-8 rounded-[5px] transition-colors duration-150 hover:bg-hover ${lit ? "text-fg/70" : "text-fg/25 hover:text-fg/45"}`}
          style={{ width: `${((b - a) / longest) * 100}%` }}
        >
          <svg viewBox={`0 0 ${bars} 2`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
            {heights.map((h, i) => (h > 0.02 ? <rect key={i} x={i + 0.2} y={1 - h * 0.9} width={0.6} height={h * 1.8} rx={0.2} fill="currentColor" /> : null))}
          </svg>
          {head !== null && <span className="pointer-events-none absolute inset-y-0 w-[1.5px] rounded-full bg-fg" style={{ left: `${head * 100}%` }} />}
        </button>
      </span>
      {note && <span className="shrink-0 text-[12px] text-faint">{note}</span>}
    </div>
  );
});

function PlayButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: string }) {
  return (
    <Button title={title} aria-pressed={active} onClick={onClick} className={`h-7 px-2.5 ${active ? "!bg-press" : ""}`}>
      {active ? <Square size={9} fill="currentColor" strokeWidth={0} /> : <Play size={10} fill="currentColor" strokeWidth={0} />}
      {children}
    </Button>
  );
}
