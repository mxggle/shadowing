import { describe, expect, it } from "vitest";
import type { Reading } from "./api";
import { partHead, partsBySentence, readingNote, readingRange, readingsFor, saidCount, stretchAt } from "./readings";

const reading = (over: Partial<Reading> = {}): Reading => ({
  id: "r",
  created: 0,
  start: 10,
  end: 40,
  mode: "read",
  rate: 1,
  duration: 35,
  parts: [
    { start: 10, end: 20, mine: [0.2, 11], take: "r-0" },
    { start: 20, end: 40, mine: [12, 33], take: null },
  ],
  originalSecs: 30,
  mineSecs: 33,
  lagMs: null,
  peaks: [],
  ...over,
});

describe("readingRange", () => {
  const sections = [{ start: 0 }, { start: 5 }, { start: 9 }];
  it("the section you're in", () => {
    expect(readingRange("section", sections, 6, 12)).toEqual([5, 9]);
    expect(readingRange("section", sections, 10, 12)).toEqual([9, 12]);
    expect(readingRange("section", sections, -1, 12)).toEqual([0, 5]);
  });
  it("the whole text, or when there are no sections", () => {
    expect(readingRange("all", sections, 6, 12)).toEqual([0, 12]);
    expect(readingRange("section", [{ start: 0 }], 6, 12)).toEqual([0, 12]);
  });
});

describe("readingsFor", () => {
  it("matches the same paragraph, edges nudged", () => {
    const rs = [reading(), reading({ id: "x", start: 40, end: 60 })];
    expect(readingsFor(rs, 10.3, 39.8).map((r) => r.id)).toEqual(["r"]);
    expect(readingsFor(rs, 10, 60)).toEqual([]);
  });
});

describe("notes", () => {
  it("pace when reading on your own", () => {
    expect(readingNote(reading())).toBe("你 33.0 秒 · 原文 30.0 秒，节奏差不多");
    expect(readingNote(reading({ mineSecs: 39 }))).toBe("你 39.0 秒 · 原文 30.0 秒，慢 30%");
  });
  it("lag when shadowing", () => {
    expect(readingNote(reading({ mode: "shadow", lagMs: 420 }))).toBe("平均比原声晚 0.42 秒");
  });
  it("sentences said", () => {
    expect(saidCount(reading())).toBe(1);
  });
});

describe("stretchAt", () => {
  it("finds the sentence playing", () => {
    const p = { stretches: [{ clipAt: 0, len: 2, part: 0, lane: "original" as const }, { clipAt: 2.3, len: 2, part: 0, lane: "mine" as const }] };
    expect(stretchAt(p, 1)?.lane).toBe("original");
    expect(stretchAt(p, 2.1)).toBeNull();
    expect(stretchAt(p, 3)?.lane).toBe("mine");
  });
});

describe("partHead", () => {
  const p = { stretches: [{ clipAt: 0, len: 2, part: 0, lane: "original" as const }, { clipAt: 2.5, len: 4, part: 0, lane: "mine" as const }, { clipAt: 7, len: 2, part: 1, lane: "mine" as const }] };
  it("runs along your part of a sentence only", () => {
    expect(partHead(p, 1, 0)).toBeNull(); // the original is playing
    expect(partHead(p, 3.5, 0)).toBe(0.25);
    expect(partHead(p, 3.5, 1)).toBeNull();
    expect(partHead(p, 8, 1)).toBe(0.5);
    expect(partHead(p, 6.8, 0)).toBeNull(); // the gap between
  });
});

describe("partsBySentence", () => {
  it("puts each part under the sentence it starts in", () => {
    const at = (secs: number) => (secs < 20 ? 3 : 4);
    expect([...partsBySentence(reading(), at)]).toEqual([[3, 0], [4, 1]]);
  });
});
