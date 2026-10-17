import { describe, expect, it } from "vitest";
import changelog from "../../CHANGELOG.md?raw";
import pkg from "../../package.json";
import { announces, compareVersions, dateLabel, headline, highlights, highlightsSince, inline, parseChangelog } from "./changelog";

const MD = `# 更新日志

## [未发布]

### 新增
- 还没发布的东西。

## [0.8.0] - 2026-10-17

### 新增
- **自己断句、合并句子**：可以自己改。
  - 按 \`E\` 改这一句，按 \`⇧↩\` 断开。
  - 改错了，按 \`⌘Z\` 撤销。
- **连着练好几遍**：不用每遍点一下，
  满意了按空格。

### 已知限制
- 用蓝牙耳机时可能少一小段。

## [0.7.0] - 2026-10-15
- 跟读录音。

[未发布]: https://github.com/mxggle/shadowing/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/mxggle/shadowing/compare/v0.7.0...v0.8.0
`;

describe("parseChangelog", () => {
  const releases = parseChangelog(MD);

  it("keeps released versions only, newest first, with their dates", () => {
    expect(releases.map((r) => [r.version, r.date])).toEqual([
      ["0.8.0", "2026-10-17"],
      ["0.7.0", "2026-10-15"],
    ]);
  });

  it("groups points under their headings, sub-points under their point", () => {
    const [latest] = releases;
    expect(latest.groups.map((g) => [g.title, g.items.length])).toEqual([
      ["新增", 2],
      ["已知限制", 1],
    ]);
    const split = latest.groups[0].items[0];
    expect(split.children).toHaveLength(2);
    expect(split.children[0].text).toEqual([
      { kind: "text", text: "按 " },
      { kind: "key", text: "E" },
      { kind: "text", text: " 改这一句，按 " },
      { kind: "key", text: "⇧↩" },
      { kind: "text", text: " 断开。" },
    ]);
  });

  it("joins a wrapped line onto its point", () => {
    const text = releases[0].groups[0].items[1].text.map((t) => t.text).join("");
    expect(text).toBe("连着练好几遍：不用每遍点一下， 满意了按空格。");
  });

  it("puts points without a heading in an untitled group, and stops at the link list", () => {
    expect(releases[1].groups).toEqual([{ title: "", items: [{ text: [{ kind: "text", text: "跟读录音。" }], children: [] }] }]);
  });

  it("reads the real CHANGELOG.md: the newest release is this version, each has a date and points", () => {
    const real = parseChangelog(changelog);
    expect(real[0].version).toBe(pkg.version);
    for (const r of real) {
      expect(r.date, r.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.groups.flatMap((g) => g.items).length, r.version).toBeGreaterThan(0);
    }
  });
});

describe("inline", () => {
  it("splits bold, keys and links (keeping a link's text)", () => {
    expect(inline("**新**：按 `M`，见 [更新日志](https://x)。")).toEqual([
      { kind: "bold", text: "新" },
      { kind: "text", text: "：按 " },
      { kind: "key", text: "M" },
      { kind: "text", text: "，见 " },
      { kind: "text", text: "更新日志" },
      { kind: "text", text: "。" },
    ]);
  });

  it("reads a bracket key as a key, not a link", () => {
    expect(inline("按 `[` `]` 换句")).toEqual([
      { kind: "text", text: "按 " },
      { kind: "key", text: "[" },
      { kind: "text", text: " " },
      { kind: "key", text: "]" },
      { kind: "text", text: " 换句" },
    ]);
  });
});

describe("headline", () => {
  it("is the bold lead, else the whole point", () => {
    const [latest, older] = parseChangelog(MD);
    expect(headline(latest.groups[0].items[0])).toBe("自己断句、合并句子");
    expect(headline(older.groups[0].items[0])).toBe("跟读录音。");
  });
});

describe("highlights", () => {
  it("names each point, leaving out the known limits", () => {
    expect(highlights(parseChangelog(MD)[0])).toEqual(["自己断句、合并句子", "连着练好几遍"]);
  });
});

describe("highlightsSince", () => {
  const releases = parseChangelog(MD);

  it("takes in every version since the one seen, newest first", () => {
    expect(highlightsSince(releases, "0.6.0", "0.8.0")).toEqual(["自己断句、合并句子", "连着练好几遍", "跟读录音。"]);
    expect(highlightsSince(releases, "0.7.0", "0.8.0")).toEqual(["自己断句、合并句子", "连着练好几遍"]);
  });

  it("nothing newer than this version; everything when nothing was seen", () => {
    expect(highlightsSince(releases, "0.6.0", "0.7.0")).toEqual(["跟读录音。"]);
    expect(highlightsSince(releases, "", "0.8.0")).toHaveLength(3);
  });
});

describe("dateLabel", () => {
  it("leaves out this year", () => {
    expect(dateLabel("2026-10-17", 2026)).toBe("10 月 17 日");
    expect(dateLabel("2025-01-02", 2026)).toBe("2025 年 1 月 2 日");
    expect(dateLabel(null, 2026)).toBe("");
  });
});

describe("compareVersions", () => {
  it("compares part by part; no version is older than any", () => {
    expect(compareVersions("0.8.0", "0.7.0")).toBe(1);
    expect(compareVersions("0.10.0", "0.9.1")).toBe(1);
    expect(compareVersions("0.5.1", "0.5.1")).toBe(0);
    expect(compareVersions("0.5", "0.5.1")).toBe(-1);
    expect(compareVersions("0.8.0", "")).toBe(1);
    expect(compareVersions("", "0.8.0")).toBe(-1);
  });
});

describe("announces", () => {
  const releases = parseChangelog(MD);

  it("after an update to a version with notes", () => {
    expect(announces("0.8.0", "0.7.0", true, releases)).toBe(true);
    expect(announces("0.8.0", "", true, releases)).toBe(true); // from before 新功能 remembered anything
  });

  it("not on a first run, once seen, after going back, or without notes for this version", () => {
    expect(announces("0.8.0", "", false, releases)).toBe(false);
    expect(announces("0.8.0", "0.8.0", true, releases)).toBe(false);
    expect(announces("0.7.0", "0.8.0", true, releases)).toBe(false);
    expect(announces("0.8.1", "0.8.0", true, releases)).toBe(false);
  });
});
