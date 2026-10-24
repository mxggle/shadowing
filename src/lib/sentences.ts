// Pure rules for moving around a transcript; unit-tested in sentences.test.ts.
import type { Loop } from "../audio/logic";
import type { Sentence } from "./api";
import type { TextPiece } from "./edits";

/** Cue times tend to clip the first sound; start a sentence slightly early. */
export const SENTENCE_LEAD = 0.1;
/** Same minimum as a hand-set A–B loop. */
const MIN_LOOP = 0.3;
/** `[` restarts the current sentence once you are this far into it, else goes back one. */
const RESTART_AFTER = 1;

export const sentenceStart = (s: Sentence) => Math.max(0, s.start - SENTENCE_LEAD);

/**
 * Index of the last sentence that has started by `t` (−1 before the first).
 * Stays on a sentence through the silence after it, so the highlight doesn't flicker off.
 */
export function sentenceIndexAt(sentences: Sentence[], t: number): number {
  // Allow the lead, so jumping to a sentence highlights it straight away.
  const at = t + SENTENCE_LEAD + 0.01;
  let lo = 0;
  let hi = sentences.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sentences[mid].start <= at) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The time shown lags the sound by up to one update (it moves in 0.05 s steps): light that much early. */
const LIGHT_AHEAD = 0.05;

/**
 * How much of a sentence has been said by `t`, to light it up as it plays: the
 * string offset of the first character (word) not said yet, so punctuation goes
 * with what's before it. Null when transcription didn't time its characters.
 */
export function saidUpTo(s: Sentence, t: number): number | null {
  const times = s.times;
  if (!times?.length) return null;
  const next = times.findIndex(([, at]) => at > t + LIGHT_AHEAD);
  if (next === 0) return 0;
  return Math.min(next < 0 ? s.text.length : times[next][0], s.text.length);
}

/**
 * `pieces` of a sentence's text cut where each timed character (word) starts,
 * so each lights on its own, and marked said or not by `upTo` (saidUpTo).
 */
export function saidPieces(pieces: TextPiece[], times: [number, number][], upTo: number): TextPiece[] {
  const out: TextPiece[] = [];
  let at = 0;
  for (const piece of pieces) {
    const end = at + piece.text.length;
    const cuts = [at, ...times.map(([o]) => o).filter((o) => o > at && o < end), end];
    for (let i = 0; i + 1 < cuts.length; i++) {
      out.push({ ...piece, text: piece.text.slice(cuts[i] - at, cuts[i + 1] - at), said: cuts[i] < upTo });
    }
    at = end;
  }
  return out;
}

/** The A–B loop that repeats one sentence. */
export function sentenceLoop(s: Sentence, duration: number): Loop {
  const a = sentenceStart(s);
  const end = duration > 0 ? Math.min(s.end, duration) : s.end;
  return { a, b: Math.max(end, a + MIN_LOOP) };
}

/** Where `[` (−1) and `]` (+1) go from time `t`; −1 when there are no sentences. */
export function stepTarget(sentences: Sentence[], t: number, direction: 1 | -1): number {
  if (!sentences.length) return -1;
  const i = sentenceIndexAt(sentences, t);
  if (direction > 0) return Math.min(sentences.length - 1, i + 1);
  if (i >= 0 && t - sentences[i].start > RESTART_AFTER) return i;
  return Math.max(0, i - 1);
}

/** How many voices a transcription told apart (0 when it didn't). */
export const speakerCount = (sentences: Sentence[]) =>
  sentences.reduce((n, s) => (s.speaker === undefined ? n : Math.max(n, s.speaker + 1)), 0);

/** "A", "B", … for speaker 0, 1, … */
export const speakerName = (speaker: number) => String.fromCharCode(65 + speaker);

/** A sentence that starts someone's turn: its speaker is known and differs from the one before. */
export function startsTurn(sentences: Sentence[], i: number): boolean {
  const who = sentences[i]?.speaker;
  return who !== undefined && (i === 0 || sentences[i - 1].speaker !== who);
}
