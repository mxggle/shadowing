import { describe, expect, it } from "vitest";
import { noteLines, percent } from "./update";

describe("noteLines", () => {
  const notes = [
    "### 新增",
    "- 学习记录（顶栏的**图表**按钮）：今天练了多久。",
    "  - 只算真正在练的时间。",
    "- 按 `L` 循环，见 [说明](https://example.com)。",
    "",
    "### 修复",
    "- 第三条",
    "* 第四条",
    "- 第五条",
  ].join("\n");

  it("keeps top-level points as plain text", () => {
    expect(noteLines(notes, 2)).toEqual({
      lines: ["学习记录（顶栏的图表按钮）：今天练了多久。", "按 L 循环，见 说明。"],
      more: true,
    });
  });

  it("says when nothing was cut", () => {
    expect(noteLines(notes, 5).more).toBe(false);
    expect(noteLines(null)).toEqual({ lines: [], more: false });
  });
});

describe("percent", () => {
  it("rounds down and caps at 100", () => {
    expect(percent(499, 1000)).toBe(49);
    expect(percent(1200, 1000)).toBe(100);
  });

  it("is unknown without a size", () => {
    expect(percent(10, null)).toBeNull();
    expect(percent(10, 0)).toBeNull();
  });
});
