import { describe, expect, it } from "vitest";
import type { FolderEntry } from "./api";
import { firstFocus, folderHolding, holds, others, switcherGroups } from "./folders";

const folder = (path: string, extra: Partial<FolderEntry> = {}): FolderEntry => ({
  path,
  name: path.split(/[\\/]/).pop() ?? path,
  place: "~",
  pinned: false,
  current: false,
  missing: false,
  recency: 0,
  ...extra,
});

describe("switcher", () => {
  const list = [
    folder("/p/新标日", { pinned: true, recency: 3 }),
    folder("/r/NHK", { current: true, recency: 0 }),
    folder("/r/TED", { recency: 1 }),
    folder("/r/U盘", { recency: 2, missing: true }),
  ];

  it("groups pinned and recent folders in the order given", () => {
    const { pinned, recent } = switcherGroups(list);
    expect(pinned.map((f) => f.name)).toEqual(["新标日"]);
    expect(recent.map((f) => f.name)).toEqual(["NHK", "TED", "U盘"]);
    expect(others(list).map((f) => f.name)).toEqual(["新标日", "TED", "U盘"]);
  });

  it("starts on the folder you were in before, even when another is pinned", () => {
    expect(firstFocus(list)).toBe("/r/TED");
    expect(firstFocus([folder("/a", { current: true })])).toBeNull();
    expect(firstFocus([folder("/a", { current: true }), folder("/b", { missing: true, recency: 1 })])).toBeNull();
  });
});

describe("folderHolding", () => {
  it("matches whole folder names only", () => {
    expect(holds("/a", "/a/x.mp3")).toBe(true);
    expect(holds("/a/", "/a/x.mp3")).toBe(true);
    expect(holds("/a", "/ab/x.mp3")).toBe(false);
    expect(holds("C:\\日语", "C:\\日语\\1.mp3")).toBe(true);
  });

  it("finds the deepest known folder, skipping the open and missing ones", () => {
    const list = [
      folder("/m"),
      folder("/m/日语"),
      folder("/now", { current: true }),
      folder("/gone", { missing: true }),
    ];
    expect(folderHolding(list, "/m/日语/1.mp3")?.path).toBe("/m/日语");
    expect(folderHolding(list, "/m/英语/1.mp3")?.path).toBe("/m");
    expect(folderHolding(list, "/now/1.mp3")).toBeNull();
    expect(folderHolding(list, "/gone/1.mp3")).toBeNull();
    expect(folderHolding(list, "/else/1.mp3")).toBeNull();
  });
});
