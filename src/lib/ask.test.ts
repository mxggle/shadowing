import { describe, expect, it } from "vitest";
import { askDays, daysBefore, shouldAsk } from "./ask";
import { byDay } from "./practice";

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const MIN = 60_000;
const session = (start: number, minutes: number) => ({ audio: "/a.mp3", start, end: start + minutes * MIN, played: minutes * MIN });

describe("the one-time question", () => {
  const now = at(2026, 11, 6, 20);

  it("counts earlier days with at least a minute, not today", () => {
    const days = byDay([
      session(at(2026, 11, 1, 9), 10),
      session(at(2026, 11, 2, 9), 0.5), // under a minute
      session(at(2026, 11, 4, 9), 1),
      session(at(2026, 11, 6, 9), 30), // today
    ]);
    expect(daysBefore(days, now)).toBe(2);
  });

  it("counts a late session (before 4:00) for the day before", () => {
    const days = byDay([session(at(2026, 11, 6, 2), 10)]);
    expect(daysBefore(days, now)).toBe(1);
  });

  it("adds today once it has a minute", () => {
    expect(askDays(2, null)).toBe(2);
    expect(askDays(2, 59_000)).toBe(2);
    expect(askDays(2, MIN)).toBe(3);
  });

  it("asks from the third day, and only if it hasn't before", () => {
    expect(shouldAsk(false, 2)).toBe(false);
    expect(shouldAsk(false, 3)).toBe(true);
    expect(shouldAsk(false, 40)).toBe(true);
    expect(shouldAsk(true, 40)).toBe(false);
  });
});
