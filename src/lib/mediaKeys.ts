// 媒体键: the keyboard's ⏯ ⏮ ⏭ and a headset's buttons (AirPods: press once, twice, three times).
// They reach the app through the system's Now Playing (macOS) or media controls (Windows), which
// Rust looks after (src-tauri/src/nowplaying); here is what each one does, and what the system is
// told is playing. Unit-tested in mediaKeys.test.ts.

/** A button as Rust names it. */
export type MediaButton = "toggle" | "play" | "pause" | "next" | "previous";

/**
 * What a button does: the deck's play key (it pauses a recording or a playback too), or what [ ]
 * would: a sentence back or on (back restarts the sentence once you're into it), the highlight
 * of a paragraph being read, or with no sentences a jump back or on.
 */
export type MediaAction = { do: "toggle" } | { do: "sentence" | "reading" | "jump"; direction: 1 | -1 };

export interface MediaState {
  /** The deck's play key is going: the track playing, a recording or a playback not paused. */
  running: boolean;
  /** The track has sentences. */
  sentences: boolean;
  /** A paragraph being read aloud (整段录音). */
  reading: boolean;
  /** A take being recorded: ⏮ ⏭ leave it alone, as [ ] do. */
  take: boolean;
}

export function mediaAction(button: MediaButton, s: MediaState): MediaAction | null {
  if (button === "toggle") return { do: "toggle" };
  // A headset may ask for play or pause on its own: only when it isn't so already.
  if (button === "play") return s.running ? null : { do: "toggle" };
  if (button === "pause") return s.running ? { do: "toggle" } : null;
  const direction = button === "next" ? 1 : -1;
  if (s.reading) return { do: "reading", direction };
  if (s.take) return null;
  return { do: s.sentences ? "sentence" : "jump", direction };
}

/** What the system shows (Control Center, Windows' media flyout) and where the track is. */
export interface NowPlaying {
  title: string;
  artist: string;
  duration: number;
  position: number;
  /** How fast `position` moves: the speed while the track plays, 0 otherwise. */
  rate: number;
  /** The play key is going (a recording or a playback too): the system shows pause. */
  playing: boolean;
}

export interface Sent {
  np: NowPlaying;
  /** When it was sent, in ms (performance.now()). */
  at: number;
}

/** Seconds the position may drift from what `rate` says before the system is told again. */
const DRIFT = 1;

/**
 * Whether the system needs telling again: something it shows changed, or the position moved
 * other than as `rate` says (a seek, a loop going round). Not on every tick: the system moves
 * the position on by itself.
 */
export function stale(sent: Sent | null, np: NowPlaying | null, now: number): boolean {
  if (!sent || !np) return !!sent !== !!np;
  const was = sent.np;
  if (np.title !== was.title || np.artist !== was.artist || np.playing !== was.playing || np.rate !== was.rate) return true;
  if (Math.abs(np.duration - was.duration) > 0.5) return true;
  const expected = was.position + ((now - sent.at) / 1000) * was.rate;
  return Math.abs(np.position - expected) > DRIFT;
}
