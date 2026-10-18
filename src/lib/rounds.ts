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
export function advanceLabel(turn: Turns): string {
  const a = advanceOf(turn);
  if (a === "skip") return t("跳过原句", "Skip Original");
  if (a === "keepBefore") return t("留下上一遍", "Keep Previous Take");
  // 边听边说's first time is kept as far as it got: no "this one" to tell from one before
  // (drilling, that's this sentence done: the bar's 停下 ends the drill).
  if (turn.along) return turn.again && turn.n > 1 ? t("留下这遍", "Keep This Take") : turn.max === null ? t("停下", "Stop") : t("下一句", "Next Sentence");
  return turn.again ? t("留下这遍", "Keep This Take") : t("说完了", "Done Speaking");
}

/** Next to 轮到你了 while saying it again and again: 第 3 遍, or 第 2 / 3 遍 drilling. */
export function countOf(turn: Turns): string | null {
  if (!turn.again) return null;
  return turn.max === null ? t(`第 ${turn.n} 遍`, `Take ${turn.n}`) : t(`第 ${turn.n} / ${turn.max} 遍`, `Take ${turn.n} of ${turn.max}`);
}

/** The card's one line while recording: `text`, then (if `space` is set) the Space key and `space`. */
export interface Hint {
  text: string;
  space?: string;
}

export function hintOf(turn: Turns): Hint {
  // What ends a time through: the original (you're along with it), or you.
  const ends = t(turn.along ? "放完" : "说完", turn.along ? "the original ends" : "you finish");
  if (turn.again) {
    if (turn.max !== null && turn.n >= turn.max) return { text: t(`最后一遍，${ends}到下一句`, `Last take, then the next sentence when ${ends}`) };
    return {
      text: t(`${ends}自动接下一遍，满意了按`, `Next take starts when ${ends}. Happy with it? Press`),
      space: turn.max === null ? "" : t(" 到下一句", " to go to the next sentence"),
    };
  }
  if (turn.along) return { text: turn.max === null ? t("放完自动停", "Stops when the original ends") : t("放完自动到下一句", "Goes on when the original ends") };
  if (turn.phase === "listening") return { text: t("听完就轮到你", "Your turn after listening") };
  return { text: turn.max === null ? t("说完会自动停", "Stops by itself when you finish") : t("说完就到下一句", "Next sentence when you finish") };
}

/** What a time through is like, before the first. */
export function readyNote(mode: RecordMode): string {
  return mode === "shadow"
    ? t("原句一放就跟着说，放完自动停。", "Speak along as the original plays. Stops by itself when it ends.")
    : t("先放一遍原句，然后轮到你说。", "The original plays once, then it’s your turn.");
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
  const each = mode === "shadow" ? t("跟着原句说", "speak along with the original") : t("先放原句再轮到你", "play the original first, then your turn");
  if (rounds <= 1) return t(`一句一句来：${each}，说完就到下一句。`, `One sentence at a time: ${each}. Moves on to the next sentence when you finish.`);
  return t(
    `一句一句来：${each}，说满 ${rounds} 遍自动下一句；满意了按空格直接下一句。每句留下最后一遍。`,
    `One sentence at a time: ${each}. Moves on after ${rounds} takes, or press Space when happy. Each sentence keeps its last take.`,
  );
}
