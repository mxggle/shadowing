// The one-time question after a few days of practice (components/guide/AskCard.tsx):
// how many days count, and when the card may come up without getting in the way.
import type { DayTotal } from "./practice";

/** Days with some practice before the card asks its one question. */
export const ASK_AFTER_DAYS = 3;
/** A day counts once it has this much practice. */
const DAY_MS = 60_000;
/** Nothing playing or being recorded, and no key or click, for this long: a break, not the pause between two sentences. */
export const QUIET_MS = 20_000;
/** Kept in guide.tips once the card has come up, so it never comes back after this run of the app. */
export const ASK_TIP = "askFeedback";
/** The answer's `kind` at the feedback endpoint (site/api/feedback.js), so it's told apart from the 意见反馈 window's. */
export const ASK_KIND = "card-3days";

/** Practice days with at least a minute, today included once it has one. */
export function practisedDays(days: Map<string, DayTotal>): number {
  let n = 0;
  for (const day of days.values()) if (day.active >= DAY_MS) n++;
  return n;
}

/** Whether today has a minute yet: the count changes then (and when a new practice day starts). */
export const todayCounts = (todayMs: number | null) => (todayMs ?? 0) >= DAY_MS;

/** Whether the card may come up at all (it still waits for a quiet moment). */
export function shouldAsk(askedBefore: boolean, days: number): boolean {
  return !askedBefore && days >= ASK_AFTER_DAYS;
}
