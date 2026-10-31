import { afterEach, describe, expect, it } from "vitest";
import { NO_LOOP } from "../audio/logic";
import type { Sentence } from "./api";
import { setLang } from "./i18n";
import { betweenPasses, clampRatio, clampRepeats, clampSeconds, justAfterSentence, longer, migratePace, nextAfter, paceActive, paceLabel, pauseAfter, pauseModeOf, shorter, stretchAt, withPause, type PaceSettings } from "./pace";

afterEach(() => setLang("zh"));

const pace = (s: Partial<PaceSettings> = {}): PaceSettings => ({ paceOn: true, pauseMode: "length", pauseLength: "standard", pauseSeconds: 2, pauseRatio: 1.5, pauseWait: "key", sentenceRepeats: 1, ...s });
const sentence = (start: number, end: number): Sentence => ({ start, end, text: "x" }) as Sentence;
// Three sentences with silence between them: 1–3, 4–6.5, 7–9.
const list = [sentence(1, 3), sentence(4, 6.5), sentence(7, 9)];

describe("paceActive", () => {
  it("changes playing only when on and there is a pause or more than one time", () => {
    expect(paceActive(pace())).toBe(true);
    expect(paceActive(pace({ paceOn: false }))).toBe(false);
    expect(paceActive(pace({ pauseMode: "fixed", pauseSeconds: 0 }))).toBe(false);
    expect(paceActive(pace({ pauseMode: "fixed", pauseSeconds: 0, sentenceRepeats: 3 }))).toBe(true);
    expect(paceActive(pace({ pauseMode: "wait" }))).toBe(true);
  });
});

describe("pauseAfter", () => {
  it("a fixed time (0 is none), or until you go on", () => {
    expect(pauseAfter(pace({ pauseMode: "fixed", pauseSeconds: 2.5 }), 3, 1)).toBe(2.5);
    expect(pauseAfter(pace({ pauseMode: "fixed", pauseSeconds: 0 }), 3, 1)).toBe(0);
    expect(pauseAfter(pace({ pauseMode: "wait" }), 3, 1)).toBeNull();
    expect(pauseAfter(pace({ pauseMode: "wait", pauseWait: "voice" }), 3, 1)).toBeNull();
  });

  it("by length, three steps: the sentence as heard × a ratio, plus a moment to start", () => {
    expect(pauseAfter(pace({ pauseLength: "short" }), 2.8, 1)).toBe(2.6);
    expect(pauseAfter(pace({ pauseLength: "standard" }), 2.8, 1)).toBe(3.8);
    expect(pauseAfter(pace({ pauseLength: "long" }), 2.8, 1)).toBe(5.7);
    // Slowed down the sentence is longer, and so is the pause.
    expect(pauseAfter(pace(), 2, 0.5)).toBe(5);
    // A one-second sentence still leaves two; an eight-second one doesn't make you wait twelve.
    expect(pauseAfter(pace(), 1, 1)).toBe(2);
    expect(pauseAfter(pace(), 8, 1)).toBe(9);
  });

  it("by length, the free ratio kept from before the steps: never under a second", () => {
    expect(pauseAfter(pace({ pauseLength: "custom", pauseRatio: 1.5 }), 2, 1)).toBe(3);
    expect(pauseAfter(pace({ pauseLength: "custom", pauseRatio: 1 }), 0.3, 1)).toBe(1);
  });

  it("an unknown mode or step from a newer version reads as by length, 标准", () => {
    expect(pauseModeOf("later")).toBe("length");
    expect(pauseAfter(pace({ pauseMode: "later" as never, pauseLength: "huge" as never }), 2, 1)).toBe(3);
  });
});

describe("migratePace", () => {
  it("不停 from an older version is a fixed pause of 0 seconds", () => {
    const old = migratePace(pace({ pauseMode: "none" as never, pauseSeconds: 3, sentenceRepeats: 2 }));
    expect([old.pauseMode, old.pauseSeconds, old.sentenceRepeats]).toEqual(["fixed", 0, 2]);
  });

  it("a ratio chosen before the steps stays; the old default becomes 标准", () => {
    expect(migratePace(pace({ pauseLength: undefined as never, pauseRatio: 1.5 })).pauseLength).toBe("standard");
    expect(migratePace(pace({ pauseLength: "" as never, pauseRatio: 2 })).pauseLength).toBe("custom");
    expect(migratePace(pace({ pauseLength: "long" })).pauseLength).toBe("long");
  });

  it("waits for a key unless it says the voice", () => {
    expect(migratePace(pace({ pauseWait: undefined as never })).pauseWait).toBe("key");
    expect(migratePace(pace({ pauseWait: "voice" })).pauseWait).toBe("voice");
  });
});

describe("shorter / longer", () => {
  it("move a step, a second or a ratio step, and stop at the ends", () => {
    expect(shorter(pace({ pauseLength: "long" }))).toEqual({ pauseLength: "standard" });
    expect(shorter(pace({ pauseLength: "short" }))).toBeNull();
    expect(longer(pace({ pauseLength: "standard" }))).toEqual({ pauseLength: "long" });
    expect(longer(pace({ pauseLength: "long" }))).toBeNull();
    expect(shorter(pace({ pauseMode: "fixed", pauseSeconds: 3 }))).toEqual({ pauseSeconds: 2 });
    expect(shorter(pace({ pauseMode: "fixed", pauseSeconds: 1 }))).toBeNull();
    expect(longer(pace({ pauseLength: "custom", pauseRatio: 1.5 }))).toEqual({ pauseRatio: 1.75 });
    expect(longer(pace({ pauseMode: "wait" }))).toBeNull();
  });
});

describe("withPause", () => {
  it("turns it on, by length when the fixed pause is 0 seconds", () => {
    expect(withPause(pace({ paceOn: false }))).toEqual({ paceOn: true });
    expect(withPause(pace({ paceOn: false, pauseMode: "fixed", pauseSeconds: 0 }))).toEqual({ paceOn: true, pauseMode: "length" });
  });
});

describe("justAfterSentence", () => {
  it("is a moment after a sentence's end, not the middle of one", () => {
    expect(justAfterSentence(list, 3.2)).toBe(true);
    expect(justAfterSentence(list, 2.9)).toBe(true);
    expect(justAfterSentence(list, 2)).toBe(false);
    expect(justAfterSentence(list, 5)).toBe(false);
    expect(justAfterSentence([], 3)).toBe(false);
  });
});

describe("clamps", () => {
  it("keep the numbers in range and on their steps", () => {
    expect(clampSeconds(0)).toBe(0);
    expect(clampSeconds(-1)).toBe(0);
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
  it("says what happens after each sentence, and the times when more than one", () => {
    expect(paceLabel(pace({ pauseMode: "fixed", pauseSeconds: 2 }))).toBe("每句停 2 秒");
    expect(paceLabel(pace({ pauseMode: "fixed", pauseSeconds: 1.5 }))).toBe("每句停 1.5 秒");
    expect(paceLabel(pace())).toBe("按句长停");
    expect(paceLabel(pace({ pauseMode: "wait", sentenceRepeats: 3 }))).toBe("每句等我 · 3 遍");
    expect(paceLabel(pace({ pauseMode: "wait", pauseWait: "voice" }))).toBe("等我说完");
    expect(paceLabel(pace({ pauseMode: "fixed", pauseSeconds: 0, sentenceRepeats: 2 }))).toBe("每句放 2 遍");
  });

  it("while it plays, which time this is", () => {
    expect(paceLabel(pace({ pauseMode: "fixed", pauseSeconds: 2, sentenceRepeats: 3 }), 2)).toBe("每句停 2 秒 · 2/3");
    expect(paceLabel(pace({ pauseMode: "fixed", pauseSeconds: 2 }), 1)).toBe("每句停 2 秒");
    expect(paceLabel(pace({ pauseMode: "fixed", pauseSeconds: 0, sentenceRepeats: 3 }), 2)).toBe("每句放 3 遍 · 2/3");
  });

  it("in English", () => {
    setLang("en");
    expect(paceLabel(pace({ pauseMode: "fixed", pauseSeconds: 2, sentenceRepeats: 3 }))).toBe("Pause 2 s · 3×");
    expect(paceLabel(pace())).toBe("Pause to fit");
  });
});

describe("betweenPasses", () => {
  it("on a sentence loop: the pause between times through, or the question when off", () => {
    expect(betweenPasses(pace(), 2.8, 1)).toBe("每遍之间停 3.8 秒");
    expect(betweenPasses(pace({ pauseMode: "wait" }), 2.8, 1)).toBe("每遍之间等我");
    expect(betweenPasses(pace({ paceOn: false }), 2.8, 1)).toBe("每遍之间停一下？");
    expect(betweenPasses(pace({ pauseMode: "fixed", pauseSeconds: 0, sentenceRepeats: 2 }), 2.8, 1)).toBe("每遍之间不停");
  });
});

it("clampRepeats keeps 1–10", () => expect(clampRepeats(12)).toBe(10));
