// A video's picture follows the engine, which plays its sound (src-tauri/src/audio):
// a muted <video> is told, many times a second, what to do to show what is being heard.
//
// Both ways of correcting it are costly in a webview, so each is used sparingly:
// - a jump takes 30–250 ms before the picture moves again (WebKit reads each frame
//   through media:// on its own), so it jumps ahead by about that, then is left to settle;
// - a speed change restarts the player's clock, so speeds changing every frame cancel
//   out: it runs 10% faster or slower until it's back, two changes per correction.

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
  /** Seconds it has been running faster or slower to catch up (0 when it isn't). */
  nudgedFor: number;
}

export interface SyncAction {
  seek?: number;
  play?: boolean;
  pause?: boolean;
  rate?: number;
}

/** Playing, further off than this: jump (once settled). */
export const JUMP_OVER = 0.4;
/** Playing, further off than this: start catching up by running a little faster or slower… */
export const NUDGE_OVER = 0.06;
/** …until this close (or past it). */
const NUDGE_DONE = 0.01;
const NUDGE = 0.1;
/** Catching up that hasn't worked by then (a webview ignoring the speed): jump instead. */
const NUDGE_GIVE_UP = 3;
/** Paused: further off than about a frame shows the wrong one. */
export const STILL_OVER = 0.04;
/** After a jump lands, the picture gets this long to catch up before another. */
export const SETTLE = 1;
/** A jump that hasn't landed by then is asked for again. */
const STUCK = 2;
/** Further than this, or behind it: the sound itself moved (a seek, a loop), so jump now. */
const MOVED = 1;
/** The picture stops this short of its end: a video that ends restarts if told to play. */
const END_MARGIN = 0.05;

/** `lead`: how long a jump takes (seconds), so the picture lands where the sound will be. */
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

  let rate = head.rate;
  const nudging = Math.abs(pic.rate / head.rate - 1 - NUDGE) < 1e-6 ? 1 : Math.abs(pic.rate / head.rate - 1 + NUDGE) < 1e-6 ? -1 : 0;
  if (!playing) {
    if (Math.abs(off) > STILL_OVER) act.seek = target;
  } else if (Math.abs(off) > JUMP_OVER && (pic.settled > SETTLE || off < 0 || off > MOVED)) {
    act.seek = ahead;
  } else if (nudging && pic.nudgedFor > NUDGE_GIVE_UP && Math.abs(off) > NUDGE_OVER) {
    act.seek = ahead;
  } else if (nudging === 1 && off > NUDGE_DONE) {
    rate = pic.rate; // still behind: keep going faster
  } else if (nudging === -1 && off < -NUDGE_DONE) {
    rate = pic.rate; // still ahead: keep going slower
  } else if (!nudging && Math.abs(off) > NUDGE_OVER) {
    rate = head.rate * (off > 0 ? 1 + NUDGE : 1 - NUDGE);
  }
  if (Math.abs(rate - pic.rate) > 1e-6) act.rate = rate;
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
