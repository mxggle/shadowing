// Rules for 跟读录音 takes, kept pure for tests: which takes belong to a
// sentence, how the two voices line up on screen, and the words under them.
import { formatRate } from "../audio/logic";
import type { ClipPart, Take } from "./api";
import { t, tk } from "./i18n";

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

/**
 * The take to show for a sentence: the first of `prefer` that is one of its
 * takes (the one being looked at, or one from the reading playing), else the latest.
 */
export function peekTake(takes: Take[], start: number, end: number, prefer: (string | null | undefined)[]): Take | undefined {
  const own = takesFor(takes, start, end);
  for (const id of prefer) {
    const t = id ? own.find((t) => t.id === id) : undefined;
    if (t) return t;
  }
  return own.at(-1);
}

/**
 * The sentence (by index) a take was recorded against: of those it shows under,
 * the one it covers most (an A–B loop can span two). -1 for none (a sentence since removed).
 */
export function sentenceOf(take: Pick<Take, "start" | "end">, sentences: { start: number; end: number }[]): number {
  let best = -1;
  let most = 0;
  sentences.forEach((s, i) => {
    const overlap = Math.min(take.end, s.end) - Math.max(take.start, s.start);
    if (overlap > most && takesFor([take as Take], s.start, s.end).length > 0) [best, most] = [i, overlap];
  });
  return best;
}

/**
 * Listening on through the text: the next sentence after `from` you've
 * recorded, and its take — from the same reading as the one before
 * (`group`) if there is one, else the latest. Sentences not recorded are passed over,
 * and a take is only played at its own sentence, so going on always moves on.
 */
export function nextTake(takes: Take[], sentences: { start: number; end: number }[], from: number, group?: string | null): { index: number; take: Take } | null {
  for (let i = from + 1; i < sentences.length; i++) {
    const own = takesFor(takes, sentences[i].start, sentences[i].end).filter((t) => sentenceOf(t, sentences) === i);
    if (!own.length) continue;
    return { index: i, take: (group && own.find((t) => t.group === group)) || own[own.length - 1] };
  }
  return null;
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

/**
 * Where in the track a video's picture is while a take plays back: said along, the
 * original and you share the file's time, and `originalAt` places it in the track.
 * Null for takes in turns, or kept before that was.
 */
export function takeTrackTime(take: Pick<Take, "mode" | "original" | "originalAt" | "rate">, parts: ClipPart[], secs: number): number | null {
  if (inTurns(take) || take.originalAt === undefined) return null;
  const at = playheadAt(parts, secs);
  const file = at.original ?? at.mine;
  return file === null ? null : take.originalAt + (file - take.original[0]) * take.rate;
}

/** Your voice's own length: the stored stretch keeps 0.15 s before and 0.3 s after it (record/take.rs). */
export const mineSecs = (take: Take) => Math.max(0, take.mine[1] - take.mine[0] - 0.45);

/** "2.4 秒" */
export const formatSecs = (s: number) => t("{s} 秒", { s: s.toFixed(1) });

/**
 * How your length compares with the original's as you heard it (听完再说):
 * close enough reads as a match. Heard slowed down or sped up, it says so —
 * "差不多" at 0.85× is still slower than the speaker.
 */
export function paceNote(take: Take): string {
  const o = take.original[1] - take.original[0];
  const m = mineSecs(take);
  if (o <= 0 || m <= 0) return "";
  const r = m / o;
  const at = Math.abs(take.rate - 1) > 0.01 ? t("（原句放的是 {rate}）", { rate: formatRate(take.rate) }) : "";
  if (r > 1.15) return t("比原句慢 {pct}%{at}", { pct: Math.round((r - 1) * 100), at });
  if (r < 0.87) return t("比原句快 {pct}%{at}", { pct: Math.round((1 - r) * 100), at });
  return t("节奏和原句差不多{at}", { at });
}

/** Bluetooth earphones add a delay of their own that isn't measured. */
export const BLUETOOTH_LAG = tk("戴蓝牙耳机时测不准晚多少");

/** What the lag reads as, roughly (the bands are a guide, not a score; LAG_GUIDE says so). */
function lagBand(ms: number): string {
  if (ms < 500) return t("紧跟");
  return ms < 2000 ? t("学习者常见") : t("更像听完再复述");
}

/** Shown with the lag: what the bands lean on. */
export const LAG_GUIDE = tk("同传口译一般比说话人晚 2–4 秒。这几档只是参考。");

/** 边听边说: how far behind the original you were, and what that reads as ("· 紧跟"). */
/** `dub`: said to the picture (配音), so against the speaker's mouth. */
export function lagNote(ms: number | null, bluetooth = false, dub = false): string {
  if (ms === null) return "";
  if (bluetooth) return t(BLUETOOTH_LAG);
  const secs = (ms / 1000).toFixed(2);
  if (dub) return ms < 80 ? t("几乎和口型同步") : t("比口型晚 {secs} 秒", { secs });
  return ms < 80 ? t("几乎和原声同步") : `${t("比原声晚 {secs} 秒", { secs })} · ${lagBand(ms)}`;
}

/** "刚刚", "3 分钟前", "今天 14:05", "10月12日" */
export function whenRecorded(created: number, now = Date.now()): string {
  const mins = Math.floor((now - created) / 60_000);
  if (mins < 1) return t("刚刚");
  if (mins < 60) return t("{n} 分钟前", { n: mins });
  const d = new Date(created);
  const today = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === today.toDateString()) return t("今天 {time}", { time: hm });
  return t("{month}月{day}日 {time}", { month: d.getMonth() + 1, day: d.getDate(), time: hm });
}
