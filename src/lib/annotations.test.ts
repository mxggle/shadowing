import { describe, expect, it } from "vitest";
import type { PluginInfo } from "./api";
import { annotationKey, markedGroups, unread } from "./annotations";

const plugin = (over: Partial<PluginInfo> = {}): PluginInfo => ({
  id: "furigana",
  name: "日语注音",
  version: "0.1.0",
  author: "",
  description: "",
  importers: [],
  annotators: ["日语注音"],
  settings: [{ key: "style", kind: "select", label: "注音用", options: [], value: "hiragana" }],
  permissions: { network: [], runs: "" },
  bytes: 0,
  problem: null,
  ...over,
});

describe("annotationKey", () => {
  it("changes with the plugins and their settings", () => {
    const a = annotationKey([plugin()]);
    expect(a).not.toBe("");
    expect(annotationKey([plugin({ settings: [{ key: "style", kind: "select", label: "", options: [], value: "romaji" }] })])).not.toBe(a);
    expect(annotationKey([plugin(), plugin({ id: "youtube", annotators: [] })])).toBe(a);
    expect(annotationKey([plugin({ problem: "broken" })])).toBe("");
    expect(annotationKey([])).toBe("");
  });
});

describe("unread", () => {
  it("asks for each text once", () => {
    expect(unread(["a", "b", "a", "c"], { b: {} })).toEqual(["a", "c"]);
  });
});

describe("markedGroups", () => {
  const marks = [{ text: "東京", ruby: "とうきょう" }, { text: "へ" }, { text: "行", ruby: "い", note: "to go" }, { text: "く" }];

  it("groups the text under the plugin's pieces", () => {
    expect(markedGroups([{ text: "東京へ行く" }], marks)).toEqual([
      { mark: { ruby: "とうきょう" }, pieces: [{ text: "東京" }] },
      { mark: undefined, pieces: [{ text: "へ" }] },
      { mark: { ruby: "い", note: "to go" }, pieces: [{ text: "行" }] },
      { mark: undefined, pieces: [{ text: "く" }] },
    ]);
  });

  it("cuts the app's pieces where the plugin's start and end", () => {
    const pieces = [
      { text: "東", said: true },
      { text: "京へ行く", said: false },
    ];
    expect(markedGroups(pieces, marks)).toEqual([
      { mark: { ruby: "とうきょう" }, pieces: [{ text: "東", said: true }, { text: "京", said: false }] },
      { mark: undefined, pieces: [{ text: "へ", said: false }] },
      { mark: { ruby: "い", note: "to go" }, pieces: [{ text: "行", said: false }] },
      { mark: undefined, pieces: [{ text: "く", said: false }] },
    ]);
  });

  it("joins the plain text between marks", () => {
    expect(markedGroups([{ text: "あの東京" }], [{ text: "あ" }, { text: "の" }, { text: "東京", mark: "underline" }])).toEqual([
      { mark: undefined, pieces: [{ text: "あ" }, { text: "の" }] },
      { mark: { mark: "underline" }, pieces: [{ text: "東京" }] },
    ]);
  });

  it("leaves out pieces for another text", () => {
    expect(markedGroups([{ text: "東京に" }], marks)).toEqual([{ pieces: [{ text: "東京に" }] }]);
    expect(markedGroups([{ text: "東京" }], undefined)).toEqual([{ pieces: [{ text: "東京" }] }]);
  });
});
