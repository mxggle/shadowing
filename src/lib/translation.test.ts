import { describe, expect, it } from "vitest";
import type { Sentence } from "./api";
import { batches, nextTranslationMode, targetLanguage, translationModeOf, translationOf, untranslated } from "./translation";

const s = (text: string): Sentence => ({ start: 0, end: 1, text });

describe("translation", () => {
  it("reads and cycles the mode", () => {
    expect(translationModeOf("blur")).toBe("blur");
    expect(translationModeOf("")).toBe("show");
    expect(nextTranslationMode("show")).toBe("blur");
    expect(nextTranslationMode("blur")).toBe("off");
    expect(nextTranslationMode("off")).toBe("show");
  });

  it("translates into the interface language unless one is picked", () => {
    expect(targetLanguage("", "zh")).toBe("zh-Hans");
    expect(targetLanguage("", "en")).toBe("en");
    expect(targetLanguage("ja", "zh")).toBe("ja");
    expect(targetLanguage("xx", "en")).toBe("en");
  });

  it("prefers the subtitles' own translation", () => {
    const t = { translations: { 今日は: "今天" } };
    expect(translationOf("今日は", t, { 今日は: "今儿" })).toBe("今天");
    expect(translationOf("暑い", t, { 暑い: "热" })).toBe("热");
    expect(translationOf("暑い", null, {})).toBe("");
  });

  it("asks only for sentences without one, each text once", () => {
    const list = [s("a"), s("b"), s("c"), s("b"), s("d")];
    expect(untranslated(list, { a: "A" }, { c: "" })).toEqual([1, 4]);
    expect(untranslated(list, undefined, {})).toEqual([0, 1, 2, 4]);
  });

  it("batches in order", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([])).toEqual([]);
  });
});
