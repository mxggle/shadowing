import { describe, expect, it } from "vitest";
import type { Sentence } from "./api";
import { textPieces } from "./edits";
import { saidPieces, saidUpTo, sentenceIndexAt, sentenceLoop, speakerCount, speakerName, startsTurn, stepTarget } from "./sentences";

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
    expect([0, 1, 2].map(speakerName)).toEqual(["A", "B", "C"]);
  });
});

describe("saidUpTo", () => {
  // Each character timed, punctuation not.
  const timed: Sentence = { start: 10, end: 13, text: "「傘を、持ってきた？」", times: [[1, 10], [2, 10.3], [4, 11], [5, 11.2], [6, 11.4], [7, 11.6], [8, 11.8]] };

  it("lights up to the first character not said yet, punctuation with what's before it", () => {
    expect(saidUpTo(timed, 9.5)).toBe(0);
    expect(saidUpTo(timed, 10)).toBe(2);
    expect(saidUpTo(timed, 10.5)).toBe(4);
    expect(saidUpTo(timed, 11.1)).toBe(5);
    expect(saidUpTo(timed, 12)).toBe(timed.text.length);
  });

  it("lights a character a moment early, as the time shown lags the sound", () => {
    expect(saidUpTo(timed, 10.27)).toBe(4);
  });

  it("is null without character times, and never past the text", () => {
    expect(saidUpTo({ start: 0, end: 1, text: "はい" }, 0.5)).toBeNull();
    expect(saidUpTo({ start: 0, end: 1, text: "はい", times: [] }, 0.5)).toBeNull();
    expect(saidUpTo({ start: 0, end: 1, text: "は", times: [[0, 0], [5, 2]] }, 1)).toBe(1);
  });
});

describe("saidPieces", () => {
  const piece = (text: string, said: boolean, match = false, unsure = false) => ({ text, match, unsure, said });
  const times: [number, number][] = [[0, 0], [1, 1], [3, 2], [4, 3]];

  it("cuts the text where each timed character starts and marks what's been said", () => {
    expect(saidPieces(textPieces("傘を、持って", ""), times, 3)).toEqual([piece("傘", true), piece("を、", true), piece("持", false), piece("って", false)]);
  });

  it("keeps the matches and underlines, cut too", () => {
    expect(saidPieces(textPieces("傘を、持って", "を、持", [[0, 1]]), times, 1)).toEqual([
      piece("傘", true, false, true),
      piece("を、", false, true),
      piece("持", false, true),
      piece("って", false),
    ]);
  });

  it("lights words whole in languages written with spaces", () => {
    expect(saidPieces(textPieces("I see it.", ""), [[0, 0], [2, 1], [6, 2]], 6)).toEqual([piece("I ", true), piece("see ", true), piece("it.", false)]);
  });
});
