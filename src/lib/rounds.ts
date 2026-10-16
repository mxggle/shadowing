// 连续录: a take said again and again, each time the take's way (听完再说: the
// original, then you; 边听边说: you along with it), the mic left open. Space
// keeps the time you're on (while the original plays again: the one before)
// and stops; a time with nothing of yours stops it too, keeping the one before.
// The card's 连续录 starts one; so does M while the sentence (or the A–B loop)
// loops. 逐句跟读 goes through a paragraph this way, each sentence at most
// `max` times. The store walks this (recordSlice.ts, drillSlice.ts); Rust
// keeps the time before aside (record/rounds.rs).
import type { RecordMode } from "./api";

/** Where a take is, as far as these rules care. */
export interface Turns {
  /** Again and again until you keep one. */
  again: boolean;
  /** Which time through, from 1. */
  n: number;
  /** 逐句跟读: at most this many times, then the next sentence (null: not drilling). */
  max: number | null;
  phase: "starting" | "listening" | "speaking" | "saving";
  /** 边听边说 with the original still playing. */
  along: boolean;
}

/** M records at `at` again and again: that's what is looping. */
export function recordsAgain(at: number | "loop", loopSentence: number | null, looping: boolean): boolean {
  return looping && (at === "loop" || at === loopSentence);
}

/** You've stopped: another time through, or that was the last. */
export const goesAgain = (t: Turns) => t.again && (t.max === null || t.n < t.max);

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

/** Next to 轮到你了 while saying it again and again: 第 3 遍, or 第 2 / 3 遍 drilling. */
export function countOf(t: Turns): string | null {
  if (!t.again) return null;
  return t.max === null ? `第 ${t.n} 遍` : `第 ${t.n} / ${t.max} 遍`;
}

/** The one line while recording one time (again and again, the card says how to keep one). */
export function hintOf(t: Turns): string {
  if (t.phase === "listening") return "听完就轮到你";
  const then = t.max === null ? "结束" : "到下一句";
  return t.along ? `原句放完后，你停下就${then}` : t.max === null ? "说完会自动停" : "说完就到下一句";
}

/** What a time through is like, before the first. */
export function readyNote(mode: RecordMode): string {
  return mode === "shadow" ? "原句一放就跟着说。" : "先放一遍原句，然后轮到你说。";
}

/** 逐句跟读: at least once, at most 20 times a sentence. */
export const ROUNDS_MIN = 1;
export const ROUNDS_MAX = 20;

export const clampRounds = (n: number) => Math.min(ROUNDS_MAX, Math.max(ROUNDS_MIN, Math.round(n) || ROUNDS_MIN));

/** What's typed in 每句几遍: a whole number in range, or null (say so, keep the last good one). */
export function parseRounds(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= ROUNDS_MIN && n <= ROUNDS_MAX ? n : null;
}

/** The 整段录音 menu's line for 逐句跟读. */
export function drillNote(mode: RecordMode, rounds: number): string {
  const each = mode === "shadow" ? "跟着原句说" : "先放原句再轮到你";
  if (rounds <= 1) return `一句一句来：${each}，说完就到下一句。`;
  return `一句一句来：${each}，说满 ${rounds} 遍自动下一句；满意了按空格直接下一句。每句留下最后一遍。`;
}
