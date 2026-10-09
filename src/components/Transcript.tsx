import { FileUp, PenLine, Play, Repeat, Replace, Trash2 } from "lucide-react";
import { memo, useEffect, useRef, useState, type RefObject } from "react";
import type { Sentence } from "../lib/api";
import { sentenceIndexAt, speakerCount, speakerName, startsTurn } from "../lib/sentences";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { ReplaceBar } from "./ReplaceBar";
import { SentenceEditor } from "./SentenceEditor";
import { SentenceText, UnsureCount } from "./SentenceText";
import { IconButton } from "./ui";

/**
 * The script: one row per sentence. The text is selectable; the time on the
 * left turns into a play button, the loop button on the right (or S) repeats
 * the sentence, and the pen (or E) corrects its text.
 */
export function SentenceList() {
  const sentences = useApp((s) => s.transcript?.sentences ?? []);
  const active = useApp((s) => (s.transcript ? sentenceIndexAt(s.transcript.sentences, s.time) : -1));
  const loopSentence = useApp((s) => s.loopSentence);
  const editing = useApp((s) => s.editing?.index ?? null);
  const find = useApp((s) => s.replace?.find ?? "");
  const voices = speakerCount(sentences) > 1;
  const list = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  // Hold the list still while a sentence is corrected or matches are looked through.
  useFollow(list, active, editing !== null || !!find);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <Header scrolled={scrolled} />
      <div
        ref={list}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
        className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]"
      >
        <div className="mx-auto w-full max-w-[760px] px-8 pt-2 pb-12">
          {sentences.map((sentence, i) => (
            <Row
              key={i}
              index={i}
              sentence={sentence}
              active={i === active}
              looping={i === loopSentence}
              editing={i === editing}
              find={find}
              voices={voices}
              turn={voices && startsTurn(sentences, i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Count, voices and where the text came from; a hairline appears once the list scrolls under it. */
function Header({ scrolled }: { scrolled: boolean }) {
  const transcript = useApp((s) => s.transcript);
  const replacing = useApp((s) => !!s.replace);
  const { importTranscript, removeTranscript, openReplace, closeReplace } = useApp.getState();
  if (!transcript) return null;
  const voices = speakerCount(transcript.sentences);
  return (
    <div className={`shrink-0 border-b transition-colors duration-200 ${scrolled ? "border-line" : "border-transparent"}`}>
      <div className="mx-auto flex h-10 w-full max-w-[760px] items-center gap-2 pr-8 pl-10">
        <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-faint" title={`[ ] 换句，S 循环本句 · ${transcript.origin}`}>
          <span className="shrink-0">
            <span className="tabular font-mono text-muted">{transcript.sentences.length}</span> 句
          </span>
          {voices > 1 && (
            <span className="shrink-0">
              · <span className="tabular font-mono text-muted">{voices}</span> 人
            </span>
          )}
          <span className="truncate">· {transcript.origin}</span>
          {transcript.edited && <span className="shrink-0">· 已修改</span>}
          <UnsureCount />
        </p>
        <span className="ml-auto flex shrink-0 gap-0.5">
          <IconButton title="查找和替换 (⌘F)" active={replacing} onClick={() => (replacing ? closeReplace() : openReplace())}>
            <Replace />
          </IconButton>
          <IconButton title="导入其他字幕文件" onClick={() => void importTranscript()}>
            <FileUp />
          </IconButton>
          {transcript.source !== "sidecar" && (
            <IconButton title="移除字幕" onClick={() => void removeTranscript()}>
              <Trash2 />
            </IconButton>
          )}
        </span>
      </div>
      <ReplaceBar />
    </div>
  );
}

/**
 * One sentence. With more than one voice (`voices`), a column names the
 * speaker where their turn starts (`turn`), like a script, and turns get a little air between them.
 */
const Row = memo(function Row({ index, sentence, active, looping, editing, find, voices, turn }: {
  index: number;
  sentence: Sentence;
  active: boolean;
  looping: boolean;
  editing: boolean;
  /** Text to mark in the sentence (from the replace bar). */
  find: string;
  voices: boolean;
  turn: boolean;
}) {
  const { playSentence, toggleSentenceLoop, editSentence } = useApp.getState();
  const tone = looping ? "bg-loop-soft" : active ? "bg-hover" : "hover:bg-hover/60";
  const lit = active || looping;
  const columns = voices ? "grid-cols-[3.25rem_1.75rem_1fr_auto]" : "grid-cols-[3.25rem_1fr_auto]";
  return (
    <div
      data-index={index}
      className={`group grid ${columns} items-start gap-x-2 rounded-[12px] py-2 pr-1.5 pl-2 transition-colors duration-200 [contain-intrinsic-size:auto_48px] [content-visibility:auto] ${tone} ${turn && index > 0 ? "mt-3" : "mt-0.5"}`}
    >
      <div className="flex flex-col items-start">
        <button
          title="从这一句播放"
          onClick={() => playSentence(index)}
          className="relative flex h-[30px] w-full items-center rounded-[6px] text-left"
        >
          <span
            className={`tabular font-mono text-[11px] transition-opacity duration-150 group-hover:opacity-0 ${
              looping ? "text-loop-text" : active ? "text-fg" : "text-faint"
            }`}
          >
            {formatTime(sentence.start)}
          </span>
          <span className="absolute inset-y-0 left-0 grid place-items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <span className="grid size-[22px] place-items-center rounded-full bg-ink text-on-ink">
              <Play size={10} fill="currentColor" strokeWidth={0} className="ml-px" />
            </span>
          </span>
        </button>
        {lit && <Meter sentence={sentence} looping={looping} />}
      </div>
      {voices && (
        <span className="flex h-[30px] items-center">
          {turn && sentence.speaker !== undefined && (
            <span
              title={`说话人 ${speakerName(sentence.speaker)}`}
              className={`tint grid size-5 place-items-center rounded-[5px] font-mono text-[11px] font-medium ${lit ? "text-fg" : "text-muted"}`}
            >
              {speakerName(sentence.speaker)}
            </span>
          )}
        </span>
      )}
      {editing ? (
        <SentenceEditor />
      ) : (
        <p
          className={`cursor-text font-script text-[18px] leading-[30px] break-words select-text transition-colors duration-200 ${
            lit ? "text-fg" : "text-muted"
          }`}
        >
          <SentenceText text={sentence.text} find={find} unsure={sentence.unsure} />
        </p>
      )}
      <span className="flex h-[30px] items-center">
        {!editing && (
          <button
            title="修改这一句 (E)"
            onClick={() => editSentence(index)}
            className="grid size-[28px] place-items-center rounded-[8px] text-muted opacity-0 transition-[opacity,background-color,color,scale] duration-150 group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 active:scale-90"
          >
            <PenLine size={14} strokeWidth={2.1} />
          </button>
        )}
        <button
          title={looping ? "取消循环 (S)" : "循环这一句 (S)"}
          aria-pressed={looping}
          onClick={() => {
            toggleSentenceLoop(index);
            useApp.getState().tip("sentenceLoop");
          }}
          className={`grid size-[28px] place-items-center rounded-[8px] transition-[opacity,background-color,color,scale] duration-150 active:scale-90 ${
            looping
              ? "text-loop hover:bg-loop-soft"
              : "text-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
          }`}
        >
          <Repeat size={14} strokeWidth={2.1} />
        </button>
      </span>
    </div>
  );
});

/** How far through the sentence playback is: a short line under its time. */
function Meter({ sentence, looping }: { sentence: Sentence; looping: boolean }) {
  const ratio = useApp((s) => {
    const span = sentence.end - sentence.start;
    return span > 0 ? Math.round(Math.min(1, Math.max(0, (s.time - sentence.start) / span)) * 60) / 60 : 0;
  });
  return (
    <span className="mt-0.5 h-[2px] w-7 animate-fade overflow-hidden rounded-full bg-track">
      <span
        className={`block h-full origin-left rounded-full transition-[scale] duration-100 ease-linear ${looping ? "bg-loop" : "bg-fg/70"}`}
        style={{ scale: `${ratio} 1` }}
      />
    </span>
  );
}

const PAUSE_AFTER_USER_SCROLL_MS = 3000;

/**
 * Keeps the playing sentence in view, but leaves the list alone while you
 * browse it, or while `paused` (following picks up at the next sentence).
 */
function useFollow(list: RefObject<HTMLDivElement | null>, active: number, paused: boolean) {
  const userScrolledAt = useRef(0);
  const first = useRef(true);
  const hold = useRef(paused);

  useEffect(() => {
    hold.current = paused;
  }, [paused]);

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
    if (!el || active < 0 || hold.current) return;
    if (Date.now() - userScrolledAt.current < PAUSE_AFTER_USER_SCROLL_MS) return;
    /** Scrolls the row into the comfortable band; false when it's already there. */
    const place = (behavior: ScrollBehavior) => {
      const row = el.querySelector<HTMLElement>(`[data-index="${active}"]`);
      if (!row) return false;
      const box = el.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      // Upper part of the list, with room to see what's coming.
      if (r.top >= box.top + box.height * 0.1 && r.bottom <= box.bottom - box.height * 0.4) return false;
      el.scrollTo({ top: el.scrollTop + (r.top - box.top) - box.height * 0.3, behavior });
      return true;
    };
    const jump = first.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    first.current = false;
    if (!place(jump ? "auto" : "smooth") || !jump) return;
    // Rows off screen are laid out at an estimated height (content-visibility)
    // and the first layout may still be settling: hold the row in place while
    // sizes change, until the learner scrolls or it's had a moment to settle.
    const settle = new ResizeObserver(() => {
      if (Date.now() - userScrolledAt.current > PAUSE_AFTER_USER_SCROLL_MS) place("auto");
    });
    settle.observe(el);
    if (el.firstElementChild) settle.observe(el.firstElementChild);
    const stop = window.setTimeout(() => settle.disconnect(), 1500);
    return () => {
      settle.disconnect();
      window.clearTimeout(stop);
    };
  }, [list, active]);
}
