// The deck's play / pause key pauses whatever is going on and goes on with it:
// a take or a paragraph being recorded (逐句跟读 too), or a take or a reading
// playing back. With none of those, it plays / pauses the track as always.
// Space keeps its own meaning while recording (skip the original, keep this
// time…) and stops a playback; only the key does this.
import { t } from "./i18n";

export type PlayKeyTarget = "take" | "reading" | "takePlayback" | "readingPlayback" | "track";

interface Pausable {
  paused: boolean;
}

/** What the key looks at (the store has all of it). */
export interface PlayKeyState {
  rec: (Pausable & { phase: "starting" | "listening" | "speaking" | "saving" }) | null;
  live: (Pausable & { phase: "starting" | "reading" | "saving" }) | null;
  /** 逐句跟读: between two sentences there's a moment with no take yet. */
  drill: object | null;
  playingTake: Pausable | null;
  playingReading: Pausable | null;
  /** The track. */
  playing: boolean;
  hasTracks: boolean;
}

export interface PlayKey {
  target: PlayKeyTarget;
  /** Going on (shows pause); paused or stopped shows play. */
  running: boolean;
  enabled: boolean;
}

export function playKey(s: PlayKeyState): PlayKey {
  if (s.rec || s.drill) {
    // Opening the mic or saving: nothing to pause just then.
    const busy = !s.rec || s.rec.phase === "starting" || s.rec.phase === "saving";
    return { target: "take", running: busy || !s.rec!.paused, enabled: !busy };
  }
  if (s.live) {
    const busy = s.live.phase !== "reading";
    return { target: "reading", running: busy || !s.live.paused, enabled: !busy };
  }
  if (s.playingTake) return { target: "takePlayback", running: !s.playingTake.paused, enabled: true };
  if (s.playingReading) return { target: "readingPlayback", running: !s.playingReading.paused, enabled: true };
  return { target: "track", running: s.playing, enabled: s.hasTracks };
}

/** The key's tooltip. */
export function playKeyTitle(k: PlayKey): string {
  switch (k.target) {
    case "take":
    case "reading":
      return k.running ? t("暂停录音", "Pause recording") : t("继续录音", "Resume recording");
    case "takePlayback":
    case "readingPlayback":
      return k.running ? t("暂停回放", "Pause playback") : t("继续回放", "Resume playback");
    case "track":
      return t("播放 / 暂停 (空格)", "Play / Pause (Space)");
  }
}

/**
 * A take going on after a pause: what's left to do. `going`: the original
 * plays on from where it waited (its end gives you your turn, as usual).
 * `waiting`: a time through (连续录) that couldn't start while paused, or one
 * Rust is still setting up (it starts by itself).
 */
export function goingOn(t: { phase: string; along: boolean; going: boolean; waiting: "round" | "start" | null }): "start" | "turn" | null {
  if (t.waiting === "round") return null;
  if (t.waiting === "start") return "start";
  if (t.going) return null;
  // The original was over (or ended just as you paused): your turn.
  return t.phase === "listening" || t.along ? "turn" : null;
}
