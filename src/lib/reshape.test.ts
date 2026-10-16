import { describe, expect, it } from "vitest";
import { explainKey, moveExplanations, type Explain } from "../explainSlice";
import type { Section, Suggestion, Take } from "./api";
import { caretInClean, cleanText, cutRatio, cutText, joinText, movedIndex, moveSuggestions, replaceRun, restoredSections, sectionsInside, shiftSections, undoChange, undoOf, type Change } from "./reshape";
import { nextTake, sentenceOf, takeCounts, takesFor } from "./takes";

const cut = (at: number): Change => ({ at, removed: 1, added: 2 });
const join = (at: number): Change => ({ at, removed: 2, added: 1 });

describe("movedIndex", () => {
  it("moves the sentences after a change and drops the changed ones", () => {
    expect([0, 1, 2, 3].map((i) => movedIndex(i, cut(2)))).toEqual([0, 1, null, 4]);
    expect([1, 2, 3, 4].map((i) => movedIndex(i, join(2)))).toEqual([1, null, null, 3]);
  });
});

describe("sections", () => {
  const sections: Section[] = [{ start: 0 }, { start: 2, title: "駅で" }, { start: 4 }];

  it("move along after a cut, named ones keeping their name", () => {
    expect(shiftSections(sections, cut(1))).toEqual([{ start: 0 }, { start: 3, title: "駅で" }, { start: 5 }]);
    // Cutting a section's first sentence keeps the section where it starts.
    expect(shiftSections(sections, cut(2))).toEqual([{ start: 0 }, { start: 2, title: "駅で" }, { start: 5 }]);
  });

  it("a join across a section's start ends it, and undo puts it back", () => {
    const ended = sectionsInside(sections, 1, 2);
    expect(ended).toEqual([{ start: 2, title: "駅で" }]);
    const joined = shiftSections(sections, join(1));
    expect(joined).toEqual([{ start: 0 }, { start: 3 }]);
    // Renamed since: kept when the join is undone.
    const renamed = [joined[0], { start: 3, title: "カフェで" }];
    expect(restoredSections(renamed, { at: 1, removed: 1, added: 2 }, ended)).toEqual([{ start: 0 }, { start: 2, title: "駅で" }, { start: 4, title: "カフェで" }]);
  });

  it("undoing a cut takes back a section started at its second part", () => {
    const after = [{ start: 0 }, { start: 3 }, { start: 4, title: "駅で" }];
    expect(restoredSections(after, { at: 2, removed: 2, added: 1 }, [])).toEqual([{ start: 0 }, { start: 3, title: "駅で" }]);
  });
});

describe("undo", () => {
  const sentences = ["一。", "二。", "三。", "四。", "五。"].map((text, i) => ({ start: i * 2, end: i * 2 + 1.5, text }));
  const sections: Section[] = [{ start: 0 }, { start: 2, title: "駅で" }, { start: 4 }];

  /** Makes change `c` (with `added` in place), then undoes it as ⌘Z would. */
  function roundTrip(c: Change, added: typeof sentences) {
    const undo = undoOf(sentences, sections, c);
    const after = replaceRun(sentences, c, added);
    const back = undoChange(undo);
    return {
      undo,
      sentences: replaceRun(after, back, undo.sentences),
      sections: restoredSections(shiftSections(sections, c), back, undo.ended),
    };
  }

  it("puts a cut sentence back in place of both its parts", () => {
    const parts = [{ start: 2, end: 2.6, text: "二" }, { start: 2.8, end: 3.5, text: "。" }];
    const r = roundTrip(cut(1), parts);
    expect(r.undo).toMatchObject({ at: 1, count: 2 });
    expect(r.sentences).toEqual(sentences);
    expect(r.sections).toEqual(sections);
  });

  it("puts joined sentences back, and the section the join ended", () => {
    const r = roundTrip(join(1), [{ start: 2, end: 5.5, text: "二。三。" }]);
    expect(r.undo).toMatchObject({ at: 1, count: 1, ended: [{ start: 2, title: "駅で" }] });
    expect(r.sentences).toEqual(sentences);
    expect(r.sections).toEqual(sections);
  });
});

describe("text", () => {
  it("joins without a space only in Chinese and Japanese", () => {
    expect(joinText("おはよう。", "元気？")).toBe("おはよう。元気？");
    expect(joinText("你好，", "最近怎么样？")).toBe("你好，最近怎么样？");
    expect(joinText("Hello.", "How are you?")).toBe("Hello. How are you?");
    expect(joinText("안녕하세요.", "반갑습니다.")).toBe("안녕하세요. 반갑습니다.");
    expect(joinText("OK", "です")).toBe("OKです");
  });

  it("cuts at the cursor, trimming both parts, only with words on both sides", () => {
    expect(cutText("Hello there. How are you?", 12)).toEqual({ first: "Hello there.", second: "How are you?", secondFrom: 13 });
    expect(cutText("おはようございます。今日も", 10)).toEqual({ first: "おはようございます。", second: "今日も", secondFrom: 10 });
    expect(cutText("おはよう", 0)).toBeNull();
    expect(cutText("おはよう", 4)).toBeNull();
    expect(cutText("「はい」", 1)).toBeNull();
    // Not between the two halves of 𠮷.
    expect(cutText("𠮷野家です", 1)).toBeNull();
    expect(cutText("𠮷野家です", 2)?.first).toBe("𠮷");
  });

  it("guesses how far through the words a cut is", () => {
    expect(cutRatio("おはよう。", "元気？")).toBeCloseTo(4 / 6);
    expect(cutRatio("Hi, Tom.", "Bye!")).toBeCloseTo(5 / 8);
  });

  it("finds the cursor in the text as it will be saved", () => {
    expect(cleanText("  abc \n\n  def ")).toBe("abc def");
    expect(caretInClean("  abc def", 6)).toBe(3);
    expect(caretInClean("ab \n cdef", 7)).toBe(5); // "ab cd|ef"
  });
});

describe("what hangs on a sentence's place", () => {
  it("moves explanations with their sentences; the changed one's waits, unseen, for ⌘Z", () => {
    const note: Explain = { open: true, state: "unset" };
    const explain = {
      [explainKey("/a.mp3", 0, "一。")]: note,
      [explainKey("/a.mp3", 1, "二。三。")]: note,
      [explainKey("/a.mp3", 2, "四。\nline")]: note,
      [explainKey("/b.mp3", 1, "別の")]: note,
    };
    const after = moveExplanations(explain, "/a.mp3", cut(1));
    expect(Object.keys(after).sort()).toEqual(
      [explainKey("/a.mp3", 0, "一。"), explainKey("/a.mp3", 1, "二。三。"), explainKey("/a.mp3", 3, "四。\nline"), explainKey("/b.mp3", 1, "別の")].sort(),
    );
    // Undoing the cut puts each back where it was.
    expect(Object.keys(moveExplanations(after, "/a.mp3", { at: 1, removed: 2, added: 1 })).sort()).toEqual(Object.keys(explain).sort());
  });

  it("moves AI suggestions with their sentences", () => {
    const s = (index: number): Suggestion => ({ index, from: "a", to: "b", reason: "" });
    expect(moveSuggestions([s(0), s(2), s(3), s(5)], join(2)).map((x) => x.index)).toEqual([0, 4]);
  });
});

describe("takes after a cut or a join", () => {
  const take = (id: string, start: number, end: number) => ({ id, created: 0, start, end, text: "", mode: "listen", rate: 1, duration: 5, original: [0, 1], mine: [1, 2], lagMs: null, peaks: { original: [], mine: [] } }) as Take;

  it("a take of a sentence since cut shows under both parts and is played on at one", () => {
    const whole = take("1", 10, 14);
    const parts = [{ start: 10, end: 11.2 }, { start: 11.5, end: 14 }];
    expect(takeCounts([whole], parts)).toEqual([1, 1]);
    expect(sentenceOf(whole, parts)).toBe(1); // it covers more of the second
    // Listening on plays it once, at the part it belongs to.
    expect(nextTake([whole], [{ start: 5, end: 9 }, ...parts], 0)?.index).toBe(2);
    expect(nextTake([whole], [{ start: 5, end: 9 }, ...parts], 2)).toBeNull();
  });

  it("takes of two sentences since joined both belong to the joined one", () => {
    const takes = [take("a", 10, 12), take("b", 12.4, 14)];
    const joined = [{ start: 10, end: 14 }, { start: 15, end: 17 }];
    expect(takesFor(takes, 10, 14).map((t) => t.id)).toEqual(["a", "b"]);
    expect(takes.map((t) => sentenceOf(t, joined))).toEqual([0, 0]);
    expect(takeCounts(takes, joined)).toEqual([2, 0]);
  });
});
