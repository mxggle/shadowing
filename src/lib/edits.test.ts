import { describe, expect, it } from "vitest";
import type { Sentence } from "./api";
import { changedWord, matchingSentences, matchRanges, replaceEdits, splitMatches } from "./edits";

const s = (text: string): Sentence => ({ start: 0, end: 1, text });

describe("changedWord", () => {
  it("widens a wrong kanji to the whole run of kanji around it", () => {
    expect(changedWord("ねえ、寝蔵アートって知ってる?", "ねえ、寝相アートって知ってる?")).toEqual({ from: "寝蔵", to: "寝相" });
    expect(changedWord("ん?寝蔵アート?", "ん?寝相アート?")).toEqual({ from: "寝蔵", to: "寝相" });
  });

  it("takes in neighbours of the same kind as either version", () => {
    expect(changedWord("ねえ、ネゾウアートって", "ねえ、寝相アートって")).toEqual({ from: "ネゾウアート", to: "寝相アート" });
    expect(changedWord("ねぞうアート", "寝相アート")).toEqual({ from: "ねぞう", to: "寝相" });
  });

  it("widens to whole words in languages written with spaces", () => {
    expect(changedWord("I met Jon today.", "I met John today.")).toEqual({ from: "Jon", to: "John" });
    expect(changedWord("a big dog", "a pig dog")).toEqual({ from: "big", to: "pig" });
  });

  it("offers nothing for unchanged text, deletions, punctuation or hiragana-only changes", () => {
    expect(changedWord("同じ", "同じ")).toBeNull();
    expect(changedWord("あー、どうしよう。", "どうしよう。")).toBeNull();
    expect(changedWord("何それ?", "何それ？")).toBeNull();
    expect(changedWord("知ってる?", "知っている?")).toBeNull();
  });
});

describe("matchRanges", () => {
  it("finds every occurrence without overlaps", () => {
    expect(matchRanges("寝蔵アート?寝蔵", "寝蔵")).toEqual([
      [0, 2],
      [6, 8],
    ]);
    expect(matchRanges("ああああ", "ああ")).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(matchRanges("anything", "")).toEqual([]);
  });

  it("only matches whole words for letters and digits", () => {
    expect(matchRanges("a cat ate a rat", "a")).toEqual([
      [0, 1],
      [10, 11],
    ]);
    expect(matchRanges("Jon, Jones and Jon.", "Jon")).toEqual([
      [0, 3],
      [15, 18],
    ]);
    expect(matchRanges("3時と13時", "3")).toEqual([[0, 1]]);
  });

  it("matches inside Japanese text, which has no spaces", () => {
    expect(matchRanges("今日は寝蔵の話", "寝蔵")).toEqual([[3, 5]]);
  });
});

describe("replaceEdits", () => {
  const list = [s("ねえ、寝蔵アートって知ってる?"), s("ん?"), s("寝蔵アート?寝蔵"), s("寝蔵")];

  it("replaces every occurrence in each sentence that has it", () => {
    expect(matchingSentences(list, "寝蔵")).toEqual([0, 2, 3]);
    expect(replaceEdits(list, "寝蔵", "寝相")).toEqual([
      { index: 0, text: "ねえ、寝相アートって知ってる?" },
      { index: 2, text: "寝相アート?寝相" },
      { index: 3, text: "寝相" },
    ]);
  });

  it("never leaves a sentence empty", () => {
    expect(replaceEdits(list, "寝蔵", "").map((e) => e.index)).toEqual([0, 2]);
  });
});

describe("splitMatches", () => {
  it("marks the matches for highlighting", () => {
    expect(splitMatches("ん?寝蔵アート?", "寝蔵")).toEqual([
      { text: "ん?", match: false },
      { text: "寝蔵", match: true },
      { text: "アート?", match: false },
    ]);
    expect(splitMatches("寝蔵", "寝蔵")).toEqual([{ text: "寝蔵", match: true }]);
    expect(splitMatches("なし", "寝蔵")).toEqual([{ text: "なし", match: false }]);
    expect(splitMatches("", "")).toEqual([{ text: "", match: false }]);
  });
});
