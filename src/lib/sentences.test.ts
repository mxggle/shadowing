import { describe, expect, it } from "vitest";
import type { Sentence } from "./api";
import { sentenceIndexAt, sentenceLoop, speakerCount, speakerName, speakerWidth, startsTurn, stepTarget } from "./sentences";

const s = (start: number, end: number): Sentence => ({ start, end, text: "" });
const list = [s(1, 3), s(4, 6), s(10, 12)];

describe("sentenceIndexAt", () => {
  it("finds the sentence that has started, staying on it through the gap after", () => {
    expect(sentenceIndexAt(list, 0)).toBe(-1);
    expect(sentenceIndexAt(list, 2)).toBe(0);
    expect(sentenceIndexAt(list, 3.5)).toBe(0);
    expect(sentenceIndexAt(list, 8)).toBe(1);
    expect(sentenceIndexAt(list, 99)).toBe(2);
    expect(sentenceIndexAt([], 5)).toBe(-1);
  });

  it("counts the lead-in before a sentence as that sentence", () => {
    expect(sentenceIndexAt(list, 3.9)).toBe(1);
  });
});

describe("sentenceLoop", () => {
  it("starts a little early and stays inside the track", () => {
    expect(sentenceLoop(s(4, 6), 100)).toEqual({ a: 3.9, b: 6 });
    expect(sentenceLoop(s(0.05, 2), 100).a).toBe(0);
    expect(sentenceLoop(s(98, 101), 100).b).toBe(100);
  });

  it("never makes a loop shorter than a hand-set one could be", () => {
    const loop = sentenceLoop(s(5, 5.05), 100);
    expect(loop.b! - loop.a!).toBeCloseTo(0.3);
  });
});

describe("stepTarget", () => {
  it("goes forward one sentence, stopping at the last", () => {
    expect(stepTarget(list, 0, 1)).toBe(0);
    expect(stepTarget(list, 2, 1)).toBe(1);
    expect(stepTarget(list, 11, 1)).toBe(2);
  });

  it("restarts the current sentence unless you are near its start", () => {
    expect(stepTarget(list, 5.5, -1)).toBe(1);
    expect(stepTarget(list, 4.3, -1)).toBe(0);
    expect(stepTarget(list, 1.2, -1)).toBe(0);
  });

  it("returns −1 without sentences", () => {
    expect(stepTarget([], 3, 1)).toBe(-1);
  });
});

describe("speakers", () => {
  const said = (...who: (number | undefined)[]): Sentence[] => who.map((speaker, i) => ({ start: i, end: i + 1, text: "", speaker }));

  it("counts the voices a transcription told apart", () => {
    expect(speakerCount(said(0, 1, 1, 2))).toBe(3);
    expect(speakerCount(said(undefined, undefined))).toBe(0);
    expect(speakerCount([])).toBe(0);
  });

  it("marks where each turn starts", () => {
    const talk = said(0, 0, 1, 0, 0);
    expect(talk.map((_, i) => startsTurn(talk, i))).toEqual([true, false, true, true, false]);
    expect(startsTurn(said(undefined, undefined), 1)).toBe(false);
  });

  it("names speakers A, B, C", () => {
    expect([0, 1, 2].map((i) => speakerName(i))).toEqual(["A", "B", "C"]);
    expect([0, 1, 2].map((i) => speakerName(i, ["店員", " 客 "]))).toEqual(["店員", "客", "C"]);
  });
});

describe("speakerWidth", () => {
  it("fits one letter without names, and the longest name with them", () => {
    expect(speakerWidth()).toBe(1.75);
    expect(speakerWidth([])).toBe(1.75);
    expect(speakerWidth(["客", "A"])).toBe(1.75);
    expect(speakerWidth(["店員", "客"])).toBe(2.25);
    expect(speakerWidth(["お客さん", "店長"])).toBe(3.75);
  });
});
