// 跟读停顿: with a transcript, the track plays one sentence at a time — each a few times if you
// like — and waits after each so you can say it, like a 复读机. The engine plays one stretch
// exactly (player_play_range stops on the frame); these rules pick the stretch, the pause after it
// and what comes next. Inside an A–B, sentence or section loop the stretches are its sentences and
// the last one goes back to the loop's start. Unit-tested in pace.test.ts.
import { isLoopActive, type Loop } from "../audio/logic";
import type { Sentence } from "./api";
import { t, tk } from "./i18n";
import { sentenceStart } from "./sentences";

/** After each time through: no pause, a few seconds, as long as the sentence × a ratio, or until you go on. */
export type PauseMode = "none" | "fixed" | "length" | "wait";
export const PAUSE_MODES: PauseMode[] = ["none", "fixed", "length", "wait"];

export interface PaceSettings {
  paceOn: boolean;
  pauseMode: PauseMode;
  pauseSeconds: number;
  pauseRatio: number;
  sentenceRepeats: number;
}

export const SECONDS_MIN = 0.5;
export const SECONDS_MAX = 30;
export const SECONDS_STEP = 0.5;
export const RATIO_MIN = 0.5;
export const RATIO_MAX = 4;
export const RATIO_STEP = 0.25;
export const REPEATS_MAX = 10;
/** A pause by the sentence's length is never shorter than this, so a two-word sentence still leaves time to start. */
const LENGTH_FLOOR = 1;

const snap = (v: number, lo: number, hi: number, step: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v / step) * step)) : fallback;

export const clampSeconds = (v: number) => snap(v, SECONDS_MIN, SECONDS_MAX, SECONDS_STEP, 2);
export const clampRatio = (v: number) => snap(v, RATIO_MIN, RATIO_MAX, RATIO_STEP, 1.5);
export const clampRepeats = (v: number) => snap(v, 1, REPEATS_MAX, 1, 1);
export const pauseModeOf = (v: string): PauseMode => (PAUSE_MODES.includes(v as PauseMode) ? (v as PauseMode) : "length");

/** Whether playing changes at all: on, and either a pause or more than one time. */
export const paceActive = (s: PaceSettings) => s.paceOn && (pauseModeOf(s.pauseMode) !== "none" || clampRepeats(s.sentenceRepeats) > 1);

/**
 * Seconds to wait after one time through a stretch `length` seconds long (in the track) played at
 * `rate`; null waits until you go on.
 */
export function pauseAfter(s: PaceSettings, length: number, rate: number): number | null {
  switch (pauseModeOf(s.pauseMode)) {
    case "none":
      return 0;
    case "fixed":
      return clampSeconds(s.pauseSeconds);
    case "wait":
      return null;
    case "length": {
      const heard = Math.max(0, length) / (rate > 0 ? rate : 1);
      return Math.round(Math.max(LENGTH_FLOOR, heard * clampRatio(s.pauseRatio)) * 10) / 10;
    }
  }
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
 * The settings key's short label: "停 2 秒", "停 ×1.5", "等你", "不停"; with " · 3 遍" when it
 * repeats, or while it plays (`pass`), which time this is: " · 2/3".
 */
export function paceLabel(s: PaceSettings, pass?: number): string {
  const pause = {
    none: t("不停"),
    fixed: t("停 {n} 秒", { n: clampSeconds(s.pauseSeconds) }),
    length: t("停 ×{n}", { n: clampRatio(s.pauseRatio) }),
    wait: t("等你"),
  }[pauseModeOf(s.pauseMode)];
  const n = clampRepeats(s.sentenceRepeats);
  if (n === 1) return pause;
  return pass ? `${pause} · ${Math.min(pass, n)}/${n}` : t("{pause} · {n} 遍", { pause, n });
}

export const PAUSE_MODE_LABELS: Record<PauseMode, string> = {
  none: tk("不停"),
  fixed: tk("秒数"),
  length: tk("按句长"),
  wait: tk("等我"),
};
