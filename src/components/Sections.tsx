import { ArrowUpToLine, ChevronDown, Repeat } from "lucide-react";
import { memo, useRef, useState } from "react";
import { useDismiss } from "../hooks/useDismiss";
import type { Sentence, Transcript } from "../lib/api";
import { sectionIndexOf, sectionName, sectionRange, sectionsOf } from "../lib/sections";
import { sentenceIndexAt } from "../lib/sentences";
import { formatTime } from "../lib/time";
import { useApp } from "../store";

const NONE: Sentence[] = [];

/**
 * The line above each section when a track has more than one: its name (click
 * to rename), how long it is, and on hover "loop this section" and "merge into
 * the one above". A hairline runs to the edge, so sections read as chapters
 * without boxing the sentences in.
 */
export const SectionHeading = memo(function SectionHeading({ k, active }: { k: number; active: boolean }) {
  const section = useApp((s) => sectionsOf(s.transcript)[k]);
  const name = useApp((s) => sectionName(sectionsOf(s.transcript), k));
  const [count, secs] = useApp((s) => span(s.transcript, k))
    .split(":")
    .map(Number);
  const looping = useApp((s) => s.loopSection === k);
  const { toggleSectionLoop, mergeSection, renameSection, playSection } = useApp.getState();
  const [editing, setEditing] = useState(false);
  if (!section) return null;
  const tone = looping ? "text-loop-text" : active ? "text-fg" : "text-muted";

  return (
    <div data-section={k} className={`group/section flex h-8 items-center gap-2 pr-1.5 pl-2 ${k === 0 ? "mt-1" : "mt-7"} mb-0.5`}>
      {editing ? (
        <TitleInput
          initial={section.title ?? ""}
          placeholder={`对话 ${k + 1}`}
          onDone={(title) => {
            setEditing(false);
            if (title !== null) renameSection(k, title);
          }}
        />
      ) : (
        <button
          title="点一下改名"
          onClick={() => setEditing(true)}
          className={`max-w-[60%] truncate rounded-[6px] px-1 -mx-1 font-heading text-[14px] font-semibold transition-colors duration-150 hover:bg-hover hover:text-fg ${tone}`}
        >
          {name}
        </button>
      )}
      <button
        title="从这一段开头播放"
        onClick={() => playSection(k)}
        className="shrink-0 rounded-[5px] px-1 text-[11px] text-faint transition-colors duration-150 hover:text-fg"
      >
        <span className="tabular font-mono">{count}</span> 句 · <span className="tabular font-mono">{formatTime(secs)}</span>
      </button>
      <span className={`h-px min-w-6 flex-1 ${looping ? "bg-loop/40" : "bg-line"}`} />
      <span className="flex shrink-0 items-center">
        {k > 0 && (
          <button
            title="合并到上一段"
            onClick={() => mergeSection(k)}
            className="grid size-[26px] place-items-center rounded-[7px] text-muted opacity-0 transition-[opacity,background-color,color,scale] duration-150 group-hover/section:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 active:scale-90"
          >
            <ArrowUpToLine size={14} strokeWidth={2.1} />
          </button>
        )}
        <button
          title={looping ? "取消循环这段 ({ } 换段)" : "循环这段 ({ } 换段)"}
          aria-pressed={looping}
          onClick={() => toggleSectionLoop(k)}
          className={`grid size-[26px] place-items-center rounded-[7px] transition-[opacity,background-color,color,scale] duration-150 active:scale-90 ${
            looping
              ? "text-loop hover:bg-loop-soft"
              : "text-muted opacity-0 group-hover/section:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
          }`}
        >
          <Repeat size={14} strokeWidth={2.1} />
        </button>
      </span>
    </div>
  );
});

/** "sentences:seconds" of section `k`, as one string so the heading only re-renders when it changes. */
function span(transcript: Transcript | null, k: number): string {
  const list = transcript?.sentences ?? [];
  const [first, end] = sectionRange(sectionsOf(transcript), k, list.length);
  return `${end - first}:${end > first ? Math.round(list[end - 1].end - list[first].start) : 0}`;
}

/** Enter or leaving the field keeps the name; Esc leaves it as it was (null). */
function TitleInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (title: string | null) => void }) {
  const done = useRef(false);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };
  return (
    <input
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      maxLength={40}
      aria-label="段落名称"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") {
          e.stopPropagation();
          finish(null);
        }
      }}
      className="tint -mx-1 h-7 w-56 min-w-0 rounded-[6px] px-1.5 font-heading text-[14px] font-semibold text-fg outline-none placeholder:font-normal placeholder:text-faint"
    />
  );
}

/**
 * In the list header when there is more than one section: which one is
 * playing ("对话 2 / 5"); opens a list of all of them to jump to.
 */
export function SectionMenu() {
  const sections = useApp((s) => sectionsOf(s.transcript));
  const sentences = useApp((s) => s.transcript?.sentences ?? NONE);
  const current = useApp((s) => sectionIndexOf(sectionsOf(s.transcript), sentenceIndexAt(s.transcript?.sentences ?? NONE, s.time)));
  const loopSection = useApp((s) => s.loopSection);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), root);
  if (sections.length < 2) return null;

  return (
    <div ref={root} className="relative shrink-0">
      <button
        title="段落：跳到某一段 ({ } 换段)"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex h-6 items-center gap-1 rounded-[6px] pr-1 pl-1.5 text-[12px] transition-colors duration-150 ${
          open ? "bg-press text-fg" : "text-muted hover:bg-hover hover:text-fg"
        }`}
      >
        <span className="max-w-[9rem] truncate">{sectionName(sections, current)}</span>
        <span className="tabular ml-0.5 font-mono text-faint">
          {current + 1}/{sections.length}
        </span>
        <ChevronDown size={12} strokeWidth={2} aria-hidden className={`opacity-60 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="段落"
          className="scrollbar-none absolute top-full left-0 z-20 mt-1.5 max-h-[320px] w-[248px] origin-top-left animate-pop-in overflow-y-auto rounded-[12px] bg-raised p-1 shadow-lift"
        >
          {sections.map((section, k) => {
            const [first, end] = sectionRange(sections, k, sentences.length);
            return (
              <button
                key={section.start}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  useApp.getState().playSection(k);
                }}
                className={`flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150 ${
                  k === current ? "bg-press text-fg" : "text-fg/90 hover:bg-hover"
                }`}
              >
                <span className={`min-w-0 flex-1 truncate ${loopSection === k ? "text-loop-text" : ""}`}>{sectionName(sections, k)}</span>
                <span className="shrink-0 text-[11px] text-faint">
                  <span className="tabular font-mono">{end - first}</span> 句
                </span>
                <span className="tabular w-9 shrink-0 text-right font-mono text-[11px] text-faint">{formatTime(sentences[first]?.start ?? 0)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
