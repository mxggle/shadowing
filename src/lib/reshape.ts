// Rules for changing where sentences begin and end (拆句 / 合并), kept pure for
// tests. Rust makes the change (src-tauri/src/reshape.rs, the same rules for
// sections and text); these keep what the app holds by a sentence's place in
// the list in step, and let the dev mock do the same.
import type { Section, Sentence, Suggestion } from "./api";

/** Sentences [at, at + removed) replaced by `added` new ones. */
export interface Change {
  at: number;
  removed: number;
  added: number;
}

/** Where sentence `i` is now; null for one that was replaced. */
export function movedIndex(i: number, c: Change): number | null {
  if (i < c.at) return i;
  if (i < c.at + c.removed) return null;
  return i + c.added - c.removed;
}

/** What puts back the sentences change `c` replaced: `sentences` in place of the `count` there now, and the sections it ended. */
export interface Undo {
  at: number;
  count: number;
  sentences: Sentence[];
  ended: Section[];
}

/** The undo of change `c` to `sentences` (as they were, in `sections`). */
export const undoOf = (sentences: Sentence[], sections: Section[], c: Change): Undo => ({
  at: c.at,
  count: c.added,
  sentences: sentences.slice(c.at, c.at + c.removed),
  ended: sectionsInside(sections, c.at, c.removed),
});

/** The change an undo makes. */
export const undoChange = (u: Undo): Change => ({ at: u.at, removed: u.count, added: u.sentences.length });

/** `list` with change `c` made: `added` in place of the replaced run. */
export const replaceRun = <T>(list: T[], c: Change, added: T[]): T[] => [...list.slice(0, c.at), ...added, ...list.slice(c.at + c.removed)];

/** Sections after a change: one starting inside the replaced run goes (its sentence is gone), later ones move along. */
export function shiftSections(sections: Section[], c: Change): Section[] {
  return sections.flatMap((s) => {
    const start = s.start <= c.at ? s.start : movedIndex(s.start, c);
    return start === null ? [] : [{ ...s, start }];
  });
}

/** Sections a change of sentences [at, at + count) would end: those starting inside it, after its first. */
export const sectionsInside = (sections: Section[], at: number, count: number) =>
  sections.filter((s) => s.start > at && s.start < at + count);

/**
 * The sections once a cut or join is undone by change `c`: today's (renamed
 * since, perhaps) moved back, with the ones the join ended (`ended`) put back.
 */
export function restoredSections(sections: Section[], c: Change, ended: Section[]): Section[] {
  return [...shiftSections(sections, c), ...ended].sort((a, b) => a.start - b.start);
}

/** Suggestions moved with their sentences; those of the sentences that changed go. */
export function moveSuggestions(suggestions: Suggestion[], c: Change): Suggestion[] {
  return suggestions.flatMap((s) => {
    const index = movedIndex(s.index, c);
    return index === null ? [] : [{ ...s, index }];
  });
}

/** Chinese and Japanese, and their punctuation: written without spaces between words. */
const UNSPACED = /[　-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿＀-￯\u{20000}-\u{3ffff}]/u; // i18n: keep

/** Two sentences' text as one: a space between them, unless either side is written without. */
export function joinText(a: string, b: string): string {
  const last = [...a].at(-1) ?? "";
  const first = [...b][0] ?? "";
  return UNSPACED.test(last) || UNSPACED.test(first) ? a + b : `${a} ${b}`;
}

const WORD = /[\p{L}\p{N}]/u;

/**
 * Text cut at `at` (string offset): both parts trimmed, and where the second
 * began; null unless both parts have words in them (a cut there does nothing).
 */
export function cutText(text: string, at: number): { first: string; second: string; secondFrom: number } | null {
  // Not between the two halves of a character outside the BMP.
  const code = text.charCodeAt(at - 1);
  const k = Math.max(0, Math.min(text.length, code >= 0xd800 && code <= 0xdbff ? at - 1 : at));
  const first = text.slice(0, k).trimEnd();
  const rest = text.slice(k);
  const second = rest.trimStart();
  if (!WORD.test(first) || !WORD.test(second)) return null;
  return { first, second, secondFrom: k + rest.length - second.length };
}

/** How far through the words `first` takes you (spaces and punctuation aren't said). */
export function cutRatio(first: string, second: string): number {
  const said = (s: string) => [...s].filter((c) => WORD.test(c)).length;
  return said(first) / (said(first) + said(second));
}

/** Text as Rust saves a correction: each line trimmed, blank lines dropped, joined by spaces. */
export const cleanText = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");

/** Where the cursor at `caret` in a typed `text` is once it is cleaned up for saving. */
export const caretInClean = (text: string, caret: number) => cleanText(text.slice(0, caret)).length;
