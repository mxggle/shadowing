// A take, the way it goes: 听完再说 is two turns (the original, then you);
// 边听边说 is one (you along with the original, a moment longer for your last
// words, then it stops by itself). 连续录: said again and again, the mic left
// open. Space keeps the time you're on (while the original plays again: the
// one before) and stops; a time with nothing of yours stops it too, keeping
// the one before.
// The card's 连续录 starts one; so does M while the sentence (or the A–B loop)
// loops. 逐句跟读 goes through a paragraph this way, each sentence at most
// `max` times. The store walks this (recordSlice.ts, drillSlice.ts); Rust
// keeps the time before aside (record/rounds.rs).
import type { RecordMode } from "./api";
import { t } from "./i18n";

/** Where a take is, as far as these rules care. */
export interface Turns {
  /** Again and again until you keep one. */
  again: boolean;
  /** Which time through, from 1. */
  n: number;
  /** 逐句跟读: at most this many times, then the next sentence (null: not drilling). */
  max: number | null;
  phase: "starting" | "listening" | "speaking" | "saving";
  /** 边听边说: you speak along with the original (one turn, no "your turn"). */
  along: boolean;
  /** 边听边说: the original has finished, you're on your last words. */
  tail: boolean;
}

/** M records at `at` again and again: that's what is looping. */
export function recordsAgain(at: number | "loop", loopSentence: number | null, looping: boolean): boolean {
  return looping && (at === "loop" || at === loopSentence);
}

/** You've stopped: another time through, or that was the last. */
export const goesAgain = (t: Turns) => t.again && (t.max === null || t.n < t.max);

/**
 * What Space (or the card's button) does: skip the rest of the original (听完再说:
 * on to your turn), keep this time and stop, or keep the one before (again
 * and again, while the original plays again: this time has only begun).
 */
export type Advance = "skip" | "keep" | "keepBefore";

export function advanceOf(t: Turns): Advance {
  const original = t.along ? !t.tail : t.phase === "listening";
  if (original && t.again && t.n > 1) return "keepBefore";
  return original && !t.along ? "skip" : "keep";
}

/** The card's button for it. */
export function advanceLabel(turns: Turns): string {
  const a = advanceOf(turns);
  if (a === "skip") return t("跳过原句");
  if (a === "keepBefore") return t("留下上一遍");
  // 边听边说's first time is kept as far as it got: no "this one" to tell from one before
  // (drilling, that's this sentence done: the bar's 停下 ends the drill).
  if (turns.along) return turns.again && turns.n > 1 ? t("留下这遍") : turns.max === null ? t("停下") : t("下一句");
  return turns.again ? t("留下这遍") : t("说完了");
}

/** Next to 轮到你了 while saying it again and again: 第 3 遍, or 第 2 / 3 遍 drilling. */
export function countOf(turns: Turns): string | null {
  if (!turns.again) return null;
  return turns.max === null ? t("第 {n} 遍", { n: turns.n }) : t("第 {n} / {max} 遍", { n: turns.n, max: turns.max });
}

/** The card's one line while recording: `text`, then (if `space` is set) the Space key and `space`. */
export interface Hint {
  text: string;
  space?: string;
}

export function hintOf(turns: Turns): Hint {
  // What ends a time through: the original (you're along with it), or you.
  const along = turns.along;
  if (turns.again) {
    if (turns.max !== null && turns.n >= turns.max) return { text: along ? t("最后一遍，放完到下一句") : t("最后一遍，说完到下一句") };
    return { text: along ? t("放完自动接下一遍，满意了按") : t("说完自动接下一遍，满意了按"), space: turns.max === null ? "" : t(" 到下一句") };
  }
  if (along) return { text: turns.max === null ? t("放完自动停") : t("放完自动到下一句") };
  if (turns.phase === "listening") return { text: t("听完就轮到你") };
  return { text: turns.max === null ? t("说完会自动停") : t("说完就到下一句") };
}

/** What a time through is like, before the first. */
export function readyNote(mode: RecordMode): string {
  return mode === "shadow" ? t("原句一放就跟着说，放完自动停。") : t("先放一遍原句，然后轮到你说。");
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
  const each = mode === "shadow" ? t("跟着原句说") : t("先放原句再轮到你");
  if (rounds <= 1) return t("一句一句来：{each}，说完就到下一句。", { each });
  return t("一句一句来：{each}，说满 {rounds} 遍自动下一句；满意了按空格直接下一句。每句留下最后一遍。", { each, rounds });
}
