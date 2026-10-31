import { describe, expect, it } from "vitest";
import type { Sentence } from "./api";
import { barWidth, heardBetween, hideHowOf, hideModeOf, leftRevealed, textShown, type Seen } from "./hide";

const sentence = (start: number, end: number): Sentence => ({ start, end, text: "x" }) as Sentence;
// 1–3, 4–6.5, 7–9
const list = [sentence(1, 3), sentence(4, 6.5), sentence(7, 9)];
const seen = (over: Partial<Seen> = {}): Seen => ({ active: 1, revealed: null, peek: false, heard: new Set(), ...over });

describe("textShown", () => {
  it("shown: every sentence", () => {
    expect(textShown("show", 0, seen())).toBe(true);
  });

  it("hidden: only the one clicked, or the one playing while H is held", () => {
    expect(textShown("hide", 0, seen())).toBe(false);
    expect(textShown("hide", 0, seen({ revealed: 0 }))).toBe(true);
    expect(textShown("hide", 1, seen({ peek: true }))).toBe(true);
    expect(textShown("hide", 2, seen({ peek: true }))).toBe(false);
    // Hidden means hidden, heard or not.
    expect(textShown("hide", 0, seen({ heard: new Set([0]) }))).toBe(false);
  });

  it("听完再看: a sentence once it has played through", () => {
    expect(textShown("after", 0, seen({ heard: new Set([0]) }))).toBe(true);
    expect(textShown("after", 1, seen({ heard: new Set([0]) }))).toBe(false);
  });
});

describe("barWidth", () => {
  it("a CJK character is about 1em, a Latin one about half", () => {
    expect(barWidth("今日は天気の話をしましょう。")).toBe(14);
    expect(barWidth("Hi, could I get a latte?")).toBe(12);
  });

  it("never vanishes, nor runs off the line", () => {
    expect(barWidth("")).toBe(2);
    expect(barWidth("あ".repeat(80))).toBe(32);
  });
});

describe("heardBetween", () => {
  it("the sentences whose end was played through", () => {
    expect(heardBetween(list, 2.9, 3.05)).toEqual([0]);
    expect(heardBetween(list, 2, 2.5)).toEqual([]);
  });

  it("stopping just short of the end counts (跟读停顿 stops on it, a loop wraps at it)", () => {
    expect(heardBetween(list, 6.3, 6.45)).toEqual([1]);
  });

  it("a jump, or going back, isn't playing through", () => {
    expect(heardBetween(list, 2, 8)).toEqual([]);
    expect(heardBetween(list, 6.4, 4)).toEqual([]);
  });
});

describe("leftRevealed", () => {
  it("only when the track moves from the sentence shown to another", () => {
    expect(leftRevealed(list, 0, 3.5, 3.95)).toBe(true);
    expect(leftRevealed(list, 0, 2, 2.5)).toBe(false);
    expect(leftRevealed(list, 2, 3.5, 3.95)).toBe(false);
    expect(leftRevealed(list, null, 3.5, 3.95)).toBe(false);
  });
});

it("unknown modes read as shown, and H goes back to hiding", () => {
  expect(hideModeOf("later")).toBe("show");
  expect(hideHowOf("")).toBe("hide");
  expect(hideHowOf("after")).toBe("after");
});
