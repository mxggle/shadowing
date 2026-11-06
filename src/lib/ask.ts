// The one-time question after a few days of practice (components/guide/AskCard.tsx):
// how many days count, and when the card may come up without getting in the way.
import { type DayTotal, dayKey } from "./practice";

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

/** Practice days before today with at least a minute (today joins once it has one, see askDays). */
export function daysBefore(days: Map<string, DayTotal>, now: number): number {
  const today = dayKey(now);
  let n = 0;
  for (const [key, day] of days) if (key < today && day.active >= DAY_MS) n++;
  return n;
}

/** Days practised so far: the earlier ones plus today once it has a minute. */
export function askDays(before: number, todayMs: number | null): number {
  return before + ((todayMs ?? 0) >= DAY_MS ? 1 : 0);
}

/** Whether the card may come up at all (it still waits for a quiet moment). */
export function shouldAsk(askedBefore: boolean, days: number): boolean {
  return !askedBefore && days >= ASK_AFTER_DAYS;
}
