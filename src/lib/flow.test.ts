import { describe, expect, it } from "vitest";
import { byHand, drillFrom, FLOW_TIP, flowAuto, flowDone, flowNext, flowShown, heardThrough } from "./flow";

const sentences = [{ start: 0 }, { start: 4 }, { start: 9 }];

describe("heardThrough", () => {
  it("counts once the last sentence has begun", () => {
    expect(heardThrough(8.9, sentences)).toBe(false);
    expect(heardThrough(9, sentences)).toBe(true);
    expect(heardThrough(12, sentences)).toBe(true);
  });
  it("never with no sentences", () => {
    expect(heardThrough(100, [])).toBe(false);
  });
});

describe("flowDone", () => {
  it("nothing yet", () => {
    expect([...flowDone({ heard: false, takes: [], readings: 0 })]).toEqual([]);
  });
  it("a sentence recorded on its own is the sentence-by-sentence step", () => {
    expect(flowDone({ heard: false, takes: [{ group: null }], readings: 0 }).has("drill")).toBe(true);
    expect(flowDone({ heard: false, takes: [{}], readings: 0 }).has("drill")).toBe(true);
  });
  it("sentences cut from a paragraph reading are not", () => {
    const done = flowDone({ heard: false, takes: [{ group: "r1" }, { group: "r1" }], readings: 1 });
    expect(done.has("drill")).toBe(false);
    expect(done.has("read")).toBe(true);
  });
  it("heard through is the first step", () => {
    expect([...flowDone({ heard: true, takes: [], readings: 0 })]).toEqual(["listen"]);
  });
});

describe("flowNext", () => {
  it("goes in order", () => {
    expect(flowNext(new Set())).toBe("listen");
    expect(flowNext(new Set(["listen"]))).toBe("drill");
    expect(flowNext(new Set(["listen", "drill"]))).toBe("read");
    expect(flowNext(new Set(["listen", "drill", "read"]))).toBe(null);
  });
  it("doesn't send someone back to a step they skipped", () => {
    expect(flowNext(new Set(["drill"]))).toBe("read");
    expect(flowNext(new Set(["read"]))).toBe(null);
  });
});

describe("flowAuto", () => {
  it("once, on a track with sentences", () => {
    expect(flowAuto({ tips: [], sentences: 12, practicing: false })).toBe(true);
    expect(flowAuto({ tips: ["rate", FLOW_TIP], sentences: 12, practicing: false })).toBe(false);
  });
  it("not without sentences, nor on the sample", () => {
    expect(flowAuto({ tips: [], sentences: 0, practicing: false })).toBe(false);
    expect(flowAuto({ tips: [], sentences: 12, practicing: true })).toBe(false);
  });
});

describe("flowShown", () => {
  it("out of the way while recording or on the sample", () => {
    expect(flowShown({ open: true, busy: false, practicing: false })).toBe(true);
    expect(flowShown({ open: true, busy: true, practicing: false })).toBe(false);
    expect(flowShown({ open: true, busy: false, practicing: true })).toBe(false);
    expect(flowShown({ open: false, busy: false, practicing: false })).toBe(false);
  });
});

describe("byHand", () => {
  it("a second sentence recorded on its own", () => {
    expect(byHand([], 3)).toBe(false);
    expect(byHand([3], 4)).toBe(true);
    expect(byHand([3, 4], 7)).toBe(true);
  });
  it("not the same sentence again, nor an A–B loop", () => {
    expect(byHand([3, 3], 3)).toBe(false);
    expect(byHand([3], "loop")).toBe(false);
  });
});

describe("drillFrom", () => {
  it("the next sentence, staying inside the text", () => {
    expect(drillFrom(3, 10)).toBe(4);
    expect(drillFrom(9, 10)).toBe(9);
    expect(drillFrom(0, 1)).toBe(0);
  });
});
