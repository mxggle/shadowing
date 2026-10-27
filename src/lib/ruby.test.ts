import { describe, expect, it } from "vitest";
import type { PluginInfo } from "./api";
import { rubyGroups, rubyKey, transcriptLanguage, unread } from "./ruby";

const plugin = (over: Partial<PluginInfo> = {}): PluginInfo => ({
  id: "furigana",
  name: "日语注音",
  version: "0.1.0",
  author: "",
  description: "",
  importers: [],
  readings: ["ja"],
  settings: [{ key: "style", label: "注音用", options: [], value: "hiragana" }],
  permissions: { network: [], runs: "" },
  bytes: 0,
  problem: null,
  ...over,
});

describe("transcriptLanguage", () => {
  it("tells Japanese by its kana", () => {
    expect(transcriptLanguage(["今日は東京へ行きました。", "そうですね"])).toBe("ja");
    expect(transcriptLanguage(["今天我去了东京。", "是的"])).toBeNull();
    expect(transcriptLanguage(["Hello there.", "Fine."])).toBeNull();
    expect(transcriptLanguage([])).toBeNull();
    // A Chinese transcript with one quoted Japanese word isn't Japanese.
    expect(transcriptLanguage(["他说了「すごい」", "一", "二", "三", "四", "五"])).toBeNull();
  });
});

describe("rubyKey", () => {
  it("changes with the plugin and its settings", () => {
    const a = rubyKey([plugin()], "ja");
    expect(a).not.toBe("");
    expect(rubyKey([plugin({ settings: [{ key: "style", label: "", options: [], value: "romaji" }] })], "ja")).not.toBe(a);
    expect(rubyKey([plugin()], null)).toBe("");
    expect(rubyKey([plugin({ problem: "broken" })], "ja")).toBe("");
    expect(rubyKey([plugin({ readings: [] })], "ja")).toBe("");
  });
});

describe("unread", () => {
  it("asks for each text once", () => {
    expect(unread(["a", "b", "a", "c"], { b: [] })).toEqual(["a", "c"]);
  });
});

describe("rubyGroups", () => {
  const ruby = [{ text: "東京", ruby: "とうきょう" }, { text: "へ" }, { text: "行", ruby: "い" }, { text: "く" }];

  it("groups the text under its readings", () => {
    expect(rubyGroups([{ text: "東京へ行く" }], ruby)).toEqual([
      { ruby: "とうきょう", pieces: [{ text: "東京" }] },
      { ruby: undefined, pieces: [{ text: "へ" }] },
      { ruby: "い", pieces: [{ text: "行" }] },
      { ruby: undefined, pieces: [{ text: "く" }] },
    ]);
  });

  it("cuts marked pieces where readings start and end", () => {
    const pieces = [
      { text: "東", said: true },
      { text: "京へ行く", said: false },
    ];
    expect(rubyGroups(pieces, ruby)).toEqual([
      { ruby: "とうきょう", pieces: [{ text: "東", said: true }, { text: "京", said: false }] },
      { ruby: undefined, pieces: [{ text: "へ", said: false }] },
      { ruby: "い", pieces: [{ text: "行", said: false }] },
      { ruby: undefined, pieces: [{ text: "く", said: false }] },
    ]);
  });

  it("joins the text between readings", () => {
    expect(rubyGroups([{ text: "あの東京" }], [{ text: "あ" }, { text: "の" }, { text: "東京", ruby: "とうきょう" }])).toEqual([
      { ruby: undefined, pieces: [{ text: "あ" }, { text: "の" }] },
      { ruby: "とうきょう", pieces: [{ text: "東京" }] },
    ]);
  });

  it("leaves out readings for another text", () => {
    expect(rubyGroups([{ text: "東京に" }], ruby)).toEqual([{ pieces: [{ text: "東京に" }] }]);
    expect(rubyGroups([{ text: "東京" }], undefined)).toEqual([{ pieces: [{ text: "東京" }] }]);
  });
});
