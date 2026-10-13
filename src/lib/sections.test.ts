import { describe, expect, it } from "vitest";
import type { Sentence } from "./api";
import { mergeUp, rename, sectionIndexOf, sectionLoop, sectionName, sectionRange, sectionsOf, sectionStep, splitAt } from "./sections";

const s = (start: number, end: number): Sentence => ({ start, end, text: "" });
const sentences = [s(1, 3), s(4, 6), s(10, 12), s(13, 15), s(20, 22)];
const three = [{ start: 0 }, { start: 2, title: "駅で" }, { start: 4 }];

describe("sectionsOf", () => {
  it("treats a transcript without sections as one", () => {
    expect(sectionsOf({})).toEqual([{ start: 0 }]);
    expect(sectionsOf({ sections: [] })).toEqual([{ start: 0 }]);
    expect(sectionsOf(null)).toEqual([{ start: 0 }]);
    expect(sectionsOf({ sections: three })).toBe(three);
  });
});

describe("finding sections", () => {
  it("knows which section a sentence is in", () => {
    expect([-1, 0, 1, 2, 3, 4].map((i) => sectionIndexOf(three, i))).toEqual([0, 0, 0, 1, 1, 2]);
  });

  it("gives each section its sentences", () => {
    expect(sectionRange(three, 0, 5)).toEqual([0, 2]);
    expect(sectionRange(three, 2, 5)).toEqual([4, 5]);
  });

  it("names untitled sections by number", () => {
    expect(sectionName(three, 0)).toBe("对话 1");
    expect(sectionName(three, 1)).toBe("駅で");
  });
});

describe("changing sections", () => {
  it("splits at a sentence, in order, once", () => {
    expect(splitAt(three, 3).map((x) => x.start)).toEqual([0, 2, 3, 4]);
    expect(splitAt(three, 2)).toBe(three);
    expect(splitAt(three, 0)).toBe(three);
  });

  it("merges a section into the one before, never the first", () => {
    expect(mergeUp(three, 1)).toEqual([{ start: 0 }, { start: 4 }]);
    expect(mergeUp(three, 0)).toBe(three);
  });

  it("renames, and a blank title goes back to the number", () => {
    expect(rename(three, 2, "  カフェ\n で ")[2]).toEqual({ start: 4, title: "カフェ で" });
    expect(rename(three, 1, "  ")[1]).toEqual({ start: 2 });
  });
});

describe("sectionLoop", () => {
  it("repeats from the first sentence (a little early) to the end of the last", () => {
    expect(sectionLoop(sentences, three, 1, 100)).toEqual({ a: 9.9, b: 15 });
    expect(sectionLoop(sentences, three, 2, 21)).toEqual({ a: 19.9, b: 21 });
    expect(sectionLoop([], [{ start: 0 }], 0, 100)).toBeNull();
  });
});

describe("sectionStep", () => {
  it("goes to the next section, or back to the start of this one, then the one before", () => {
    expect(sectionStep(three, 0, 1)).toBe(1);
    expect(sectionStep(three, 4, 1)).toBe(2);
    expect(sectionStep(three, 3, -1)).toBe(1);
    expect(sectionStep(three, 2, -1)).toBe(0);
    expect(sectionStep(three, 0, -1)).toBe(0);
    expect(sectionStep(three, -1, 1)).toBe(0);
  });
});
