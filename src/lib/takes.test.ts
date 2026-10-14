import { describe, expect, it } from "vitest";
import type { Take } from "./api";
import { lagNote, lanes, nextTake, paceNote, peekTake, playheadAt, sentenceOf, takeCounts, takesFor, whenRecorded } from "./takes";

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

  it("an A–B loop over two sentences shows under each of them", () => {
    const loop = take({ start: 10, end: 14 });
    expect(takesFor([loop], 10, 12)).toHaveLength(1); // half of the shorter (the sentence) is inside
    expect(takesFor([loop], 12, 14)).toHaveLength(1);
    expect(takesFor([loop], 20, 22)).toHaveLength(0);
  });

  it("counts per sentence", () => {
    const sentences = [{ start: 10, end: 12 }, { start: 12, end: 14 }];
    expect(takeCounts([take(), take({ id: "2" })], sentences)).toEqual([2, 0]);
  });
});

describe("peekTake", () => {
  const takes = [take(), take({ id: "2" }), take({ id: "3", start: 12, end: 14 })];
  it("shows the latest of the sentence's takes", () => {
    expect(peekTake(takes, 10, 12, [])?.id).toBe("2");
    expect(peekTake(takes, 20, 22, [])).toBeUndefined();
  });
  it("prefers one being looked at or played, if it is this sentence's", () => {
    expect(peekTake(takes, 10, 12, [null, "3", "1"])?.id).toBe("1");
  });
});

describe("listening on", () => {
  const sentences = [{ start: 10, end: 12 }, { start: 12, end: 14 }, { start: 14, end: 16 }, { start: 16, end: 18 }];
  const takes = [
    take({ id: "a" }),
    take({ id: "c1", start: 14, end: 16, group: "r" }),
    take({ id: "c2", start: 14, end: 16 }),
    take({ id: "d", start: 16, end: 18 }),
  ];
  it("knows which sentence a take is of", () => {
    expect(sentenceOf(take({ start: 14.1, end: 16 }), sentences)).toBe(2);
    expect(sentenceOf(take({ start: 40, end: 42 }), sentences)).toBe(-1);
  });
  it("goes on to the next recorded sentence, passing over the rest", () => {
    expect(nextTake(takes, sentences, 0)).toEqual({ index: 2, take: takes[2] });
    expect(nextTake(takes, sentences, 2)?.take.id).toBe("d");
    expect(nextTake(takes, sentences, 3)).toBeNull();
  });
  it("stays with the reading it started in", () => {
    expect(nextTake(takes, sentences, 0, "r")?.take.id).toBe("c1");
    expect(nextTake(takes, sentences, 2, "r")?.take.id).toBe("d");
  });
  it("a take over two sentences is of the one it covers most", () => {
    expect(sentenceOf(take({ start: 10, end: 14 }), sentences)).toBe(0); // a tie: the first
    expect(sentenceOf(take({ start: 11, end: 14.5 }), sentences)).toBe(1); // also half of the first
  });
  it("never comes back to a take over two sentences", () => {
    const loop = take({ id: "loop", start: 10, end: 14 });
    const all = [loop, take({ id: "b", start: 12, end: 14 }), take({ id: "d", start: 16, end: 18 })];
    expect(nextTake(all, sentences, 0)).toEqual({ index: 1, take: all[1] });
    expect(nextTake([loop, all[2]], sentences, 0)?.take.id).toBe("d");
    // Listened through from the loop, every step moves on.
    const seen: string[] = [];
    let at: { index: number; take: Take } | null = { index: 0, take: loop };
    while (at && seen.length < 10) {
      seen.push(at.take.id);
      at = nextTake(all, sentences, sentenceOf(at.take, sentences));
    }
    expect(seen).toEqual(["loop", "b", "d"]);
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
    expect(paceNote(take({ rate: 0.85 }))).toBe("节奏和原句差不多（原句放的是 0.85×）");
  });

  it("lag", () => {
    expect(lagNote(null)).toBe("");
    expect(lagNote(40)).toBe("几乎和原声同步");
    expect(lagNote(420)).toBe("比原声晚 0.42 秒");
    expect(lagNote(420, true)).toBe("戴蓝牙耳机时测不准晚多少");
  });

  it("when", () => {
    const now = new Date(2026, 9, 14, 15, 30).getTime();
    expect(whenRecorded(now - 20_000, now)).toBe("刚刚");
    expect(whenRecorded(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(whenRecorded(new Date(2026, 9, 14, 9, 5).getTime(), now)).toBe("今天 09:05");
    expect(whenRecorded(new Date(2026, 9, 12, 21, 0).getTime(), now)).toBe("10月12日 21:00");
  });
});
