// Practice time per day, streaks and totals, from the sessions Rust records
// (see src-tauri/src/practice/clock.rs for what counts as practice).
import type { PracticeSession } from "./api";

/** A late session (until 4:00) still counts for the day before, as in Anki: night owls keep their streak. */
export const DAY_START_HOUR = 4;
/** A day counts towards the streak with at least this much practice. */
export const STREAK_MIN_MS = 60_000;

export interface DayTotal {
  /** Ms practised (playing plus short pauses). */
  active: number;
  /** Ms of that the audio was playing. */
  played: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Calendar date as "2026-10-11". */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Start (local 4:00) of the practice day `ms` falls in. */
export function dayStart(ms: number): number {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_START_HOUR);
  if (start.getTime() > ms) start.setDate(start.getDate() - 1);
  return start.getTime();
}

/** Practice day of a moment, named by its calendar date. */
export function dayKey(ms: number): string {
  return dateKey(new Date(dayStart(ms)));
}

/** The day `days` after (or before) the practice day of `ms`; DST-safe. */
export function shiftDay(ms: number, days: number): number {
  const d = new Date(dayStart(ms));
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Totals per practice day; a session crossing 4:00 is split, its playback shared out in proportion. */
export function byDay(sessions: PracticeSession[]): Map<string, DayTotal> {
  const days = new Map<string, DayTotal>();
  for (const s of sessions) {
    const length = s.end - s.start;
    let from = s.start;
    while (from < s.end) {
      const to = Math.min(s.end, shiftDay(from, 1));
      const part = to - from;
      const key = dayKey(from);
      const day = days.get(key) ?? { active: 0, played: 0 };
      day.active += part;
      day.played += (s.played * part) / length;
      days.set(key, day);
      from = to;
    }
  }
  return days;
}

/** Days in a row with practice, ending today, or yesterday while today hasn't started. */
export function streak(days: Map<string, DayTotal>, now: number): number {
  const practised = (ms: number) => (days.get(dayKey(ms))?.active ?? 0) >= STREAK_MIN_MS;
  let day = practised(now) ? now : shiftDay(now, -1);
  let count = 0;
  while (practised(day)) {
    count++;
    day = shiftDay(day, -1);
  }
  return count;
}

/** The longest run of days in a row with practice, ever. */
export function longestStreak(days: Map<string, DayTotal>): number {
  const practised = [...days].filter(([, d]) => d.active >= STREAK_MIN_MS).map(([k]) => k).sort();
  let best = 0;
  let run = 0;
  let prev = "";
  for (const key of practised) {
    const [y, m, d] = key.split("-").map(Number);
    run = prev && dateKey(new Date(y, m - 1, d - 1)) === prev ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return best;
}

export interface Summary {
  days: Map<string, DayTotal>;
  today: DayTotal;
  /** Today and the 6 days before it. */
  week: DayTotal;
  total: DayTotal;
  streak: number;
  longestStreak: number;
}

export function summarize(sessions: PracticeSession[], now: number): Summary {
  const days = byDay(sessions);
  const sum = (keys: string[]) =>
    keys.reduce((acc, k) => {
      const d = days.get(k);
      return d ? { active: acc.active + d.active, played: acc.played + d.played } : acc;
    }, { active: 0, played: 0 });
  const week = Array.from({ length: 7 }, (_, i) => dayKey(shiftDay(now, -i)));
  return {
    days,
    today: sum([dayKey(now)]),
    week: sum(week),
    total: sum([...days.keys()]),
    streak: streak(days, now),
    longestStreak: longestStreak(days),
  };
}

/** Most practised audio since `since` (ms), most first. */
export function topAudios(sessions: PracticeSession[], since: number, limit = 5): { audio: string; active: number }[] {
  const time = new Map<string, number>();
  for (const s of sessions) {
    const part = s.end - Math.max(s.start, since);
    if (part > 0) time.set(s.audio, (time.get(s.audio) ?? 0) + part);
  }
  return [...time]
    .map(([audio, active]) => ({ audio, active }))
    .sort((a, b) => b.active - a.active)
    .slice(0, limit);
}

/** 0 → "0 分钟", 40 s → "不到 1 分钟", 25 min → "25 分钟", 130 min → "2 小时 10 分". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes === 0) return ms > 0 ? "不到 1 分钟" : "0 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

/** Same, split into number and unit for big readouts: [["2", "小时"], ["10", "分"]]. */
export function durationParts(ms: number): [string, string][] {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return [[String(minutes), "分钟"]];
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? [[String(h), "小时"], [String(m), "分"]] : [[String(h), "小时"]];
}

/** Heatmap shade 0–4 for a day's practice: none, under 10, 20, 40 minutes, more. */
export function level(active: number): number {
  const minutes = active / 60_000;
  if (minutes < 1) return 0;
  if (minutes < 10) return 1;
  if (minutes < 20) return 2;
  if (minutes < 40) return 3;
  return 4;
}
