// 连续录: recording while the sentence (or the A–B loop) loops, it's said again
// and again, each time the take's way (听完再说: the original, then you;
// 边听边说: you along with it), the mic left open. Space keeps the time you're
// on (while the original plays again: the one before) and stops; a time with
// nothing of yours stops it too, keeping the one before. Without a loop a take
// is one time, as always. The store walks this (recordSlice.ts); Rust keeps
// the time before aside (record/rounds.rs).
import type { RecordMode } from "./api";

/** Where a take is, as far as these rules care. */
export interface Turns {
  /** Recording while it loops: again and again until you keep one. */
  again: boolean;
  /** Which time through, from 1. */
  n: number;
  phase: "starting" | "listening" | "speaking" | "saving";
  /** 边听边说 with the original still playing. */
  along: boolean;
}

/** Recording at `at` goes again and again: that's what is looping. */
export function recordsAgain(at: number | "loop", loopSentence: number | null, looping: boolean): boolean {
  return looping && (at === "loop" || at === loopSentence);
}

/** What Space (or the card's button) does: skip the rest of the original, keep this time, or keep the one before. */
export type Advance = "skip" | "keep" | "keepBefore";

export function advanceOf(t: Turns): Advance {
  if (t.phase === "listening" || t.along) return t.again && t.n > 1 ? "keepBefore" : "skip";
  return "keep";
}

/** The card's button for it. */
export function advanceLabel(a: Advance, again: boolean): string {
  if (a === "skip") return "跳过原句";
  if (a === "keepBefore") return "留下上一遍";
  return again ? "留下这遍" : "说完了";
}

/** Next to 轮到你了 while recording again and again: 第 3 遍. */
export const countOf = (t: Turns) => (t.again ? `第 ${t.n} 遍` : null);

/** The one line while recording one time (again and again, the card says how to keep one). */
export function hintOf(t: Turns): string {
  if (t.phase === "listening") return "听完就轮到你";
  return t.along ? "原句放完后，你停下就结束" : "说完会自动停";
}

/** What pressing M will do, in a sentence. */
export function readyNote(mode: RecordMode, again: boolean): string {
  if (again) return mode === "shadow" ? "跟着循环的原句一遍遍说，满意了按空格留下。" : "每遍先放原句再轮到你，一遍遍接着录，满意了按空格留下。";
  return mode === "shadow" ? "原句一放就跟着说。" : "先放一遍原句，然后轮到你说。";
}
