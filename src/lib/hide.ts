// 藏字幕: shadowing without reading. Hidden, each sentence is a bar as long as its text (so you
// still see how long it is and where you are); a click shows that one until the track moves on,
// holding H peeks at the one playing. 听完再看 shows a sentence once it has played through.
// Unit-tested in hide.test.ts.
import type { Sentence } from "./api";
import { sentenceIndexAt } from "./sentences";

export type HideMode = "show" | "hide" | "after";
export const HIDE_MODES: HideMode[] = ["show", "hide", "after"];
/** The way to hide that H goes back to (the last one chosen). */
export type HideHow = Exclude<HideMode, "show">;

export const hideModeOf = (v: string): HideMode => (HIDE_MODES.includes(v as HideMode) ? (v as HideMode) : "show");
export const hideHowOf = (v: string): HideHow => (v === "after" ? "after" : "hide");

/** What decides whether one sentence shows while the text is hidden. */
export interface Seen {
  /** The sentence playing (or paused on). */
  active: number;
  /** Clicked to see it. */
  revealed: number | null;
  /** H held down: the active one shows. */
  peek: boolean;
  /** Played through at least once (听完再看). */
  heard: ReadonlySet<number>;
}

/** Whether sentence `i` shows its text. */
export function textShown(mode: HideMode, i: number, seen: Seen): boolean {
  if (mode === "show" || i === seen.revealed || (seen.peek && i === seen.active)) return true;
  return mode === "after" && seen.heard.has(i);
}

/** Code points a character a full em wide: CJK (and kana, radicals), Hangul, compatibility ideographs, fullwidth forms. */
const WIDE: [number, number][] = [
  [0x2e80, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0xff00, 0xff60],
];

/**
 * How wide a hidden sentence's bar is, in em of the text it stands for: a CJK character
 * (or kana) is about 1em, anything else about half. Capped so a long one still fits a line.
 */
export function barWidth(text: string): number {
  let em = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    em += WIDE.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 0.5;
  }
  return Math.max(2, Math.min(32, Math.round(em * 2) / 2));
}

/** A status this close to a sentence's end counts as reaching it (they come about 30 a second). */
const END_REACH = 0.1;
/** Further than this between two statuses is a jump, not playing through. */
const JUMP = 1;

/** Sentences whose end the track played through going from `from` to `to`. */
export function heardBetween(sentences: Sentence[], from: number, to: number): number[] {
  if (!(to > from) || to - from > JUMP) return [];
  const out: number[] = [];
  sentences.forEach((s, i) => {
    if (s.end > from && s.end <= to + END_REACH) out.push(i);
  });
  return out;
}

/** A sentence clicked to see stays shown until the track leaves it (moving from it to another). */
export function leftRevealed(sentences: Sentence[], revealed: number | null, from: number, to: number): boolean {
  if (revealed === null) return false;
  return sentenceIndexAt(sentences, from) === revealed && sentenceIndexAt(sentences, to) !== revealed;
}
