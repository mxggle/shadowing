// Rules for reading a whole paragraph (整段录音), kept pure for tests: which
// sentences a reading covers, which readings belong to a paragraph, and the
// words that sum one up.
import type { ParagraphMode, Reading, ReadingPlaying, Section, Settings, Take } from "./api";
import { sectionIndexOf, sectionRange } from "./sections";
import { t } from "./i18n";
import { bluetoothLag } from "./takes";

/** How 整段录音 goes: read on your own, along with the original, or 逐句跟读. */
export type ReadingHow = ParagraphMode | "drill";

export const readingHow = (s: Pick<Settings, "paragraphMode" | "paragraphDrill">): ReadingHow => (s.paragraphDrill ? "drill" : s.paragraphMode);

/** The settings that pick `how` (逐句跟读 leaves the other choice as it was). */
export const howSettings = (how: ReadingHow): Partial<Settings> => (how === "drill" ? { paragraphDrill: true } : { paragraphMode: how, paragraphDrill: false });

/** What to read: the section you're in, or the whole text. */
export type ReadingScope = "section" | "all";

/** Sentences [first, end) to read for `scope`, from sentence `current`. */
export function readingRange(scope: ReadingScope, sections: Section[], current: number, count: number): [number, number] {
  if (scope === "all" || sections.length <= 1) return [0, count];
  return sectionRange(sections, sectionIndexOf(sections, Math.max(0, current)), count);
}

/** What a reading was of, to read it again: the whole text, or the section it's in. */
export function scopeOf(reading: Pick<Reading, "start" | "end">, sentences: { start: number; end: number }[]): ReadingScope {
  const first = sentences[0];
  const last = sentences[sentences.length - 1];
  if (!first || !last) return "section";
  const close = (a: number, b: number) => Math.abs(a - b) < 0.6;
  return close(reading.start, first.start) && close(reading.end, last.end) ? "all" : "section";
}

/** Readings of the stretch `start`–`end` (the same paragraph, allowing small edits to its edges), oldest first. */
export function readingsFor(readings: Reading[], start: number, end: number): Reading[] {
  const close = (a: number, b: number) => Math.abs(a - b) < 0.6;
  return readings.filter((r) => close(r.start, start) && close(r.end, end));
}

/** "你 52.3 秒 · 原文 47.0 秒，慢 11%" or, shadowing, the lag. */
export function readingNote(r: Reading): string {
  if (r.mode === "shadow") {
    if (r.lagMs === null) return "";
    if (r.bluetooth) return bluetoothLag();
    return r.lagMs < 80
      ? t("几乎和原声同步", "Almost in sync with the original")
      : t(`平均比原声晚 ${(r.lagMs / 1000).toFixed(2)} 秒`, `On average ${(r.lagMs / 1000).toFixed(2)} s behind the original`);
  }
  const ratio = r.mineSecs / Math.max(0.1, r.originalSecs);
  const times = t(`你 ${r.mineSecs.toFixed(1)} 秒 · 原文 ${r.originalSecs.toFixed(1)} 秒`, `You ${r.mineSecs.toFixed(1)} s · original ${r.originalSecs.toFixed(1)} s`);
  if (ratio > 1.1) return t(`${times}，慢 ${Math.round((ratio - 1) * 100)}%`, `${times}, ${Math.round((ratio - 1) * 100)}% slower`);
  if (ratio < 0.9) return t(`${times}，快 ${Math.round((1 - ratio) * 100)}%`, `${times}, ${Math.round((1 - ratio) * 100)}% faster`);
  return t(`${times}，节奏差不多`, `${times}, similar pace`);
}

/** Sentences read (with a take) out of all of them. */
export const saidCount = (r: Reading) => r.parts.filter((p) => p.take).length;

/** Which sentence of the reading (and on which lane) a playing clip is on `secs` in. */
export function stretchAt(p: Pick<ReadingPlaying, "stretches">, secs: number) {
  return p.stretches.find((s) => secs >= s.clipAt && secs < s.clipAt + s.len) ?? null;
}

/**
 * The sentence (`part`) a playing reading is on: that of the last stretch
 * begun (the first before any), so the pauses between sentences — and yours
 * inside them — keep the sentence just heard.
 */
export function partAt(p: Pick<ReadingPlaying, "stretches">, secs: number): number | null {
  let part = p.stretches[0]?.part ?? null;
  for (const s of p.stretches) if (s.clipAt <= secs) part = s.part;
  return part;
}

/**
 * Where a playing reading is on `take` (the one cut for sentence `part`), lane by
 * lane, in the take's own seconds: its stretches of the clip map onto the take's
 * original and your voice.
 */
export function headOnTake(p: Pick<ReadingPlaying, "stretches">, secs: number, part: number, take: Pick<Take, "original" | "mine">): { original: number | null; mine: number | null } {
  const s = stretchAt(p, secs);
  if (!s || s.part !== part) return { original: null, mine: null };
  const f = Math.min(1, Math.max(0, (secs - s.clipAt) / Math.max(0.01, s.len)));
  const on = ([a, b]: [number, number]) => a + f * (b - a);
  if (s.lane === "original") return { original: on(take.original), mine: null };
  if (s.lane === "mine") return { original: null, mine: on(take.mine) };
  // Both at once (跟着读): one timeline for both voices.
  return { original: on(take.mine), mine: on(take.mine) };
}
