import { describe, expect, it } from "vitest";
import type { PracticeSession } from "./api";
import { byDay, dayKey, goalOn, longestStreak, durationParts, formatDuration, level, metGoal, streak, summarize, topAudios, withGoal } from "./practice";

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const MIN = 60_000;
const session = (start: number, minutes: number, playedMinutes = minutes, audio = "/a.mp3"): PracticeSession => ({
  audio,
  start,
  end: start + minutes * MIN,
  played: playedMinutes * MIN,
});

describe("practice days", () => {
  it("count until 4:00 towards the day before", () => {
    expect(dayKey(at(2026, 10, 11, 3, 59))).toBe("2026-10-10");
    expect(dayKey(at(2026, 10, 11, 4))).toBe("2026-10-11");
    expect(dayKey(at(2026, 10, 11, 23, 59))).toBe("2026-10-11");
  });

  it("split a session across 4:00 and share its playback in proportion", () => {
    const days = byDay([session(at(2026, 10, 11, 3, 30), 60, 30)]);
    expect(days.get("2026-10-10")).toEqual({ active: 30 * MIN, played: 15 * MIN });
    expect(days.get("2026-10-11")).toEqual({ active: 30 * MIN, played: 15 * MIN });
  });

  it("add up today, the last 7 days and everything", () => {
    const now = at(2026, 10, 11, 20);
    const s = summarize(
      [session(at(2026, 9, 1, 9), 50), session(at(2026, 10, 5, 9), 20, 10), session(at(2026, 10, 11, 9), 15, 12)],
      [],
      now,
    );
    expect(s.today).toEqual({ active: 15 * MIN, played: 12 * MIN });
    expect(s.week).toEqual({ active: 35 * MIN, played: 22 * MIN });
    expect(s.total.active).toBe(85 * MIN);
  });
});

describe("daily goal", () => {
  it("applies from the day it was set; earlier days keep theirs", () => {
    const goals = withGoal(withGoal([], "2026-10-05", 30), "2026-10-11", 10);
    expect([goalOn(goals, "2026-10-01"), goalOn(goals, "2026-10-05"), goalOn(goals, "2026-10-10"), goalOn(goals, "2026-10-11")]).toEqual([15, 30, 30, 10]);
    // Changed again the same day: one entry, the last choice.
    expect(withGoal(goals, "2026-10-11", 20)).toEqual([{ since: "2026-10-05", minutes: 30 }, { since: "2026-10-11", minutes: 20 }]);
  });

  it("is met at its minutes; with no goal, a minute is enough", () => {
    expect([metGoal(14.9 * MIN, 15), metGoal(15 * MIN, 15), metGoal(30_000, 0), metGoal(MIN, 0)]).toEqual([false, true, false, true]);
  });
});

describe("streak", () => {
  // 10-minute goal throughout.
  const goals = withGoal([], "2026-01-01", 10);
  const days = byDay([
    session(at(2026, 10, 8, 9), 10),
    session(at(2026, 10, 9, 9), 10),
    session(at(2026, 10, 10, 23, 30), 10), // late evening, still the 10th
  ]);

  it("ends yesterday while today isn't done yet", () => {
    expect(streak(days, goals, at(2026, 10, 11, 8))).toBe(3);
  });

  it("is broken by a missed day", () => {
    expect(streak(days, goals, at(2026, 10, 12, 8))).toBe(0);
  });

  it("only counts days that met their goal", () => {
    const short = byDay([session(at(2026, 10, 9, 9), 10), session(at(2026, 10, 10, 9), 8), session(at(2026, 10, 11, 9), 10)]);
    expect(streak(short, goals, at(2026, 10, 11, 20))).toBe(1);
    // A higher goal from today on doesn't undo the days before it.
    expect(streak(days, withGoal(goals, "2026-10-11", 60), at(2026, 10, 11, 8))).toBe(3);
  });

  it("remembers the longest run, across months", () => {
    const run = (d: number) => session(at(2026, 9, d, 9), 10);
    expect(longestStreak(byDay([run(1), run(29), run(30), session(at(2026, 10, 1, 9), 10), session(at(2026, 10, 9, 9), 10)]), goals)).toBe(3);
    expect(longestStreak(days, goals)).toBe(3);
  });
});

it("ranks audio by practice time since a date", () => {
  const since = at(2026, 10, 1, 4);
  const top = topAudios(
    [session(at(2026, 9, 1, 9), 99, 99, "/old.mp3"), session(at(2026, 10, 2, 9), 10, 10, "/b.mp3"), session(at(2026, 10, 3, 9), 20, 20, "/c.mp3"), session(at(2026, 10, 4, 9), 15, 15, "/b.mp3")],
    since,
  );
  expect(top).toEqual([
    { audio: "/b.mp3", active: 25 * MIN },
    { audio: "/c.mp3", active: 20 * MIN },
  ]);
});

it("formats durations", () => {
  expect(formatDuration(0)).toBe("0 分钟");
  expect(formatDuration(40_000)).toBe("不到 1 分钟");
  expect(formatDuration(25 * MIN)).toBe("25 分钟");
  expect(formatDuration(130 * MIN)).toBe("2 小时 10 分");
  expect(formatDuration(120 * MIN)).toBe("2 小时");
  expect(durationParts(130 * MIN)).toEqual([["2", "小时"], ["10", "分"]]);
  expect([0, 5, 15, 30, 60].map((m) => level(m * MIN))).toEqual([0, 1, 2, 3, 4]);
});
