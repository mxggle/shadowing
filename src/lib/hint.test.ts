import { describe, expect, it } from "vitest";
import { TIPS } from "../guideSlice";
import { hintPieces } from "./hint";
import { fill } from "./i18n";

/** The tips with the default keys in their slots, as they're shown. */
const shown = (tip: string) => fill(tip, { sentenceLoop: "S", prev: "[", next: "]", slower: "−", faster: "=", loop: "L" });

const keys = (text: string) => hintPieces(text).filter((p) => p.key).map((p) => p.text);

describe("hintPieces", () => {
  it("finds keys named on their own, including after Chinese punctuation", () => {
    expect(keys(shown(TIPS.sentenceLoop))).toEqual(["S", "[", "]"]);
    expect(keys(shown(TIPS.rate))).toEqual(["−", "="]);
    expect(keys(shown(TIPS.abLoop))).toEqual(["L"]);
  });

  it("keeps every character, in order", () => {
    for (const tip of Object.values(TIPS).map(shown)) {
      expect(hintPieces(tip).map((p) => p.text).join("")).toBe(tip);
    }
  });

  it("ignores letters inside words", () => {
    expect(keys("用 AI 校对")).toEqual([]);
    expect(keys("S")).toEqual(["S"]);
  });
});
