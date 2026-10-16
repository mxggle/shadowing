import { describe, expect, it } from "vitest";
import type { Reading } from "./api";
import { headOnTake, howSettings, partAt, readingHow, readingNote, readingRange, readingsFor, saidCount, scopeOf, stretchAt } from "./readings";

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

describe("headOnTake", () => {
  const take = { original: [0.1, 2.1] as [number, number], mine: [3, 7] as [number, number] };
  const p = { stretches: [{ clipAt: 0, len: 2, part: 0, lane: "original" as const }, { clipAt: 2.5, len: 4, part: 0, lane: "mine" as const }, { clipAt: 7, len: 2, part: 1, lane: "mine" as const }] };
  it("follows the original, then you, on the take's own timeline", () => {
    expect(headOnTake(p, 1, 0, take)).toEqual({ original: 1.1, mine: null });
    expect(headOnTake(p, 3.5, 0, take)).toEqual({ original: null, mine: 4 });
  });
  it("is nowhere while another sentence, or the gap between, plays", () => {
    expect(headOnTake(p, 8, 0, take)).toEqual({ original: null, mine: null });
    expect(headOnTake(p, 2.2, 0, take)).toEqual({ original: null, mine: null });
  });
});

describe("partAt", () => {
  // 逐句对比: sentence 0's original, a 0.3 s gap, you, a 0.7 s gap, then sentence 2 (1 was skipped).
  const p = {
    stretches: [
      { clipAt: 0, len: 2, part: 0, lane: "original" as const },
      { clipAt: 2.3, len: 2.5, part: 0, lane: "mine" as const },
      { clipAt: 5.5, len: 1.5, part: 2, lane: "original" as const },
    ],
  };
  it("stays on the sentence through the gaps", () => {
    expect([0, 2.1, 4.9, 5.2].map((t) => partAt(p, t))).toEqual([0, 0, 0, 0]);
    expect(partAt(p, 5.5)).toBe(2);
    expect(partAt(p, 9)).toBe(2);
  });
  it("is the first before anything plays, and nothing without stretches", () => {
    expect(partAt({ stretches: [{ ...p.stretches[2], clipAt: 0.25 }] }, 0)).toBe(2);
    expect(partAt({ stretches: [] }, 1)).toBeNull();
  });
});

describe("scopeOf", () => {
  const sentences = [{ start: 1, end: 3 }, { start: 3, end: 5 }, { start: 6, end: 8 }];
  it("reads the whole text again if it was the whole text", () => {
    expect(scopeOf({ start: 1, end: 8 }, sentences)).toBe("all");
    expect(scopeOf({ start: 1.2, end: 7.9 }, sentences)).toBe("all");
  });
  it("else the section", () => {
    expect(scopeOf({ start: 3, end: 8 }, sentences)).toBe("section");
    expect(scopeOf({ start: 1, end: 3 }, [])).toBe("section");
  });
});

describe("how 整段录音 goes", () => {
  it("is 逐句跟读 when picked, otherwise the paragraph mode", () => {
    expect(readingHow({ paragraphMode: "shadow", paragraphDrill: false })).toBe("shadow");
    expect(readingHow({ paragraphMode: "shadow", paragraphDrill: true })).toBe("drill");
  });

  it("picking 逐句跟读 leaves the paragraph mode a mode older versions know", () => {
    expect(howSettings("drill")).toEqual({ paragraphDrill: true });
    expect(howSettings("read")).toEqual({ paragraphMode: "read", paragraphDrill: false });
  });
});
