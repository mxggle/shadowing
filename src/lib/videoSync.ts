// A video's picture follows the engine, which plays its sound (src-tauri/src/audio):
// a muted <video> is told, many times a second, what to do to show what is being heard.
//
// WebKit makes both ways of correcting it costly, so it's done only by jumping:
// - a jump takes 0.25–0.35 s before the picture moves again, so it jumps ahead by
//   about that (`lead`, learnt from where each one lands), then is left to settle;
// - changing the speed while it plays makes it snap back to the last jump and freeze
//   for half a second, so the speed changes only when yours does, and then together
//   with a jump. Left alone at the same speed, the picture keeps within a frame or two.

/** What the engine says is audible now. */
export interface Playhead {
  time: number;
  playing: boolean;
  rate: number;
}

/** What the <video> is doing. */
export interface PictureState {
  time: number;
  paused: boolean;
  /** A jump is under way; nothing else is asked of it until it lands. */
  seeking: boolean;
  rate: number;
  /** NaN until the video's length is known. */
  duration: number;
  /** Seconds since the last jump landed (Infinity before the first). */
  settled: number;
  /** Seconds since the jump under way was asked for (0 when none is). */
  seekingFor: number;
  /** The sound itself moved (a seek, a loop going round) since the last jump was asked for. */
  soundMoved: boolean;
}

export interface SyncAction {
  seek?: number;
  play?: boolean;
  pause?: boolean;
  rate?: number;
}

/** Playing, further off than this: jump. */
export const JUMP_OVER = 0.1;
/** Paused: further off than about a frame shows the wrong one. */
export const STILL_OVER = 0.04;
/** After a jump lands the picture takes a moment to get going: no other jump for this long, unless the sound moved. */
export const SETTLE = 1;
/** A jump that hasn't landed by then is asked for again. */
const STUCK = 2;
/** The picture stops this short of its end: a video that ends restarts if told to play. */
const END_MARGIN = 0.05;

/** `lead`: how far ahead to jump while playing (seconds), so the picture lands where the sound will be. */
export function syncPicture(head: Playhead, pic: PictureState, lead = 0): SyncAction {
  const act: SyncAction = {};
  // Sound longer than the picture: hold its last frame.
  const last = Number.isFinite(pic.duration) && pic.duration > 0 ? pic.duration - END_MARGIN : Infinity;
  const clamp = (t: number) => Math.max(0, Math.min(t, last));
  const target = clamp(head.time);
  const playing = head.playing && head.time < last;
  const off = target - pic.time; // > 0: the picture is behind
  const ahead = clamp(head.time + (playing ? lead * head.rate : 0));

  if (playing && pic.paused) act.play = true;
  if (!playing && !pic.paused) act.pause = true;
  if (pic.seeking) {
    if (pic.seekingFor > STUCK) act.seek = ahead;
    return act;
  }
  if (Math.abs(pic.rate - head.rate) > 1e-6) {
    // A new speed: set it and jump at once, one stall instead of two.
    act.rate = head.rate;
    if (playing) act.seek = ahead;
  }
  if (!playing) {
    if (Math.abs(off) > STILL_OVER) act.seek = target;
  } else if (Math.abs(off) > JUMP_OVER && (pic.settled > SETTLE || pic.soundMoved)) {
    act.seek = ahead;
  }
  return act;
}

/**
 * How far ahead to jump next time, from how far off the last jump landed (`off`:
 * the sound's time less the picture's, just after it landed; > 0, it came down
 * behind). Timing the jump itself overestimated it: the webview says it has landed
 * a while after the picture is moving again.
 */
export function nextLead(lead: number, off: number): number {
  return Math.max(0, Math.min(0.6, lead + off * 0.7));
}

/** Whether the sound jumped (a seek, a loop going round): not where it was `secs` ago, run on at `rate`. */
export function soundJumped(before: Playhead, now: Playhead, secs: number): boolean {
  const expected = before.time + (before.playing ? secs * before.rate : 0);
  return Math.abs(now.time - expected) > 0.25;
}
