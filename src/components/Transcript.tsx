import { FileUp, Repeat, Trash2 } from "lucide-react";
import { memo, useEffect, useRef, type RefObject } from "react";
import type { Sentence } from "../lib/api";
import { sentenceIndexAt } from "../lib/sentences";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { IconButton } from "./ui";

/** Sentence list: click to play from a sentence, the loop button (or S) repeats it. */
export function SentenceList() {
  const sentences = useApp((s) => s.transcript?.sentences ?? []);
  const active = useApp((s) => (s.transcript ? sentenceIndexAt(s.transcript.sentences, s.time) : -1));
  const loopSentence = useApp((s) => s.loopSentence);
  const list = useRef<HTMLDivElement>(null);
  useFollow(list, active);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <Header />
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[760px] px-8 pb-6">
          {sentences.map((sentence, i) => (
            <Row key={i} index={i} sentence={sentence} active={i === active} looping={i === loopSentence} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Header() {
  const transcript = useApp((s) => s.transcript);
  const { importTranscript, removeTranscript } = useApp.getState();
  if (!transcript) return null;
  return (
    <div className="mx-auto flex h-11 w-full max-w-[760px] shrink-0 items-center gap-2 px-10">
      <span className="min-w-0 truncate text-[12px] text-faint" title={`[ ] 换句，S 循环本句 · ${transcript.origin}`}>
        <span className="tabular font-mono">{transcript.sentences.length}</span> 句 · {transcript.origin}
      </span>
      <span className="ml-auto flex shrink-0 gap-0.5">
        <IconButton title="导入其他字幕文件" onClick={() => void importTranscript()}>
          <FileUp size={15} />
        </IconButton>
        {transcript.source !== "sidecar" && (
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
  const tone = looping ? "bg-loop-soft" : active ? "bg-hover" : "hover:bg-hover";
  return (
    <div
      data-index={index}
      onClick={() => playSentence(index)}
      className={`group grid grid-cols-[3.5rem_1fr_auto] items-start gap-1 rounded-lg py-2 pr-1 pl-2 transition-colors duration-150 [contain-intrinsic-size:auto_48px] [content-visibility:auto] ${tone}`}
    >
      <span className={`tabular pt-[5px] font-mono text-[12px] ${looping ? "text-loop-text" : active ? "text-fg" : "text-faint"}`}>
        {formatTime(sentence.start)}
      </span>
      <p className={`text-[16px] leading-relaxed break-words ${active || looping ? "text-fg" : "text-muted"}`}>{sentence.text}</p>
      <button
        title={looping ? "取消循环 (S)" : "循环这一句 (S)"}
        aria-pressed={looping}
        onClick={(e) => {
          e.stopPropagation();
          toggleSentenceLoop(index);
          useApp.getState().tip("sentenceLoop");
        }}
        className={`grid size-7 place-items-center rounded-md transition-[opacity,background-color,color,scale] duration-150 active:scale-90 ${
          looping ? "text-loop" : "text-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg"
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
