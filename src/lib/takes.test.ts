import { describe, expect, it } from "vitest";
import type { Take } from "./api";
import { lagNote, lanes, paceNote, playheadAt, takeCounts, takesFor, whenRecorded } from "./takes";

const take = (over: Partial<Take> = {}): Take => ({
  id: "1",
  created: 0,
  start: 10,
  end: 12,
  text: "",
  mode: "listen",
  rate: 1,
  duration: 5,
  original: [0.1, 2.1],
  mine: [2.6, 5.05],
  lagMs: null,
  peaks: { original: [], mine: [] },
  ...over,
});

describe("takesFor", () => {
  it("matches the sentence a take was recorded against", () => {
    const takes = [take(), take({ id: "2", start: 12, end: 14 })];
    expect(takesFor(takes, 10, 12).map((t) => t.id)).toEqual(["1"]);
    expect(takesFor(takes, 12, 14).map((t) => t.id)).toEqual(["2"]);
  });

  it("still matches after the sentence's edges were nudged", () => {
    expect(takesFor([take()], 10.2, 12.3)).toHaveLength(1);
  });

  it("an A–B loop over two sentences doesn't claim either", () => {
    const loop = take({ start: 10, end: 14 });
    expect(takesFor([loop], 10, 12)).toHaveLength(1); // half of the shorter (the sentence) is inside
    expect(takesFor([loop], 20, 22)).toHaveLength(0);
  });

  it("counts per sentence", () => {
    const sentences = [{ start: 10, end: 12 }, { start: 12, end: 14 }];
    expect(takeCounts([take(), take({ id: "2" })], sentences)).toEqual([2, 0]);
  });
});

describe("lanes", () => {
  it("listen: both voices start at the left edge", () => {
    const l = lanes(take());
    expect(l.width).toBeCloseTo(2.45);
    expect([l.original, l.mine]).toEqual([0.1, 2.6]);
  });

  it("a sentence cut from a paragraph read on your own lines up like 听完再说", () => {
    expect(lanes(take({ mode: "read" })).original).toBe(0.1);
    expect(lanes(take({ mode: "read" })).mine).toBe(2.6);
  });

  it("shadow: one timeline, so the lag shows", () => {
    const l = lanes(take({ mode: "shadow", original: [0.1, 2.1], mine: [0.4, 2.6] }));
    expect(l.original).toBe(0.1);
    expect(l.mine).toBe(0.1);
    expect(l.width).toBeCloseTo(2.5);
  });
});

describe("playheadAt", () => {
  const parts = [
    { lane: "original" as const, from: 0.1, to: 2.1, clipAt: 0 },
    { lane: "mine" as const, from: 2.6, to: 5.05, clipAt: 2.4 },
  ];
  it("follows the original, then you", () => {
    expect(playheadAt(parts, 1)).toEqual({ original: 1.1, mine: null });
    expect(playheadAt(parts, 2.2)).toEqual({ original: null, mine: null }); // the gap
    expect(playheadAt(parts, 3)).toEqual({ original: null, mine: 3.2 });
  });

  it("both lanes at once when played together", () => {
    expect(playheadAt([{ lane: "both", from: 0, to: 3, clipAt: 0 }], 1)).toEqual({ original: 1, mine: 1 });
  });
});

describe("notes", () => {
  it("pace", () => {
    expect(paceNote(take())).toBe("节奏和原句差不多");
    expect(paceNote(take({ mine: [2.6, 6.05] }))).toBe("比原句慢 50%");
    expect(paceNote(take({ mine: [2.6, 4.05] }))).toBe("比原句快 50%");
  });

  it("lag", () => {
    expect(lagNote(null)).toBe("");
    expect(lagNote(40)).toBe("几乎和原声同步");
    expect(lagNote(420)).toBe("比原声晚 0.42 秒");
  });

  it("when", () => {
    const now = new Date(2026, 9, 14, 15, 30).getTime();
    expect(whenRecorded(now - 20_000, now)).toBe("刚刚");
    expect(whenRecorded(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(whenRecorded(new Date(2026, 9, 14, 9, 5).getTime(), now)).toBe("今天 09:05");
    expect(whenRecorded(new Date(2026, 9, 12, 21, 0).getTime(), now)).toBe("10月12日 21:00");
  });
});
