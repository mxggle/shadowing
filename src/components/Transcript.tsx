import { FileText, FileUp, Repeat, Trash2 } from "lucide-react";
import { memo, useEffect, useRef, type RefObject } from "react";
import { useFlash } from "../hooks/useFlash";
import type { Sentence } from "../lib/api";
import { sentenceIndexAt } from "../lib/sentences";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { IconButton, Kbd } from "./ui";

/** Sentence list: click to play from a sentence, the loop button (or S) repeats it. */
export function SentenceList() {
  const sentences = useApp((s) => s.transcript?.sentences ?? []);
  const active = useApp((s) => (s.transcript ? sentenceIndexAt(s.transcript.sentences, s.time) : -1));
  const loopSentence = useApp((s) => s.loopSentence);
  const list = useRef<HTMLDivElement>(null);
  useFollow(list, active);

  return (
    <section className="@container flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <Header />
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {sentences.map((sentence, i) => (
          <Row key={i} index={i} sentence={sentence} active={i === active} looping={i === loopSentence} />
        ))}
      </div>
    </section>
  );
}

function Header() {
  const transcript = useApp((s) => s.transcript);
  const { importTranscript, removeTranscript } = useApp.getState();
  const prev = useFlash("prevSentence");
  const next = useFlash("nextSentence");
  if (!transcript) return null;
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
      <span className="text-[12px] font-medium">字幕</span>
      <span className="min-w-0 truncate text-[11px] text-faint" title={transcript.origin}>
        {transcript.sentences.length} 句 · {transcript.origin}
      </span>
      <span className="ml-auto hidden shrink-0 items-center gap-1 text-[11px] whitespace-nowrap text-faint @[520px]:flex">
        <span data-flash={prev || undefined} className="transition-[scale] data-[flash]:scale-90">
          <Kbd>[</Kbd>
        </span>
        <span data-flash={next || undefined} className="transition-[scale] data-[flash]:scale-90">
          <Kbd>]</Kbd>
        </span>
        换句
        <Kbd>S</Kbd>
        循环本句
      </span>
      <span className="ml-auto flex shrink-0 gap-0.5 @[520px]:ml-2">
        <IconButton title="导入其他字幕文件" onClick={() => void importTranscript()}>
          <FileUp size={15} />
        </IconButton>
        {transcript.source === "imported" && (
          <IconButton title="移除字幕" onClick={() => void removeTranscript()}>
            <Trash2 size={15} />
          </IconButton>
        )}
      </span>
    </div>
  );
}

const Row = memo(function Row({ index, sentence, active, looping }: {
  index: number;
  sentence: Sentence;
  active: boolean;
  looping: boolean;
}) {
  const { playSentence, toggleSentenceLoop } = useApp.getState();
  const tone = looping
    ? "bg-accent-soft ring-1 ring-accent/40 ring-inset"
    : active
      ? "bg-elevated shadow-[0_0_0_1px] shadow-line"
      : "hover:bg-hover";
  return (
    <div
      data-index={index}
      onClick={() => playSentence(index)}
      className={`group grid grid-cols-[3.25rem_1fr_auto] items-start gap-1 rounded-lg py-1.5 pr-1 pl-2 transition-colors duration-150 [contain-intrinsic-size:auto_44px] [content-visibility:auto] ${tone}`}
    >
      <span className={`tabular pt-[4px] text-[11px] ${active || looping ? "text-accent-text" : "text-faint"}`}>
        {formatTime(sentence.start)}
      </span>
      <p className={`text-[15px] leading-relaxed break-words ${active || looping ? "text-fg" : "text-muted"}`}>{sentence.text}</p>
      <button
        title={looping ? "取消循环 (S)" : "循环这一句 (S)"}
        aria-pressed={looping}
        onClick={(e) => {
          e.stopPropagation();
          toggleSentenceLoop(index);
        }}
        className={`grid size-7 place-items-center rounded-md transition-[opacity,background-color,color,scale] duration-150 active:scale-90 ${
          looping ? "text-accent-text" : "text-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg"
        }`}
      >
        <Repeat size={14} strokeWidth={2.2} />
      </button>
    </div>
  );
});

const PAUSE_AFTER_USER_SCROLL_MS = 3000;

/** Keeps the playing sentence in view, but leaves the list alone while you browse it. */
function useFollow(list: RefObject<HTMLDivElement | null>, active: number) {
  const userScrolledAt = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const mark = () => (userScrolledAt.current = Date.now());
    el.addEventListener("wheel", mark, { passive: true });
    el.addEventListener("touchmove", mark, { passive: true });
    return () => {
      el.removeEventListener("wheel", mark);
      el.removeEventListener("touchmove", mark);
    };
  }, [list]);

  useEffect(() => {
    const el = list.current;
    if (!el || active < 0) return;
    if (Date.now() - userScrolledAt.current < PAUSE_AFTER_USER_SCROLL_MS) return;
    const row = el.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!row) return;
    const box = el.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    // Comfortable band: upper part of the list, with room to see what's coming.
    if (r.top >= box.top + box.height * 0.1 && r.bottom <= box.bottom - box.height * 0.4) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      top: el.scrollTop + (r.top - box.top) - box.height * 0.3,
      behavior: first.current || reduced ? "auto" : "smooth",
    });
    first.current = false;
  }, [list, active]);
}

/** Shown under the practice panel when the track has no transcript yet. */
export function TranscriptEmpty() {
  const hasTrack = useApp((s) => !!s.current);
  const importTranscript = useApp((s) => s.importTranscript);
  if (!hasTrack) return null;
  return (
    <div className="flex animate-fade-in items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3">
      <FileText size={18} className="shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">还没有字幕</p>
        <p className="text-[12px] text-faint">导入 SRT / VTT，或把同名字幕文件放在音频旁边</p>
      </div>
      <button
        onClick={() => void importTranscript()}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-hover px-3 text-[13px] font-medium transition-[background-color,scale] duration-150 ease-snappy hover:bg-press active:scale-[0.96]"
      >
        <FileUp size={15} />
        导入字幕
      </button>
    </div>
  );
}
