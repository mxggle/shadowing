import { describe, expect, it } from "vitest";
import { advanceLabel, advanceOf, countOf, hintOf, readyNote, recordsAgain, type Turns } from "./rounds";

const at = (t: Partial<Turns>): Turns => ({ again: false, n: 1, phase: "speaking", along: false, ...t });

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

  it("counts only again and again", () => {
    expect(countOf(at({}))).toBeNull();
    expect(countOf(at({ again: true, n: 3 }))).toBe("第 3 遍");
  });

  it("says what happens next, one line", () => {
    expect(hintOf(at({ phase: "listening" }))).toBe("听完就轮到你");
    expect(hintOf(at({ along: true }))).toBe("原句放完后，你停下就结束");
    expect(hintOf(at({}))).toBe("说完会自动停");
  });

  it("says before it starts how it'll go", () => {
    expect(readyNote("listen", false)).toBe("先放一遍原句，然后轮到你说。");
    expect(readyNote("shadow", false)).toBe("原句一放就跟着说。");
    expect(readyNote("listen", true)).toContain("满意了按空格留下");
    expect(readyNote("shadow", true)).toContain("满意了按空格留下");
  });
});
