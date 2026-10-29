import { afterEach, describe, expect, it } from "vitest";
import { NO_LOOP } from "../audio/logic";
import type { Sentence } from "./api";
import { setLang } from "./i18n";
import { clampRatio, clampRepeats, clampSeconds, nextAfter, paceActive, paceLabel, pauseAfter, pauseModeOf, stretchAt, type PaceSettings } from "./pace";

afterEach(() => setLang("zh"));

const pace = (s: Partial<PaceSettings> = {}): PaceSettings => ({ paceOn: true, pauseMode: "length", pauseSeconds: 2, pauseRatio: 1.5, sentenceRepeats: 1, ...s });
const sentence = (start: number, end: number): Sentence => ({ start, end, text: "x" }) as Sentence;
// Three sentences with silence between them: 1–3, 4–6.5, 7–9.
const list = [sentence(1, 3), sentence(4, 6.5), sentence(7, 9)];

describe("paceActive", () => {
  it("changes playing only when on and there is a pause or more than one time", () => {
    expect(paceActive(pace())).toBe(true);
    expect(paceActive(pace({ paceOn: false }))).toBe(false);
    expect(paceActive(pace({ pauseMode: "none" }))).toBe(false);
    expect(paceActive(pace({ pauseMode: "none", sentenceRepeats: 3 }))).toBe(true);
  });
});

describe("pauseAfter", () => {
  it("none, a fixed time, or until you go on", () => {
    expect(pauseAfter(pace({ pauseMode: "none" }), 3, 1)).toBe(0);
    expect(pauseAfter(pace({ pauseMode: "fixed", pauseSeconds: 2.5 }), 3, 1)).toBe(2.5);
    expect(pauseAfter(pace({ pauseMode: "wait" }), 3, 1)).toBeNull();
  });

  it("by length: the sentence as you heard it (slowed down it's longer) × the ratio", () => {
    expect(pauseAfter(pace({ pauseRatio: 1.5 }), 2, 1)).toBe(3);
    expect(pauseAfter(pace({ pauseRatio: 1 }), 2, 0.5)).toBe(4);
  });

  it("by length: a very short sentence still leaves a second", () => {
    expect(pauseAfter(pace({ pauseRatio: 1 }), 0.3, 1)).toBe(1);
  });

  it("an unknown mode from a newer version reads as by length", () => {
    expect(pauseModeOf("later")).toBe("length");
    expect(pauseAfter(pace({ pauseMode: "later" as never, pauseRatio: 1 }), 2, 1)).toBe(2);
  });
});

describe("clamps", () => {
  it("keep the numbers in range and on their steps", () => {
    expect(clampSeconds(0)).toBe(0.5);
    expect(clampSeconds(2.3)).toBe(2.5);
    expect(clampSeconds(99)).toBe(30);
    expect(clampRatio(1.1)).toBe(1);
    expect(clampRepeats(0)).toBe(1);
    expect(clampRepeats(3.4)).toBe(3);
    expect(clampRepeats(NaN)).toBe(1);
  });
});

describe("stretchAt", () => {
  it("is the sentence playing, or the next one in the silence before it", () => {
    expect(stretchAt(list, NO_LOOP, 2)).toEqual({ from: 0.9, stop: 3, sentence: 0, wrap: null });
    expect(stretchAt(list, NO_LOOP, 3.5)).toEqual({ from: 3.9, stop: 6.5, sentence: 1, wrap: null });
    expect(stretchAt(list, NO_LOOP, 0)?.sentence).toBe(0);
  });

  it("right at a sentence's end is the next sentence (it just stopped there)", () => {
    expect(stretchAt(list, NO_LOOP, 3)?.sentence).toBe(1);
    expect(stretchAt(list, NO_LOOP, 2.95)?.sentence).toBe(1);
  });

  it("is nothing after the last sentence", () => {
    expect(stretchAt(list, NO_LOOP, 9.5)).toBeNull();
  });

  it("a sentence loop: the loop, which wraps", () => {
    const loop = { a: 3.9, b: 6.5 };
    expect(stretchAt(list, loop, 5)).toEqual({ from: 3.9, stop: 6.5, sentence: 1, wrap: 3.9 });
  });

  it("a section loop: each sentence stops, the last wraps to the start", () => {
    const loop = { a: 0.9, b: 9 };
    expect(stretchAt(list, loop, 2)).toEqual({ from: 0.9, stop: 3, sentence: 0, wrap: null });
    expect(stretchAt(list, loop, 8)).toEqual({ from: 6.9, stop: 9, sentence: 2, wrap: 0.9 });
  });

  it("an A–B loop cutting a sentence stops at B", () => {
    const loop = { a: 4.5, b: 5.5 };
    expect(stretchAt(list, loop, 5)).toEqual({ from: 4.5, stop: 5.5, sentence: 1, wrap: 4.5 });
  });

  it("an A–B loop with no sentence in it, or no transcript", () => {
    expect(stretchAt([], { a: 10, b: 12 }, 11)).toEqual({ from: 10, stop: 12, sentence: null, wrap: 10 });
    expect(stretchAt(list, { a: 3.1, b: 3.8 }, 3.2)).toEqual({ from: 3.1, stop: 3.8, sentence: null, wrap: 3.1 });
  });

  it("past a loop's end plays on sentence by sentence", () => {
    expect(stretchAt(list, { a: 0.9, b: 3 }, 5)?.sentence).toBe(1);
  });
});

describe("nextAfter", () => {
  const first = stretchAt(list, NO_LOOP, 1)!;

  it("plays a sentence as many times as asked, then the next from its start", () => {
    expect(nextAfter(first, 1, 3, list)).toEqual({ kind: "again" });
    expect(nextAfter(first, 2, 3, list)).toEqual({ kind: "again" });
    expect(nextAfter(first, 3, 3, list)).toEqual({ kind: "on", at: 3.9 });
  });

  it("after the last sentence, plays on to the end of the track", () => {
    expect(nextAfter(stretchAt(list, NO_LOOP, 8)!, 1, 1, list)).toEqual({ kind: "end" });
  });

  it("a loop's last stretch goes back to its start", () => {
    const loop = { a: 0.9, b: 9 };
    expect(nextAfter(stretchAt(list, loop, 8)!, 1, 1, list)).toEqual({ kind: "on", at: 0.9 });
    expect(nextAfter(stretchAt(list, loop, 8)!, 1, 2, list)).toEqual({ kind: "again" });
  });
});

describe("paceLabel", () => {
  it("says the pause, and the times when more than one", () => {
    expect(paceLabel(pace({ pauseMode: "fixed", pauseSeconds: 2 }))).toBe("停 2 秒");
    expect(paceLabel(pace({ pauseRatio: 1.5 }))).toBe("停 ×1.5");
    expect(paceLabel(pace({ pauseMode: "wait", sentenceRepeats: 3 }))).toBe("等你 · 3 遍");
    expect(paceLabel(pace({ pauseMode: "none", sentenceRepeats: 2 }))).toBe("不停 · 2 遍");
  });

  it("while it plays, which time this is", () => {
    expect(paceLabel(pace({ pauseMode: "fixed", pauseSeconds: 2, sentenceRepeats: 3 }), 2)).toBe("停 2 秒 · 2/3");
    expect(paceLabel(pace({ pauseMode: "fixed", pauseSeconds: 2 }), 1)).toBe("停 2 秒");
  });

  it("in English", () => {
    setLang("en");
    expect(paceLabel(pace({ pauseMode: "fixed", pauseSeconds: 2, sentenceRepeats: 3 }))).toBe("Pause 2 s · 3×");
  });
});

it("clampRepeats keeps 1–10", () => expect(clampRepeats(12)).toBe(10));
