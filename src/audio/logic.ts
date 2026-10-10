// Pure playback rules, kept free of DOM so they can be unit-tested.
import type { Progress } from "../lib/api";

export interface Loop {
  a: number | null;
  b: number | null;
}

export const NO_LOOP: Loop = { a: null, b: null };

export const isLoopActive = (loop: Loop): loop is { a: number; b: number } =>
  loop.a !== null && loop.b !== null;

/**
 * Loop fires when playback *crosses* B. A user seek past B therefore plays on
 * normally instead of snapping back.
 */
export function shouldJumpToA(loop: Loop, prev: number, now: number): boolean {
  return isLoopActive(loop) && prev < loop.b && now >= loop.b;
}

const MIN_LOOP = 0.3;

/** One key cycles: set A → set B (loop starts) → clear. */
export function cycleLoop(loop: Loop, t: number): Loop {
  if (loop.a === null) return { a: t, b: null };
  if (loop.b === null) {
    if (Math.abs(t - loop.a) < MIN_LOOP) return loop;
    return t > loop.a ? { a: loop.a, b: t } : { a: t, b: loop.a };
  }
  return NO_LOOP;
}

/** Moves one boundary, keeping A < B by at least MIN_LOOP and inside [0, duration]. */
export function nudgeLoop(loop: Loop, which: "a" | "b", delta: number, duration: number): Loop {
  if (!isLoopActive(loop)) return loop;
  if (which === "a") {
    const a = clamp(loop.a + delta, 0, loop.b - MIN_LOOP);
    return { ...loop, a };
  }
  const b = clamp(loop.b + delta, loop.a + MIN_LOOP, duration || Infinity);
  return { ...loop, b };
}

/** What happens when a track plays to its end. */
export type PlayMode = "once" | "next" | "list" | "one";

/** Order the mode button walks through: the default first, then the two repeats, then stop. */
export const PLAY_MODES: PlayMode[] = ["next", "list", "one", "once"];

export const nextPlayMode = (mode: PlayMode): PlayMode => PLAY_MODES[(PLAY_MODES.indexOf(mode) + 1) % PLAY_MODES.length];

/**
 * Index of the track to open after `index` of `count`, or null to stay put.
 * `ended`: the track played to its end (otherwise the user pressed next / previous).
 * An index of -1 is a clip outside the folder (the sample), which never moves on.
 */
export function trackAfter(mode: PlayMode, index: number, count: number, direction: 1 | -1, ended: boolean): number | null {
  if (index < 0 || count === 0) return null;
  if (ended && (mode === "once" || mode === "one")) return null;
  const next = index + direction;
  if (next >= 0 && next < count) return next;
  // Only "repeat the list" wraps around; manual skipping wraps too, like a music player.
  return mode === "list" ? (next + count) % count : null;
}

const RESUME_REWIND = 2;
const FINISHED_MARGIN = 3;

export const isFinished = (p: Progress | undefined) =>
  !!p && p.duration > 0 && p.position >= p.duration - FINISHED_MARGIN;

/** Where to start a track: a little before where you stopped, or 0 if finished. */
export function resumePosition(p: Progress | undefined): number {
  if (!p || isFinished(p)) return 0;
  return Math.max(0, p.position - RESUME_REWIND);
}

export const RATE_MIN = 0.5;
export const RATE_MAX = 2;
export const RATE_STEP = 0.05;
/** One-click speeds in the player bar. */
export const RATE_PRESETS = [0.75, 0.85, 1, 1.25];

export function clampRate(rate: number): number {
  return Math.round(clamp(rate, RATE_MIN, RATE_MAX) / RATE_STEP) * RATE_STEP;
}

export const SEEK_STEP_DEFAULT = 5;
export const SEEK_STEP_MIN = 1;
export const SEEK_STEP_MAX = 60;

/** Jump step for ← → and the ±buttons: whole seconds in [1, 60]; junk falls back to the default. */
export function clampSeekStep(step: number): number {
  if (!Number.isFinite(step)) return SEEK_STEP_DEFAULT;
  return clamp(Math.round(step), SEEK_STEP_MIN, SEEK_STEP_MAX);
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
