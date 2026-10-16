import { describe, expect, it } from "vitest";
import { advanceLabel, advanceOf, clampRounds, countOf, drillNote, goesAgain, hintOf, parseRounds, readyNote, recordsAgain, type Turns } from "./rounds";

const at = (t: Partial<Turns>): Turns => ({ again: false, n: 1, max: null, phase: "speaking", along: false, tail: false, ...t });
/** 边听边说: the original playing, or (`tail`) finished. */
const along = (t: Partial<Turns>): Turns => at({ along: true, ...t });

describe("recordsAgain", () => {
  it("is what is looping: the sentence looped, or the A–B loop", () => {
    expect(recordsAgain(3, 3, true)).toBe(true);
    expect(recordsAgain("loop", null, true)).toBe(true);
  });

  it("is one time otherwise: another sentence, or nothing looping", () => {
    expect(recordsAgain(4, 3, true)).toBe(false);
    expect(recordsAgain(3, null, true)).toBe(false);
    expect(recordsAgain(3, 3, false)).toBe(false);
  });
});

describe("goesAgain", () => {
  it("one time: you stop, it stops", () => {
    expect(goesAgain(at({}))).toBe(false);
    expect(goesAgain(at({ max: 1 }))).toBe(false);
  });

  it("again and again: until you keep one", () => {
    expect(goesAgain(at({ again: true, n: 9 }))).toBe(true);
  });

  it("drilling: up to the number of times, then the next sentence", () => {
    expect(goesAgain(at({ again: true, n: 2, max: 3 }))).toBe(true);
    expect(goesAgain(at({ again: true, n: 3, max: 3 }))).toBe(false);
  });
});

describe("advanceOf", () => {
  it("听完再说 one time: skip the original, then you're done", () => {
    expect(advanceOf(at({ phase: "listening" }))).toBe("skip");
    expect(advanceOf(at({}))).toBe("keep");
  });

  it("边听边说 has no original to skip: you're saying it, so it stops and keeps that", () => {
    expect(advanceOf(along({}))).toBe("keep");
    expect(advanceOf(along({ tail: true }))).toBe("keep");
  });

  it("again and again, the first time is the same: nothing said before it to keep", () => {
    expect(advanceOf(at({ again: true, phase: "listening" }))).toBe("skip");
    expect(advanceOf(along({ again: true }))).toBe("keep");
  });

  it("then, while the original plays again, it keeps the time before", () => {
    expect(advanceOf(at({ again: true, n: 2, phase: "listening" }))).toBe("keepBefore");
    expect(advanceOf(along({ again: true, n: 3 }))).toBe("keepBefore");
  });

  it("and once it has played (your turn, or your last words along), this time", () => {
    expect(advanceOf(at({ again: true, n: 3 }))).toBe("keep");
    expect(advanceOf(along({ again: true, n: 3, tail: true }))).toBe("keep");
  });
});

describe("what the card says", () => {
  it("names what Space does", () => {
    expect(advanceLabel(at({ phase: "listening" }))).toBe("跳过原句");
    expect(advanceLabel(at({}))).toBe("说完了");
    expect(advanceLabel(at({ again: true, n: 2 }))).toBe("留下这遍");
    expect(advanceLabel(at({ again: true, n: 2, phase: "listening" }))).toBe("留下上一遍");
  });

  it("边听边说: stop, never skip the original or wait for your turn", () => {
    expect(advanceLabel(along({}))).toBe("停下");
    expect(advanceLabel(along({ tail: true }))).toBe("停下");
    expect(advanceLabel(along({ again: true }))).toBe("停下");
    expect(advanceLabel(along({ again: true, tail: true }))).toBe("停下");
    expect(advanceLabel(along({ again: true, n: 2 }))).toBe("留下上一遍");
    expect(advanceLabel(along({ again: true, n: 2, tail: true }))).toBe("留下这遍");
  });

  it("边听边说 drilling, keeping it is going on to the next sentence (停下 is the drill's own)", () => {
    expect(advanceLabel(along({ max: 1 }))).toBe("下一句");
    expect(advanceLabel(along({ again: true, max: 3 }))).toBe("下一句");
    expect(advanceLabel(along({ again: true, n: 2, max: 3 }))).toBe("留下上一遍");
    expect(advanceLabel(along({ again: true, n: 2, max: 3, tail: true }))).toBe("留下这遍");
  });

  it("counts only again and again, out of how many when drilling", () => {
    expect(countOf(at({}))).toBeNull();
    expect(countOf(at({ again: true, n: 3 }))).toBe("第 3 遍");
    expect(countOf(at({ again: true, n: 2, max: 5 }))).toBe("第 2 / 5 遍");
  });

  it("says what happens next, one line", () => {
    expect(hintOf(at({ phase: "listening" }))).toEqual({ text: "听完就轮到你" });
    expect(hintOf(at({}))).toEqual({ text: "说完会自动停" });
  });

  it("边听边说 ends with the original, not with a turn of yours after it", () => {
    for (const t of [along({}), along({ tail: true })]) expect(hintOf(t)).toEqual({ text: "放完自动停" });
    expect(hintOf(along({ max: 1 }))).toEqual({ text: "放完自动到下一句" });
  });

  it("drilling once a sentence, what's next is the next sentence", () => {
    expect(hintOf(at({ max: 1 }))).toEqual({ text: "说完就到下一句" });
  });

  it("again and again: how the next time comes, and Space to keep one", () => {
    expect(hintOf(at({ again: true, n: 2 }))).toEqual({ text: "说完自动接下一遍，满意了按", space: "" });
    expect(hintOf(along({ again: true, n: 2 }))).toEqual({ text: "放完自动接下一遍，满意了按", space: "" });
    expect(hintOf(along({ again: true, n: 2, max: 3 }))).toEqual({ text: "放完自动接下一遍，满意了按", space: " 到下一句" });
    expect(hintOf(along({ again: true, n: 3, max: 3 }))).toEqual({ text: "最后一遍，放完到下一句" });
    expect(hintOf(at({ again: true, n: 3, max: 3 }))).toEqual({ text: "最后一遍，说完到下一句" });
  });

  it("says before it starts how a time goes", () => {
    expect(readyNote("listen")).toBe("先放一遍原句，然后轮到你说。");
    expect(readyNote("shadow")).toBe("原句一放就跟着说，放完自动停。");
  });
});

describe("每句几遍", () => {
  it("takes a whole number from 1 to 20", () => {
    expect(parseRounds("3")).toBe(3);
    expect(parseRounds(" 12 ")).toBe(12);
    expect(parseRounds("20")).toBe(20);
  });

  it("refuses anything else, so the last good one stays", () => {
    for (const bad of ["", "0", "21", "2.5", "-1", "三", "3遍"]) expect(parseRounds(bad)).toBeNull();
  });

  it("keeps a stored or stepped number in range", () => {
    expect(clampRounds(0)).toBe(1);
    expect(clampRounds(25)).toBe(20);
    expect(clampRounds(Number.NaN)).toBe(1);
    expect(clampRounds(4)).toBe(4);
  });

  it("says how it goes, with the number", () => {
    expect(drillNote("listen", 3)).toContain("说满 3 遍自动下一句");
    expect(drillNote("shadow", 2)).toContain("跟着原句说");
    expect(drillNote("listen", 1)).toBe("一句一句来：先放原句再轮到你，说完就到下一句。");
  });
});
