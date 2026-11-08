// 推荐练法: the line above the sentences that says how to practise a track
// (hear it through, then sentence by sentence, then a whole paragraph), and
// which of those you've done here. Shown by itself once ever; 整段录音's menu
// brings it back.
import type { Sentence, Take } from "./api";

export type FlowStep = "listen" | "drill" | "read";
export const FLOW_STEPS: FlowStep[] = ["listen", "drill", "read"];
/** Its id in `guide.tips`: there once it has come up by itself. */
export const FLOW_TIP = "flow";

/** Close enough to the end to count as heard through: into the last sentence. */
export function heardThrough(time: number, sentences: Pick<Sentence, "start">[]): boolean {
  const last = sentences.at(-1);
  return !!last && time >= last.start;
}

/**
 * The steps done on this track, from what's there already: heard to the end
 * (this time it's open), a sentence recorded on its own (not cut from a
 * paragraph reading), a paragraph reading.
 */
export function flowDone(f: { heard: boolean; takes: Pick<Take, "group">[]; readings: number }): Set<FlowStep> {
  const done = new Set<FlowStep>();
  if (f.heard) done.add("listen");
  if (f.takes.some((t) => !t.group)) done.add("drill");
  if (f.readings > 0) done.add("read");
  return done;
}

/**
 * The step to suggest now: the one after the furthest done (someone who has
 * already recorded isn't sent back to listening), or null after the last.
 */
export function flowNext(done: Set<FlowStep>): FlowStep | null {
  let furthest = -1;
  FLOW_STEPS.forEach((s, i) => {
    if (done.has(s)) furthest = i;
  });
  return FLOW_STEPS[furthest + 1] ?? null;
}

/** Comes up by itself: never before, on a track with sentences, not on the sample (its own checklist is there). */
export function flowAuto(f: { tips: string[]; sentences: number; practicing: boolean }): boolean {
  return !f.tips.includes(FLOW_TIP) && f.sentences > 0 && !f.practicing;
}

/** Out of the way while recording, drilling or reading a paragraph, and on the sample. */
export function flowShown(f: { open: boolean; busy: boolean; practicing: boolean }): boolean {
  return f.open && !f.busy && !f.practicing;
}

/**
 * After a take of sentence `at` recorded with its own mic button (not in a
 * drill): true once another sentence was recorded that way before it, this
 * session — someone going sentence by sentence by hand, whom 逐句跟读 would save
 * the clicks.
 */
export function byHand(before: number[], at: number | "loop"): boolean {
  return at !== "loop" && before.some((i) => i !== at);
}

/** Where 逐句跟读 picks up after sentence `at`: the next one (the last stays the last). */
export function drillFrom(at: number, count: number): number {
  return Math.max(0, Math.min(at + 1, count - 1));
}
