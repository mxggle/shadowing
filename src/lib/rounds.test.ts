import { describe, expect, it } from "vitest";
import { advanceLabel, advanceOf, clampRounds, countOf, drillNote, goesAgain, hintOf, parseRounds, readyNote, recordsAgain, type Turns } from "./rounds";

const at = (t: Partial<Turns>): Turns => ({ again: false, n: 1, max: null, phase: "speaking", along: false, ...t });

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
  it("one time: skip the original, then you're done", () => {
    expect(advanceOf(at({ phase: "listening" }))).toBe("skip");
    expect(advanceOf(at({ along: true }))).toBe("skip");
    expect(advanceOf(at({}))).toBe("keep");
  });

  it("again and again, the first time is the same: nothing said yet to keep", () => {
    expect(advanceOf(at({ again: true, phase: "listening" }))).toBe("skip");
    expect(advanceOf(at({ again: true, along: true }))).toBe("skip");
  });

  it("then, while the original plays again, it keeps the time before", () => {
    expect(advanceOf(at({ again: true, n: 2, phase: "listening" }))).toBe("keepBefore");
    expect(advanceOf(at({ again: true, n: 3, along: true }))).toBe("keepBefore");
  });

  it("and on your turn, this time", () => {
    expect(advanceOf(at({ again: true, n: 3 }))).toBe("keep");
  });
});

describe("what the card says", () => {
  it("names what Space does", () => {
    expect(advanceLabel("skip", true)).toBe("跳过原句");
    expect(advanceLabel("keep", false)).toBe("说完了");
    expect(advanceLabel("keep", true)).toBe("留下这遍");
    expect(advanceLabel("keepBefore", true)).toBe("留下上一遍");
  });

  it("counts only again and again, out of how many when drilling", () => {
    expect(countOf(at({}))).toBeNull();
    expect(countOf(at({ again: true, n: 3 }))).toBe("第 3 遍");
    expect(countOf(at({ again: true, n: 2, max: 5 }))).toBe("第 2 / 5 遍");
  });

  it("says what happens next, one line", () => {
    expect(hintOf(at({ phase: "listening" }))).toBe("听完就轮到你");
    expect(hintOf(at({ along: true }))).toBe("原句放完后，你停下就结束");
    expect(hintOf(at({}))).toBe("说完会自动停");
  });

  it("drilling once a sentence, what's next is the next sentence", () => {
    expect(hintOf(at({ max: 1 }))).toBe("说完就到下一句");
    expect(hintOf(at({ max: 1, along: true }))).toBe("原句放完后，你停下就到下一句");
  });

  it("says before it starts how a time goes", () => {
    expect(readyNote("listen")).toBe("先放一遍原句，然后轮到你说。");
    expect(readyNote("shadow")).toBe("原句一放就跟着说。");
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
