import { describe, expect, it } from "vitest";
import { TIPS } from "../guideSlice";
import { hintPieces } from "./hint";

const keys = (text: string) => hintPieces(text).filter((p) => p.key).map((p) => p.text);

describe("hintPieces", () => {
  it("finds keys named on their own, including after Chinese punctuation", () => {
    expect(keys(TIPS.sentenceLoop)).toEqual(["S", "[", "]"]);
    expect(keys(TIPS.rate)).toEqual(["−", "="]);
    expect(keys(TIPS.abLoop)).toEqual(["L"]);
  });

  it("keeps every character, in order", () => {
    for (const tip of Object.values(TIPS)) {
      expect(hintPieces(tip).map((p) => p.text).join("")).toBe(tip);
    }
  });

  it("ignores letters inside words", () => {
    expect(keys("用 AI 校对")).toEqual([]);
    expect(keys("S")).toEqual(["S"]);
  });
});
