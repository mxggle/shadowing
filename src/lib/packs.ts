// 素材库 rules: what a pack's card offers (download, progress, practise, update)
// and how its size and length read.
import type { PackInfo, PackStatus } from "./api";

export type PackStage =
  /** Not on this Mac. */
  | { kind: "get" }
  | { kind: "running"; done: number; total: number }
  /** Downloaded; `update` when the server has a newer version. */
  | { kind: "ready"; update: boolean }
  /** The last download of it failed; it can be tried again. */
  | { kind: "failed"; message: string; installed: boolean };

export function packStage(pack: PackInfo, download: PackStatus | null): PackStage {
  const mine = download?.id === pack.id ? download : null;
  if (mine?.state === "running") return { kind: "running", done: mine.done, total: mine.total || pack.size };
  if (mine?.state === "failed") return { kind: "failed", message: mine.message, installed: pack.installed !== null };
  if (pack.installed !== null) return { kind: "ready", update: pack.available && pack.version > pack.installed };
  return { kind: "get" };
}

/** "3.9 MB": one decimal while small, so a 3.6 MB pack doesn't read as 4 MB. */
export function formatSize(bytes: number): string {
  const mb = bytes / 1e6;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return mb < 10 ? `${Math.max(0.1, mb).toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** "约 7 分钟" of audio. */
export function formatLength(seconds: number): string {
  return seconds < 60 ? "不到 1 分钟" : `约 ${Math.round(seconds / 60)} 分钟`;
}

/** "10 段 · 约 7 分钟 · 3.9 MB" */
export const packFacts = (pack: PackInfo) => `${pack.tracks} 段 · ${formatLength(pack.duration)} · ${formatSize(pack.size)}`;
