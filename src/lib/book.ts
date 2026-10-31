// 句子本: sentences you got stuck on, from any audio, shadowed again tomorrow, in a week and in a
// month. No ratings or ease factors: said well, it comes back later; still stuck, tomorrow again.
// Days are practice days ("2026-10-31", lib/practice.ts). Unit-tested in book.test.ts.
import type { Sentence } from "./api";
import { t } from "./i18n";

export interface BookEntry {
  id: string;
  /** The audio it's from, as the folder listing names it. */
  audio: string;
  start: number;
  end: number;
  text: string;
  /** Practice day it was added. */
  added: string;
  /** Practice day it comes back; "" once it has been said well each time. */
  due: string;
  /** Times said well in a row. */
  step: number;
}

/** Days until it comes back: after it's added, then after each time it's said well. */
export const INTERVALS = [1, 7, 30];

/** The practice day `n` days after `day`. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

/** A sentence put in the book today: it comes back tomorrow. */
export function newEntry(s: { audio: string; start: number; end: number; text: string }, today: string, id: string): BookEntry {
  return { id, audio: s.audio, start: s.start, end: s.end, text: s.text, added: today, due: addDays(today, INTERVALS[0]), step: 0 };
}

export const isDue = (e: BookEntry, today: string) => e.due !== "" && e.due <= today;

/** What's due today (and missed days), longest waiting first. */
export function dueList(entries: BookEntry[], today: string): BookEntry[] {
  return entries.filter((e) => isDue(e, today)).sort((a, b) => a.due.localeCompare(b.due) || a.added.localeCompare(b.added));
}

/** Said well: it comes back after the next interval, or not at all after the last. */
export function passed(e: BookEntry, today: string): BookEntry {
  const step = e.step + 1;
  return { ...e, step, due: step < INTERVALS.length ? addDays(today, INTERVALS[step]) : "" };
}

/** Still stuck: from the start, tomorrow. */
export function stuck(e: BookEntry, today: string): BookEntry {
  return { ...e, step: 0, due: addDays(today, INTERVALS[0]) };
}

/** A sentence of `audio` already in the book: at the same moment, or the same words (edited timing). */
export function entryFor(entries: BookEntry[], audio: string, s: Pick<Sentence, "start" | "text">): BookEntry | undefined {
  return entries.find((e) => e.audio === audio && (Math.abs(e.start - s.start) < 0.3 || e.text === s.text));
}

/** The entry's sentence in its audio's transcript (which may have been edited since); -1 when it's gone. */
export function sentenceFor(sentences: Sentence[], e: BookEntry): number {
  const same = sentences.findIndex((s) => s.text === e.text);
  if (same >= 0) return same;
  let best = -1;
  sentences.forEach((s, i) => {
    if (Math.abs(s.start - e.start) < 0.6 && (best < 0 || Math.abs(s.start - e.start) < Math.abs(sentences[best].start - e.start))) best = i;
  });
  return best;
}

/** When it comes back, said plainly: "今天", "明天再来", "7 天后再来", "记住了". */
export function dueNote(e: BookEntry, today: string): string {
  if (e.due === "") return t("记住了");
  if (e.due <= today) return t("今天");
  const days = Math.round((Date.parse(e.due) - Date.parse(today)) / 86_400_000);
  return days === 1 ? t("明天再来") : t("{n} 天后再来", { n: days });
}
