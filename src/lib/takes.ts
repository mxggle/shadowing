// Rules for 跟读录音 takes, kept pure for tests: which takes belong to a
// sentence, how the two voices line up on screen, and the words under them.
import type { ClipPart, Take } from "./api";

/** Whether a take has you after the original (听完再说, or cut from a paragraph read on your own) rather than over it. */
export const inTurns = (take: Pick<Take, "mode">) => take.mode !== "shadow";

/** What "compare" means for a take: one after the other, or both at once. */
export const comparePart = (take: Pick<Take, "mode">) => (inTurns(take) ? "compare" : "together");

/** Takes of the stretch `start`–`end`: most of the take's stretch lies inside it. */
export function takesFor(takes: Take[], start: number, end: number): Take[] {
  return takes.filter((t) => {
    const overlap = Math.min(t.end, end) - Math.max(t.start, start);
    return overlap > 0 && overlap >= 0.5 * Math.min(t.end - t.start, end - start);
  });
}

/** Number of takes per sentence (by index), for the marks on the rows. */
export function takeCounts(takes: Take[], sentences: { start: number; end: number }[]): number[] {
  return sentences.map((s) => takesFor(takes, s.start, s.end).length);
}

export interface Lanes {
  /** Seconds of the take shown across the full width. */
  width: number;
  /** Where each lane starts in the take (its left edge). */
  original: number;
  mine: number;
}

/**
 * How the two voices sit on screen. 听完再说: each from its own first sound, so
 * rhythm and length compare at a glance. 边听边说: the real timeline, so the lag shows.
 */
export function lanes(take: Take): Lanes {
  const [oa, ob] = take.original;
  const [ma, mb] = take.mine;
  if (inTurns(take)) return { width: Math.max(ob - oa, mb - ma), original: oa, mine: ma };
  const from = Math.min(oa, ma);
  return { width: Math.max(ob, mb) - from, original: from, mine: from };
}

/** Where a clip `secs` in is, as a place in the take on each lane it sounds on. */
export function playheadAt(parts: ClipPart[], secs: number): { original: number | null; mine: number | null } {
  const part = [...parts].reverse().find((p) => secs >= p.clipAt);
  const none = { original: null, mine: null };
  if (!part) return none;
  const at = part.from + (secs - part.clipAt);
  if (at > part.to) return none;
  if (part.lane === "both") return { original: at, mine: at };
  return { ...none, [part.lane]: at };
}

/** Your voice's own length: the stored stretch keeps 0.15 s before and 0.3 s after it (record/take.rs). */
export const mineSecs = (take: Take) => Math.max(0, take.mine[1] - take.mine[0] - 0.45);

/** "2.4 秒" */
export const formatSecs = (s: number) => `${s.toFixed(1)} 秒`;

/** How your length compares with the original's (听完再说): close enough reads as a match. */
export function paceNote(take: Take): string {
  const o = take.original[1] - take.original[0];
  const m = mineSecs(take);
  if (o <= 0 || m <= 0) return "";
  const r = m / o;
  if (r > 1.15) return `比原句慢 ${Math.round((r - 1) * 100)}%`;
  if (r < 0.87) return `比原句快 ${Math.round((1 - r) * 100)}%`;
  return "节奏和原句差不多";
}

/** 边听边说: how far behind the original you were. */
export function lagNote(ms: number | null): string {
  if (ms === null) return "";
  return ms < 80 ? "几乎和原声同步" : `比原声晚 ${(ms / 1000).toFixed(2)} 秒`;
}

/** "刚刚", "3 分钟前", "今天 14:05", "10月12日" */
export function whenRecorded(created: number, now = Date.now()): string {
  const mins = Math.floor((now - created) / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const d = new Date(created);
  const today = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === today.toDateString()) return `今天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
