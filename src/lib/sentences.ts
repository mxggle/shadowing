// Pure rules for moving around a transcript; unit-tested in sentences.test.ts.
import type { Loop } from "../audio/logic";
import type { Sentence } from "./api";

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
