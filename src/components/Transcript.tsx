import { BetweenHorizontalStart, FileUp, FoldVertical, Languages, PenLine, Play, Repeat, Replace, Trash2 } from "lucide-react";
import { Fragment, memo, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type RefObject } from "react";
import type { Sentence, Suggestion } from "../lib/api";
import { explainKey, type Explain } from "../explainSlice";
import { t } from "../lib/i18n";
import { shortcut } from "../lib/platform";
import { sectionIndexOf, sectionsOf } from "../lib/sections";
import { sentenceIndexAt, speakerCount, speakerName, startsTurn } from "../lib/sentences";
import { partAt } from "../lib/readings";
import { sentenceOf, takeCounts } from "../lib/takes";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { ExplainNote } from "./Explain";
import { ProofreadBar, ProofreadButton, SuggestionNote } from "./Proofread";
import { DrillBar } from "./Drill";
import { LiveReadingBar, ReadingButton, ReadingProblem } from "./Reading";
import { ReadingBar } from "./ReadingResult";
import { MicButton, RecorderCard } from "./Recorder";
import { ReplaceBar } from "./ReplaceBar";
import { SentenceEditor } from "./SentenceEditor";
import { SectionHeading, SectionMenu } from "./Sections";
import { hasRuby, SaidText, SentenceText, UnsureCount, useRuby } from "./SentenceText";
import { TakePeek } from "./TakePeek";
import { IconButton } from "./ui";

/**
 * The script: one row per sentence. The text is selectable; the time on the
 * left turns into a play button, the loop button on the right (or S) repeats
 * the sentence, and the pen (or E) corrects its text. A track with more than one
 * section (对话段落) gets a heading above each; any sentence can start a new one.
 */
export function SentenceList() {
  const sentences = useApp((s) => s.transcript?.sentences ?? []);
  // 注音 for sentences not read yet (a new transcript, an edit, another plugin or setting).
  const rubyOn = useApp((s) => s.settings.ruby);
  const plugins = useApp((s) => s.plugins);
  useEffect(() => void useApp.getState().loadRuby(), [sentences, rubyOn, plugins]);
  const active = useApp((s) => {
    if (!s.transcript) return -1;
    // Reading on your own: the sentence you're on; playing a reading or a take back: the one playing.
    if (s.live?.mode === "read" && s.live.phase === "reading") return s.live.current;
    // Listening through your takes: the sentence of the one playing.
    const take = s.playingTake && s.takes.find((t) => t.id === s.playingTake!.id);
    const of = take ? sentenceOf(take, s.transcript.sentences) : -1;
    if (of >= 0) return of;
    const p = s.playingReading;
    const at = p ? partAt(p, p.secs) : null;
    const part = p && at !== null ? s.readings.find((r) => r.id === p.id)?.parts[at] : undefined;
    if (part) return sentenceIndexAt(s.transcript.sentences, part.start + 0.01);
    return sentenceIndexAt(s.transcript.sentences, s.time);
  });
  // The paragraph being read, as plain numbers: the live reading changes with every level (30 a second).
  const readFirst = useApp((s) => (s.live?.phase === "reading" ? s.live.first : -1));
  const readEnd = useApp((s) => (s.live?.phase === "reading" ? s.live.end : -1));
  const reading = readFirst >= 0;
  const shown = useApp((s) => s.readings.find((r) => r.id === s.shownReading) ?? null);
  const shownAt = useMemo(() => (shown ? sentenceIndexAt(sentences, shown.start + 0.01) : -1), [shown, sentences]);
  const loopSentence = useApp((s) => s.loopSentence);
  const editing = useApp((s) => s.editing?.index ?? null);
  const find = useApp((s) => s.replace?.find ?? "");
  const proofread = useApp((s) => s.proofread);
  const suggestions = useMemo(() => {
    const byRow = new Map<number, Suggestion[]>();
    if (proofread?.state === "done") for (const s of proofread.suggestions) byRow.set(s.index, [...(byRow.get(s.index) ?? []), s]);
    return byRow;
  }, [proofread]);
  const path = useApp((s) => s.current?.path);
  const explain = useApp((s) => s.explain);
  const takes = useApp((s) => s.takes);
  const counts = useMemo(() => takeCounts(takes, sentences), [takes, sentences]);
  const recordAt = useApp((s) => s.recordAt);
  // Like lyrics: the sentence playing (or paused on) opens to show your take, if you've recorded it.
  const recording = useApp((s) => !!s.live || !!s.rec);
  const peekAt = !recording && active >= 0 && (counts[active] ?? 0) > 0 ? active : -1;
  const sections = useApp((s) => sectionsOf(s.transcript));
  const headed = sections.length > 1;
  const starts = useMemo(() => new Map(sections.map((x, k) => [x.start, k])), [sections]);
  const activeSection = active < 0 ? -1 : sectionIndexOf(sections, active);
  const voices = speakerCount(sentences) > 1;
  const list = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  // Hold the list still while a sentence is corrected, matches are looked through, or you're recording
  // (going through a paragraph, it follows you).
  const drilling = useApp((s) => !!s.drill);
  useFollow(list, active, !reading && !drilling && (editing !== null || !!find || recordAt !== null));
  // A character at a time while the track itself plays there: not a take or a reading played back, nor reading on your own.
  const lightUp = useApp(
    (s) => s.settings.wordHighlight && !s.playingTake && !s.playingReading && !(s.live?.mode === "read" && s.live.phase === "reading"),
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <Header scrolled={scrolled} />
      <div
        ref={list}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
        className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]"
      >
        <div className="mx-auto w-full max-w-[760px] px-8 pt-2 pb-12">
          {sentences.map((sentence, i) => {
            const k = starts.get(i);
            return (
              <Fragment key={i}>
                {headed && k !== undefined && <SectionHeading k={k} active={k === activeSection} />}
                {i === shownAt && shown && <ReadingBar reading={shown} />}
                <Row
                  index={i}
                  sentence={sentence}
                  active={i === active}
                  said={lightUp && i === active}
                  looping={i === loopSentence}
                  editing={i === editing}
                  find={find}
                  suggestions={suggestions.get(i)}
                  explain={path ? explain[explainKey(path, i, sentence.text)] : undefined}
                  takes={counts[i] ?? 0}
                  reading={reading && i === active && i >= readFirst && i < readEnd}
                  recorder={recordAt === i}
                  peek={i === peekAt}
                  voices={voices}
                  turn={voices && startsTurn(sentences, i)}
                  opensSection={headed && k !== undefined}
                  canSplit={i > 0 && k === undefined}
                  last={i === sentences.length - 1}
                />
              </Fragment>
            );
          })}
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
  const live = useApp((s) => !!s.live);
  const drilling = useApp((s) => !!s.drill);
  if (!transcript) return null;
  if (live || drilling) {
    return <div className="shrink-0 border-b border-line">{live ? <LiveReadingBar /> : <DrillBar />}</div>;
  }
  const voices = speakerCount(transcript.sentences);
  return (
    <div className={`shrink-0 border-b transition-colors duration-200 ${scrolled ? "border-line" : "border-transparent"}`}>
      <div className="mx-auto flex h-10 w-full max-w-[760px] items-center gap-2 pr-8 pl-10">
        <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-faint" title={t("[ ] 换句，S 循环本句 · {origin}", { origin: transcript.origin })}>
          <span className="shrink-0">
            <span className="tabular font-mono text-muted">{transcript.sentences.length}</span> {t("句", { n: transcript.sentences.length })}
          </span>
          {voices > 1 && (
            <span className="shrink-0">
              · <span className="tabular font-mono text-muted">{voices}</span> {t("人", { n: voices })}
            </span>
          )}
          <span className="truncate">· {transcript.origin}</span>
          {transcript.edited && <span className="shrink-0">· {t("已修改")}</span>}
          <UnsureCount />
        </p>
        <SectionMenu />
        <span className="ml-auto flex shrink-0 gap-0.5">
          <IconButton title={t("查找和替换 ({key})", { key: shortcut("⌘F") })} active={replacing} onClick={() => (replacing ? closeReplace() : openReplace())}>
            <Replace />
          </IconButton>
          <ReadingButton />
          <ProofreadButton />
          <IconButton title={t("导入其他字幕文件")} onClick={() => void importTranscript()}>
            <FileUp />
          </IconButton>
          {transcript.source !== "sidecar" && (
            <IconButton title={t("移除字幕")} onClick={() => void removeTranscript()}>
              <Trash2 />
            </IconButton>
          )}
        </span>
      </div>
      <ReplaceBar />
      <ProofreadBar />
      <ReadingProblem />
    </div>
  );
}

/**
 * One sentence. With more than one voice (`voices`), a column names the
 * speaker where their turn starts (`turn`), like a script, and turns get a little air between them.
 */
const Row = memo(function Row({ index, sentence, active, said, looping, editing, find, suggestions, explain, takes, recorder, peek, reading, voices, turn, opensSection, canSplit, last }: {
  index: number;
  sentence: Sentence;
  active: boolean;
  /** Light it up as it's said, where its characters are timed. */
  said: boolean;
  looping: boolean;
  editing: boolean;
  /** Text to mark in the sentence (from the replace bar). */
  find: string;
  /** What the AI proofreading would change in this sentence. */
  suggestions?: Suggestion[];
  /** The note asking the model to explain this sentence, once asked. */
  explain?: Explain;
  /** Recordings of you saying it, and whether its recorder card is open. */
  takes: number;
  recorder: boolean;
  /** Open its latest take under it: the sentence playing, when you've recorded it. */
  peek: boolean;
  /** The sentence being read now, in a paragraph recording. */
  reading: boolean;
  voices: boolean;
  turn: boolean;
  /** First sentence under a section heading (the heading already gives it air). */
  opensSection: boolean;
  /** A new section may start here: not the first sentence, nor one that starts a section already. */
  canSplit: boolean;
  /** The last sentence: nothing after it to join. */
  last: boolean;
}) {
  const { playSentence, toggleSentenceLoop, editSentence, toggleExplain, splitSection, mergeSentence } = useApp.getState();
  const ruby = hasRuby(useRuby(sentence.text));
  const explaining = !!explain?.open;
  const tone = reading ? "bg-danger-soft" : looping ? "bg-loop-soft" : active ? "bg-hover" : "hover:bg-hover/60";
  const lit = active || looping || recorder;
  const columns = voices ? "grid-cols-[3.25rem_1.75rem_1fr_auto]" : "grid-cols-[3.25rem_1fr_auto]";
  return (
    <div
      data-index={index}
      className={`group grid ${columns} items-start gap-x-2 rounded-[12px] py-2 pr-1.5 pl-2 transition-colors duration-200 [contain-intrinsic-size:auto_48px] [content-visibility:auto] ${tone} ${turn && index > 0 && !opensSection ? "mt-3" : "mt-0.5"}`}
    >
      <div className="flex flex-col items-start">
        <button
          title={t("从这一句播放")}
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
              title={t("说话人 {name}", { name: speakerName(sentence.speaker) })}
              className={`tint grid size-5 place-items-center rounded-[5px] font-mono text-[11px] font-medium ${lit ? "text-fg" : "text-muted"}`}
            >
              {speakerName(sentence.speaker)}
            </span>
          )}
        </span>
      )}
      <div className="min-w-0">
        {editing ? (
          <SentenceEditor />
        ) : (
          <p
            className={`cursor-text font-script text-[18px] ${ruby ? "leading-[40px]" : "leading-[30px]"} break-words select-text transition-colors duration-200 ${
              lit ? "text-fg" : "text-muted"
            }`}
          >
            {said ? (
              <SaidText sentence={sentence} find={find} fixes={suggestions?.map((s) => s.from)} />
            ) : (
              <SentenceText text={sentence.text} find={find} unsure={sentence.unsure} fixes={suggestions?.map((s) => s.from)} />
            )}
          </p>
        )}
        {suggestions?.map((s) => <SuggestionNote key={`${s.from}→${s.to}`} suggestion={s} />)}
        {takes > 0 && !recorder && !editing && <TakePeek sentence={sentence} open={peek} />}
      </div>
      <span className="flex h-[30px] items-center">
        <button
          title={explaining ? t("收起解释 (I)") : t("解释这一句 (I)")}
          aria-pressed={explaining}
          onClick={() => toggleExplain(index)}
          className={`grid size-[28px] place-items-center rounded-[8px] transition-[opacity,background-color,color,scale] duration-150 active:scale-90 ${
            explaining ? "bg-press text-fg" : "text-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
          }`}
        >
          <Languages size={14} strokeWidth={2.1} />
        </button>
        {canSplit && !editing && (
          <HoverButton title={t("从这句开始新段")} onClick={() => splitSection(index)}>
            <BetweenHorizontalStart size={14} strokeWidth={2.1} />
          </HoverButton>
        )}
        {!editing && (
          <HoverButton title={t("修改这一句 (E)")} onClick={() => editSentence(index)}>
            <PenLine size={14} strokeWidth={2.1} />
          </HoverButton>
        )}
        {!editing && !last && (
          <HoverButton title={t("与下一句合并")} onClick={() => void mergeSentence(index)}>
            <FoldVertical size={14} strokeWidth={2.1} />
          </HoverButton>
        )}
        <button
          title={looping ? t("取消循环 (S)") : t("循环这一句 (S)")}
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
        <MicButton at={index} count={takes} />
      </span>
      {/* Under the row's actions too: in a narrow column (the picture beside it) they still have room. */}
      {(explain?.open || recorder) && (
        <div className={`min-w-0 ${voices ? "col-[3/-1]" : "col-[2/-1]"}`}>
          {explain?.open && <ExplainNote index={index} entry={explain} />}
          {recorder && <RecorderCard at={index} />}
        </div>
      )}
    </div>
  );
});

/** A row action that shows while the pointer is over the row. */
function HoverButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="grid size-[28px] place-items-center rounded-[8px] text-muted opacity-0 transition-[opacity,background-color,color,scale] duration-150 group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 active:scale-90"
    />
  );
}

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
