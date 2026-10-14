import { BookOpenText, ChevronLeft, ChevronRight, LoaderCircle, Play, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDismiss } from "../hooks/useDismiss";
import type { ParagraphMode, Reading, ReadingWhat } from "../lib/api";
import { readingNote, readingRange, readingsFor, saidCount, stretchAt, type ReadingScope } from "../lib/readings";
import { sectionIndexOf, sectionName, sectionsOf } from "../lib/sections";
import { sentenceIndexAt } from "../lib/sentences";
import { whenRecorded } from "../lib/takes";
import { useApp } from "../store";
import { Button, IconButton, Kbd } from "./ui";

const MODES: { mode: ParagraphMode; label: string; note: string }[] = [
  { mode: "read", label: "自己读", note: "不放原文，你按自己的速度读；停顿一下，高亮就跳到下一句。" },
  { mode: "shadow", label: "跟着原文读", note: "原文一直往下放，你跟着读（不戴耳机也可以，录进来的原文会被去掉）。" },
];

/** In the list header: start reading a whole paragraph (or the text), with how and how much. */
export function ReadingButton() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), root);
  const busy = useApp((s) => !!s.live || !!s.rec);
  return (
    <div ref={root} className="relative">
      <IconButton title="整段录音 (⇧M)" active={open} disabled={busy} onClick={() => setOpen(!open)}>
        <BookOpenText />
      </IconButton>
      {open && <ReadingMenu onClose={() => setOpen(false)} />}
    </div>
  );
}

function ReadingMenu({ onClose }: { onClose: () => void }) {
  const mode = useApp((s) => s.settings.paragraphMode);
  const sections = useApp((s) => sectionsOf(s.transcript));
  const count = useApp((s) => s.transcript?.sentences.length ?? 0);
  const here = useApp((s) => s.loopSentence ?? Math.max(0, sentenceIndexAt(s.transcript?.sentences ?? [], s.time)));
  const [scope, setScope] = useState<ReadingScope>(sections.length > 1 ? "section" : "all");
  const [first, end] = readingRange(scope, sections, here, count);
  const past = useApp((s) => {
    const list = s.transcript?.sentences;
    return list?.[first] && list[end - 1] ? readingsFor(s.readings, list[first].start, list[end - 1].end).length : 0;
  });
  const { startReading, setParagraphMode, showReading } = useApp.getState();
  const latest = () => {
    const s = useApp.getState();
    const list = s.transcript!.sentences;
    return readingsFor(s.readings, list[first].start, list[end - 1].end).at(-1);
  };
  return (
    <div className="absolute top-full right-0 z-20 mt-1.5 w-[300px] origin-top-right animate-pop-in rounded-[12px] bg-raised p-3 text-[13px] shadow-lift">
      <p className="font-heading text-[14px] font-semibold">整段录音</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted">一口气读完，系统按句子分开保存，读完逐句对比。</p>
      {sections.length > 1 && (
        <Choice
          label="读哪些"
          value={scope}
          options={[
            ["section", sectionName(sections, sectionIndexOf(sections, here))],
            ["all", "全文"],
          ]}
          onChange={(v) => setScope(v as ReadingScope)}
        />
      )}
      <Choice label="怎么读" value={mode} options={MODES.map((m) => [m.mode, m.label])} onChange={(v) => setParagraphMode(v as ParagraphMode)} />
      <p className="mt-1.5 text-[12px] leading-relaxed text-faint">{MODES.find((m) => m.mode === mode)?.note}</p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          primary
          className="h-8 flex-1"
          onClick={() => {
            onClose();
            void startReading({ scope });
          }}
        >
          <span className="size-2 rounded-full bg-danger" />
          开始录 {end - first} 句
        </Button>
        {past > 0 && (
          <Button
            className="h-8"
            title="看上次的整段录音"
            onClick={() => {
              onClose();
              const r = latest();
              if (r) showReading(r.id);
            }}
          >
            上次的
          </Button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-faint">
        快捷键 <Kbd>⇧</Kbd> <Kbd>M</Kbd>
      </p>
    </div>
  );
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <span className="w-12 shrink-0 text-[12px] text-muted">{label}</span>
      <div className="tint flex h-7 min-w-0 flex-1 rounded-[8px] p-0.5" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`min-w-0 flex-1 truncate rounded-[6px] px-2 text-[12px] font-medium transition-[background-color,color] duration-150 ${
              value === v ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Takes the list header's place while a paragraph is being read. */
export function LiveReadingBar() {
  const live = useApp((s) => s.live);
  const { finishReading, cancelReading } = useApp.getState();
  const secs = useClock(live?.phase === "reading" ? live.startedAt : null);
  if (!live) return null;
  const reading = live.phase === "reading";
  const label = live.mode === "read" ? "自己读" : "跟着原文读";
  const at = live.mode === "read" ? live.current : null;
  return (
    <div className="mx-auto w-full max-w-[760px] pr-8 pl-10">
      <div className="flex h-10 items-center gap-3 text-[13px]">
        {live.phase === "starting" || live.phase === "saving" ? (
          <span className="flex items-center gap-2 text-muted">
            <LoaderCircle size={14} className="animate-spin" />
            {live.phase === "starting" ? "正在打开麦克风…" : live.mode === "shadow" ? "正在去掉录进来的原文，按句子分开…" : "正在按句子分开…"}
          </span>
        ) : (
          <>
            <span className="flex shrink-0 items-center gap-1.5 font-medium text-fg">
              <span className="relative grid size-2.5 place-items-center">
                <span className="absolute size-2.5 animate-ping rounded-full bg-danger/50" />
                <span className="size-2 rounded-full bg-danger" />
              </span>
              {label}
            </span>
            {at !== null && (
              <span className="tabular shrink-0 text-[12px] text-muted">
                第 <span className="font-mono text-fg">{at - live.first + 1}</span> / {live.end - live.first} 句
              </span>
            )}
            <Meter levels={live.levels} />
            <span className="tabular w-10 shrink-0 text-right font-mono text-[12px] text-fg">{fmt(secs)}</span>
            <Button className="h-7 px-2.5" title="读完了 (空格)" onClick={() => void finishReading()}>
              <Square size={10} fill="currentColor" strokeWidth={0} /> 读完了
            </Button>
            <button className="shrink-0 text-[12px] text-faint hover:text-fg" onClick={cancelReading}>
              取消
            </button>
          </>
        )}
      </div>
      {reading && (
        <p className="-mt-1 pb-1.5 text-[12px] text-faint">
          {live.mode === "read" ? (
            <>
              停顿一下就跳到下一句，读完最后一句会自动结束 · 高亮不对时按 <Kbd>[</Kbd> <Kbd>]</Kbd> · <Kbd>空格</Kbd> 结束 · <Kbd>Esc</Kbd> 取消
            </>
          ) : (
            <>
              原文放完、你停下就结束 · <Kbd>空格</Kbd> 结束 · <Kbd>Esc</Kbd> 取消
            </>
          )}
        </p>
      )}
    </div>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Seconds since `from` (ms), ticking. */
function useClock(from: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (from === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [from]);
  return from === null ? 0 : Math.max(0, (now - from) / 1000);
}

function Meter({ levels }: { levels: number[] }) {
  const n = 32;
  const bars = [...Array(Math.max(0, n - levels.length)).fill(0), ...levels.slice(-n)] as number[];
  return (
    <span className="flex h-6 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
      {bars.map((v, i) => (
        <span key={i} className="min-w-0 flex-1 rounded-full bg-fg/70" style={{ height: `${Math.max(8, Math.min(1, v * 1.15) ** 2 * 100)}%`, opacity: v < 0.05 ? 0.25 : 1 }} />
      ))}
    </span>
  );
}

/**
 * Above the paragraph once it's been read: your whole reading (each sentence
 * a stretch of the waveform), how it compares, and playing it back — all of
 * you, or sentence by sentence against the original.
 */
export function ReadingCard({ reading }: { reading: Reading }) {
  const all = useApp((s) => s.readings);
  const others = useMemo(() => readingsFor(all, reading.start, reading.end), [all, reading.start, reading.end]);
  const playing = useApp((s) => (s.playingReading?.id === reading.id ? s.playingReading : null));
  const error = useApp((s) => s.readingError);
  const { playReading, stopReadingPlayback, deleteReading, showReading, startReading } = useApp.getState();
  const toggle = (what: ReadingWhat) => (playing?.what === what ? stopReadingPlayback() : void playReading(reading.id, what));
  const i = others.findIndex((r) => r.id === reading.id);
  const said = saidCount(reading);
  const first = useApp((s) => sentenceIndexAt(s.transcript?.sentences ?? [], reading.parts[0]?.start + 0.01));
  const card = useRef<HTMLDivElement>(null);
  // Just read (the list followed you to the end) or picked from the menu: bring it into view.
  useEffect(() => {
    card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [reading.id]);
  return (
    <div ref={card} className="relative mx-2 mt-1 mb-3 scroll-mt-2 animate-fade rounded-[12px] border border-line px-3.5 pt-2.5 pb-3 text-[13px] text-muted">
      <div className="flex h-6 items-center gap-2 pr-7">
        <span className="font-heading text-[14px] font-semibold text-fg">{reading.mode === "read" ? "整段朗读" : "整段跟读"}</span>
        <span className="text-[12px] text-faint">
          {said < reading.parts.length ? `${said} / ${reading.parts.length}` : said} 句
        </span>
        {others.length > 1 && (
          <span className="ml-auto flex items-center gap-0.5 text-[12px]">
            <IconButton title="上一次" disabled={i <= 0} onClick={() => showReading(others[i - 1].id)} className="!h-6 !min-w-6">
              <ChevronLeft />
            </IconButton>
            <span className="tabular whitespace-nowrap">
              第 <span className="font-mono text-fg">{i + 1}</span> / {others.length} 次 · {whenRecorded(reading.created)}
            </span>
            <IconButton title="下一次" disabled={i >= others.length - 1} onClick={() => showReading(others[i + 1].id)} className="!h-6 !min-w-6">
              <ChevronRight />
            </IconButton>
          </span>
        )}
        {others.length <= 1 && <span className="ml-auto text-[12px] text-faint">{whenRecorded(reading.created)}</span>}
      </div>
      <ReadingWave reading={reading} />
      <p className="mt-1 text-[12px] text-faint">{readingNote(reading)}</p>
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
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
      <IconButton title="收起" onClick={() => showReading(null)} className="absolute top-2 right-1.5 !h-6 !min-w-6">
        <X />
      </IconButton>
    </div>
  );
}

/** Your whole reading as one waveform, cut into its sentences; the playing one is lit. */
function ReadingWave({ reading }: { reading: Reading }) {
  const playing = useApp((s) => (s.playingReading?.id === reading.id ? s.playingReading : null));
  const now = playing ? stretchAt(playing, playing.secs) : null;
  const takePlaying = useApp((s) => s.playingTake?.id ?? null);
  const { playTake } = useApp.getState();
  const bars = 180;
  const per = reading.peaks.length / bars;
  const heights = Array.from({ length: bars }, (_, i) => {
    let p = 0;
    for (let k = Math.floor(i * per); k < Math.floor((i + 1) * per); k++) p = Math.max(p, reading.peaks[k] ?? 0);
    return Math.sqrt(p / 255);
  });
  const d = Math.max(0.1, reading.duration);
  const head = playing && playing.what !== "turns" ? playing.secs / d : null;
  return (
    <div className="relative mt-2 h-12 w-full">
      <svg viewBox={`0 0 ${bars} 2`} preserveAspectRatio="none" className="absolute inset-0 size-full text-fg/30" aria-hidden>
        {heights.map((h, i) => (h > 0.02 ? <rect key={i} x={i + 0.15} y={1 - h * 0.92} width={0.7} height={h * 1.84} rx={0.2} fill="currentColor" /> : null))}
      </svg>
      {reading.parts.map((p, k) =>
        p.take ? (
          <button
            key={k}
            title={`第 ${k + 1} 句：听原文和你的`}
            onClick={() => void playTake(p.take!, reading.mode === "read" ? "compare" : "together")}
            className={`absolute inset-y-0 rounded-[4px] border-x border-paper transition-colors duration-150 hover:bg-fg/10 ${now?.part === k || takePlaying === p.take ? "bg-fg/15" : ""}`}
            style={{ left: `${(p.mine[0] / d) * 100}%`, width: `${((p.mine[1] - p.mine[0]) / d) * 100}%` }}
          />
        ) : null,
      )}
      {head !== null && head >= 0 && head <= 1 && (
        <span className="pointer-events-none absolute inset-y-0 w-[1.5px] rounded-full bg-fg" style={{ left: `${head * 100}%` }} />
      )}
    </div>
  );
}

function PlayButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: string }) {
  return (
    <Button title={title} aria-pressed={active} onClick={onClick} className={`h-7 px-2.5 ${active ? "!bg-press" : ""}`}>
      {active ? <Square size={9} fill="currentColor" strokeWidth={0} /> : <Play size={10} fill="currentColor" strokeWidth={0} />}
      {children}
    </Button>
  );
}
