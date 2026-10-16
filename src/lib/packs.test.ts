import { describe, expect, it } from "vitest";
import type { PackInfo } from "./api";
import { formatLength, formatSize, packFacts, packStage } from "./packs";

const pack: PackInfo = {
  id: "tokyo-daily",
  version: 2,
  title: "东京日常会话",
  description: "",
  language: "ja",
  level: "N5–N4",
  voice: "ai",
  tracks: 10,
  duration: 452,
  size: 3_870_000,
  installed: null,
  folder: null,
  available: true,
};

describe("packStage", () => {
  it("offers a download until it's on this Mac, then practice", () => {
    expect(packStage(pack, null)).toEqual({ kind: "get" });
    expect(packStage({ ...pack, installed: 2 }, null)).toEqual({ kind: "ready", update: false });
  });

  it("offers an update only when the server has a newer version", () => {
    expect(packStage({ ...pack, installed: 1 }, null)).toEqual({ kind: "ready", update: true });
    // Offline: the copy on this Mac is all that's known.
    expect(packStage({ ...pack, installed: 1, available: false }, null)).toEqual({ kind: "ready", update: false });
  });

  it("shows its own download's progress or failure, not another pack's", () => {
    expect(packStage(pack, { state: "running", id: pack.id, done: 1e6, total: 0 })).toEqual({ kind: "running", done: 1e6, total: pack.size });
    expect(packStage(pack, { state: "running", id: "other", done: 1, total: 2 })).toEqual({ kind: "get" });
    expect(packStage({ ...pack, installed: 1 }, { state: "failed", id: pack.id, message: "连不上" })).toEqual({ kind: "failed", message: "连不上", installed: true });
    expect(packStage(pack, { state: "cancelled", id: pack.id })).toEqual({ kind: "get" });
  });
});

describe("pack facts", () => {
  it("reads sizes and lengths the way a learner would say them", () => {
    expect(formatSize(3_870_000)).toBe("3.9 MB");
    expect(formatSize(42_400_000)).toBe("42 MB");
    expect(formatSize(1_500_000_000)).toBe("1.5 GB");
    expect(formatLength(45)).toBe("不到 1 分钟");
    expect(formatLength(452)).toBe("约 8 分钟");
    expect(packFacts(pack)).toBe("10 段 · 约 8 分钟 · 3.9 MB");
  });
});
