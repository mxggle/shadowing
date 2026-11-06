import { describe, expect, it } from "vitest";
import { practisedDays, shouldAsk, todayCounts } from "./ask";
import { byDay } from "./practice";

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const MIN = 60_000;
const session = (start: number, minutes: number) => ({ audio: "/a.mp3", start, end: start + minutes * MIN, played: minutes * MIN });

describe("the one-time question", () => {
  it("counts days with at least a minute, today included", () => {
    const days = byDay([
      session(at(2026, 11, 1, 9), 10),
      session(at(2026, 11, 2, 9), 0.5), // under a minute
      session(at(2026, 11, 4, 9), 1),
      session(at(2026, 11, 6, 9), 30), // today
    ]);
    expect(practisedDays(days)).toBe(3);
  });

  it("counts a late session (before 4:00) for the day before", () => {
    const days = byDay([session(at(2026, 11, 5, 21), 10), session(at(2026, 11, 6, 2), 10)]);
    expect(practisedDays(days)).toBe(1);
  });

  it("notices when today gets its minute", () => {
    expect(todayCounts(null)).toBe(false);
    expect(todayCounts(59_000)).toBe(false);
    expect(todayCounts(MIN)).toBe(true);
  });

  it("asks from the third day, and only if it hasn't before", () => {
    expect(shouldAsk(false, 2)).toBe(false);
    expect(shouldAsk(false, 3)).toBe(true);
    expect(shouldAsk(false, 40)).toBe(true);
    expect(shouldAsk(true, 40)).toBe(false);
  });
});
