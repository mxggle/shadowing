// Practice time per day, streaks and totals, from the sessions Rust records
// (see src-tauri/src/practice/clock.rs for what counts as practice).
import type { GoalChange, PracticeSession } from "./api";

/** A late session (until 4:00) still counts for the day before, as in Anki: night owls keep their streak. */
export const DAY_START_HOUR = 4;
const MIN = 60_000;
/** Until the learner picks one: short enough to do every day. */
export const DEFAULT_GOAL_MINUTES = 15;
/** 0 = no goal: then any day with a minute of practice counts. */
export const GOAL_CHOICES = [0, 5, 10, 15, 20, 30, 45, 60];

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

/** The goal (minutes) for a practice day: the latest change made on or before it. */
export function goalOn(goals: GoalChange[], key: string): number {
  let minutes = DEFAULT_GOAL_MINUTES;
  for (const g of goals) if (g.since <= key) minutes = g.minutes;
  return minutes;
}

/** A new goal from `key` on; days before keep the goal they had. */
export function withGoal(goals: GoalChange[], key: string, minutes: number): GoalChange[] {
  // Changing it twice in a day keeps only the last one.
  return [...goals.filter((g) => g.since < key), { since: key, minutes }];
}

/** Whether a day's practice reaches its goal (with no goal: at least a minute). */
export function metGoal(active: number, goalMinutes: number): boolean {
  return active >= Math.max(1, goalMinutes) * MIN;
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

/** Days in a row that met their goal, ending today, or yesterday while today isn't done yet. */
export function streak(days: Map<string, DayTotal>, goals: GoalChange[], now: number): number {
  const met = (ms: number) => {
    const key = dayKey(ms);
    return metGoal(days.get(key)?.active ?? 0, goalOn(goals, key));
  };
  let day = met(now) ? now : shiftDay(now, -1);
  let count = 0;
  while (met(day)) {
    count++;
    day = shiftDay(day, -1);
  }
  return count;
}

/** The longest run of days in a row that met their goal, ever. */
export function longestStreak(days: Map<string, DayTotal>, goals: GoalChange[]): number {
  const met = [...days].filter(([k, d]) => metGoal(d.active, goalOn(goals, k))).map(([k]) => k).sort();
  let best = 0;
  let run = 0;
  let prev = "";
  for (const key of met) {
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
  /** Today's goal in minutes (0 = none). */
  goal: number;
  /** How many of the last 7 days met their goal. */
  weekMet: number;
  streak: number;
  longestStreak: number;
}

export function summarize(sessions: PracticeSession[], goals: GoalChange[], now: number): Summary {
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
    goal: goalOn(goals, dayKey(now)),
    weekMet: week.filter((k) => metGoal(days.get(k)?.active ?? 0, goalOn(goals, k))).length,
    streak: streak(days, goals, now),
    longestStreak: longestStreak(days, goals),
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
  const minutes = active / MIN;
  if (minutes < 1) return 0;
  if (minutes < 10) return 1;
  if (minutes < 20) return 2;
  if (minutes < 40) return 3;
  return 4;
}
