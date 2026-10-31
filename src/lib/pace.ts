// 跟读停顿: with a transcript, the track plays one sentence at a time — each a few times if you
// like — and waits after each so you can say it, like a 复读机. The engine plays one stretch
// exactly (player_play_range stops on the frame); these rules pick the stretch, the pause after it
// and what comes next. Inside an A–B, sentence or section loop the stretches are its sentences and
// the last one goes back to the loop's start. Unit-tested in pace.test.ts.
import { isLoopActive, type Loop } from "../audio/logic";
import type { Sentence } from "./api";
import { t, tk } from "./i18n";
import { sentenceStart } from "./sentences";

/** After each time through: as long as the sentence (three lengths), a few seconds (0 = none), or until you go on. */
export type PauseMode = "length" | "fixed" | "wait";
export const PAUSE_MODES: PauseMode[] = ["length", "fixed", "wait"];
/** How long a pause by length is: three steps, or the older free ratio (`pauseRatio`). */
export type PauseLength = "short" | "standard" | "long" | "custom";
export const PAUSE_LENGTHS: Exclude<PauseLength, "custom">[] = ["short", "standard", "long"];
/** What a "wait" pause waits for: a key, or for you to finish saying it (the mic listens). */
export type PauseWait = "key" | "voice";

export interface PaceSettings {
  paceOn: boolean;
  pauseMode: PauseMode;
  pauseLength: PauseLength;
  pauseSeconds: number;
  pauseRatio: number;
  pauseWait: PauseWait;
  sentenceRepeats: number;
}

export const SECONDS_MIN = 0;
export const SECONDS_MAX = 30;
export const SECONDS_STEP = 0.5;
/** One tap for the pauses people ask for: a breath, saying it, writing it down. */
export const QUICK_SECONDS = [1, 2, 3, 5];
export const RATIO_MIN = 0.5;
export const RATIO_MAX = 4;
export const RATIO_STEP = 0.25;
export const REPEATS_MAX = 10;
/** The ratio every pause by length had before the three steps: a learner still on it gets 标准. */
const OLD_DEFAULT_RATIO = 1.5;
/** A free ratio's pause is never shorter than this, so a two-word sentence still leaves time to start. */
const LENGTH_FLOOR = 1;
/** Each step: the sentence as heard × a ratio, plus a moment to start talking. */
const STEPS: Record<Exclude<PauseLength, "custom">, [number, number]> = {
  short: [0.75, 0.5],
  standard: [1, 1],
  long: [1.5, 1.5],
};

const snap = (v: number, lo: number, hi: number, step: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v / step) * step)) : fallback;

export const clampSeconds = (v: number) => snap(v, SECONDS_MIN, SECONDS_MAX, SECONDS_STEP, 2);
export const clampRatio = (v: number) => snap(v, RATIO_MIN, RATIO_MAX, RATIO_STEP, OLD_DEFAULT_RATIO);
export const clampRepeats = (v: number) => snap(v, 1, REPEATS_MAX, 1, 1);
export const pauseModeOf = (v: string): PauseMode => (PAUSE_MODES.includes(v as PauseMode) ? (v as PauseMode) : "length");
export const pauseLengthOf = (v: string): PauseLength => (v === "custom" || (PAUSE_LENGTHS as string[]).includes(v) ? (v as PauseLength) : "standard");
export const pauseWaitOf = (v: string): PauseWait => (v === "voice" ? "voice" : "key");

/**
 * Settings saved by an older version, read the way they were meant: "none" (不停) is a fixed pause
 * of 0 seconds now, and a pause by length chosen before the three steps keeps its own ratio
 * unless it was the old default (then it's 标准).
 */
export function migratePace<S extends PaceSettings>(s: S): S {
  const out = { ...s };
  if ((s.pauseMode as string) === "none") Object.assign(out, { pauseMode: "fixed", pauseSeconds: 0 });
  if (s.pauseLength !== "custom" && !(PAUSE_LENGTHS as string[]).includes(s.pauseLength)) out.pauseLength = clampRatio(s.pauseRatio) === OLD_DEFAULT_RATIO ? "standard" : "custom";
  out.pauseWait = pauseWaitOf(s.pauseWait);
  return out;
}

/** Whether playing changes at all: on, and either a pause or more than one time. */
export const paceActive = (s: PaceSettings) =>
  s.paceOn && (pauseModeOf(s.pauseMode) !== "fixed" || clampSeconds(s.pauseSeconds) > 0 || clampRepeats(s.sentenceRepeats) > 1);

/**
 * Seconds to wait after one time through a stretch `length` seconds long (in the track) played at
 * `rate`; null waits until you go on (a key, or your voice).
 */
export function pauseAfter(s: PaceSettings, length: number, rate: number): number | null {
  switch (pauseModeOf(s.pauseMode)) {
    case "fixed":
      return clampSeconds(s.pauseSeconds);
    case "wait":
      return null;
    case "length": {
      const heard = Math.max(0, length) / (rate > 0 ? rate : 1);
      const size = pauseLengthOf(s.pauseLength);
      const secs = size === "custom" ? Math.max(LENGTH_FLOOR, heard * clampRatio(s.pauseRatio)) : heard * STEPS[size][0] + STEPS[size][1];
      return Math.round(secs * 10) / 10;
    }
  }
}

/** Turning it on so that it really pauses: a fixed pause of 0 seconds becomes one by length. */
export function withPause(s: PaceSettings): Partial<PaceSettings> {
  return pauseModeOf(s.pauseMode) === "fixed" && clampSeconds(s.pauseSeconds) === 0 ? { paceOn: true, pauseMode: "length" } : { paceOn: true };
}

/** Paused by hand this soon after a sentence ended reads as making room to say it. */
const HAND_PAUSE_WINDOW = 1.5;
export const justAfterSentence = (sentences: Sentence[], t: number) => sentences.some((s) => t >= s.end - 0.15 && t - s.end <= HAND_PAUSE_WINDOW);

/** A pause a little shorter than now (the learner keeps going on before it ends); null when it can't be. */
export function shorter(s: PaceSettings): Partial<PaceSettings> | null {
  const mode = pauseModeOf(s.pauseMode);
  if (mode === "fixed") return clampSeconds(s.pauseSeconds) > 1 ? { pauseSeconds: clampSeconds(s.pauseSeconds) - 1 } : null;
  if (mode !== "length") return null;
  const size = pauseLengthOf(s.pauseLength);
  if (size === "custom") return clampRatio(s.pauseRatio) > RATIO_MIN ? { pauseRatio: clampRatio(s.pauseRatio) - RATIO_STEP } : null;
  return size === "long" ? { pauseLength: "standard" } : size === "standard" ? { pauseLength: "short" } : null;
}

/** A pause a little longer than now (the learner keeps holding it with Esc); null when it can't be. */
export function longer(s: PaceSettings): Partial<PaceSettings> | null {
  const mode = pauseModeOf(s.pauseMode);
  if (mode === "fixed") return clampSeconds(s.pauseSeconds) < SECONDS_MAX ? { pauseSeconds: clampSeconds(s.pauseSeconds) + 1 } : null;
  if (mode !== "length") return null;
  const size = pauseLengthOf(s.pauseLength);
  if (size === "custom") return clampRatio(s.pauseRatio) < RATIO_MAX ? { pauseRatio: clampRatio(s.pauseRatio) + RATIO_STEP } : null;
  return size === "short" ? { pauseLength: "standard" } : size === "standard" ? { pauseLength: "long" } : null;
}

/** One stretch the engine plays before a pause. */
export interface Stretch {
  /** Where it starts when it plays again (the sentence, a little early; or the loop's start). */
  from: number;
  /** Where it stops. */
  stop: number;
  /** The sentence it is (or ends in); null for an A–B loop with no sentence in it. */
  sentence: number | null;
  /** It ends a loop: after it, back to here (the loop's start). */
  wrap: number | null;
}

/** A pause this close to a sentence's end counts as reaching it. */
export const END_MARGIN = 0.08;

/**
 * The stretch playing from `t`: the sentence not yet over at `t`, or inside a loop, that sentence
 * (cut at the loop's end, which then wraps). Null after the last sentence, outside a loop.
 */
export function stretchAt(sentences: Sentence[], loop: Loop, t: number): Stretch | null {
  const i = sentences.findIndex((s) => s.end > t + END_MARGIN);
  const s = sentences[i];
  if (isLoopActive(loop) && t >= loop.a - END_MARGIN && t < loop.b - END_MARGIN) {
    const inside = s && s.start < loop.b - END_MARGIN ? s : undefined;
    const from = inside ? Math.max(loop.a, sentenceStart(inside)) : loop.a;
    // A sentence that ends inside the loop stops there; the one reaching past its end wraps.
    if (inside && inside.end < loop.b - END_MARGIN) return { from, stop: inside.end, sentence: i, wrap: null };
    return { from, stop: loop.b, sentence: inside ? i : null, wrap: loop.a };
  }
  return s ? { from: sentenceStart(s), stop: s.end, sentence: i, wrap: null } : null;
}

/** After one time through: the same stretch again, the next (from `at`), or play on to the end of the track. */
export type Next = { kind: "again" } | { kind: "on"; at: number } | { kind: "end" };

/**
 * What follows time `pass` (1, 2…) through `stretch`. A stretch plays `repeats` times; a loop's
 * last stretch then goes back to its start, any other one on to the next sentence.
 */
export function nextAfter(stretch: Stretch, pass: number, repeats: number, sentences: Sentence[]): Next {
  if (pass < clampRepeats(repeats)) return { kind: "again" };
  if (stretch.wrap !== null) return { kind: "on", at: stretch.wrap };
  const next = stretch.sentence === null ? undefined : sentences[stretch.sentence + 1];
  // Straight to the next sentence, past the silence before it: the pause was the silence.
  return next ? { kind: "on", at: Math.max(stretch.stop, sentenceStart(next)) } : { kind: "end" };
}

/**
 * The deck key's label while on, saying what happens: "每句停 2 秒", "按句长停", "每句等我",
 * "等我说完"; with " · 3 遍" when it repeats, or while it plays (`pass`), which time this is:
 * " · 2/3". No pause and several times is "每句放 3 遍".
 */
export function paceLabel(s: PaceSettings, pass?: number): string {
  const n = clampRepeats(s.sentenceRepeats);
  const mode = pauseModeOf(s.pauseMode);
  const secs = clampSeconds(s.pauseSeconds);
  const counted = (label: string) => (pass ? `${label} · ${Math.min(pass, n)}/${n}` : label);
  if (mode === "fixed" && secs === 0 && n > 1) return counted(t("每句放 {n} 遍", { n }));
  const pause = mode === "fixed" ? t("每句停 {n} 秒", { n: secs }) : mode === "length" ? t("按句长停") : pauseWaitOf(s.pauseWait) === "voice" ? t("等我说完") : t("每句等我");
  if (n === 1) return pause;
  return pass ? counted(pause) : t("{pause} · {n} 遍", { pause, n });
}

/**
 * Said on a sentence loop's strip, where each time through is the same sentence: "每遍之间停
 * 3.8 秒", "每遍之间等我"; off, the question that turns it on.
 */
export function betweenPasses(s: PaceSettings, length: number, rate: number): string {
  if (!paceActive(s)) return t("每遍之间停一下？");
  const secs = pauseAfter(s, length, rate);
  if (secs === null) return pauseWaitOf(s.pauseWait) === "voice" ? t("每遍等我说完") : t("每遍之间等我");
  return secs === 0 ? t("每遍之间不停") : t("每遍之间停 {n} 秒", { n: secs });
}

export const PAUSE_MODE_LABELS: Record<PauseMode, string> = {
  length: tk("按句长"),
  fixed: tk("固定秒数"),
  wait: tk("等我"),
};

export const PAUSE_LENGTH_LABELS: Record<Exclude<PauseLength, "custom">, string> = {
  short: tk("短"),
  standard: tk("标准"),
  long: tk("长"),
};
