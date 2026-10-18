// Practice-time part of the single store: the 学习记录 sheet, the daily goal and
// today's progress towards it (polled from Rust, which does the counting).
import { api, type Settings } from "./lib/api";
import { t } from "./lib/i18n";
import { byDay, dayKey, dayStart, goalOn, metGoal, withGoal } from "./lib/practice";
import type { AppState } from "./store";

/** How often today's total is refreshed for the goal ring. */
const REFRESH_MS = 10_000;

export interface PracticeState {
  /** The 学习记录 sheet. */
  statsOpen: boolean;
  /** Ms practised today; null until first loaded. */
  todayMs: number | null;
  /** Ms ever practised on the open audio. */
  trackMs: number;
  setStatsOpen(open: boolean): void;
  /** Reloads today's total and the open audio's (also right after opening one). */
  refreshToday(): Promise<void>;
  /** Minutes a day from today on (0 = no goal); earlier days keep theirs. */
  setDailyGoal(minutes: number): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export function createPracticeSlice(set: Set, get: Get, persistSettings: (patch: Partial<Settings>) => void): PracticeState {
  // Whether today's goal was already met when last looked at: the toast is only for
  // the moment it's reached while practising, not for opening the app afterwards.
  let seen = { day: "", met: true };
  const metNow = (todayMs: number) => {
    const goal = goalOn(get().settings.dailyGoals, dayKey(Date.now()));
    return { goal, met: goal > 0 && metGoal(todayMs, goal) };
  };

  window.setInterval(() => {
    if (get().ready && document.visibilityState === "visible") void get().refreshToday();
  }, REFRESH_MS);

  return {
    statsOpen: false,
    todayMs: null,
    trackMs: 0,

    setStatsOpen(statsOpen) {
      set(statsOpen ? { statsOpen, settingsOpen: false, wizardOpen: false, newsOpen: false } : { statsOpen });
    },

    async refreshToday() {
      const now = Date.now();
      const day = dayKey(now);
      const audio = get().current?.path;
      const [today, track] = await Promise.all([api.practice.log({ since: dayStart(now) }), audio ? api.practice.log({ audio }) : []]);
      const todayMs = byDay(today).get(day)?.active ?? 0;
      // Opened another audio while this was loading: its total comes with the next refresh.
      if (get().current?.path === audio) set({ trackMs: track.reduce((sum, s) => sum + s.end - s.start, 0) });
      const { goal, met } = metNow(todayMs);
      if (met && seen.day === day && !seen.met) get().say(t(`今天的 ${goal} 分钟目标完成了。`, `Today’s ${goal} min goal is met.`));
      seen = { day, met };
      set({ todayMs });
    },

    setDailyGoal(minutes) {
      const dailyGoals = withGoal(get().settings.dailyGoals, dayKey(Date.now()), minutes);
      persistSettings({ dailyGoals });
      // A goal lowered below what's done today is met quietly, without the toast.
      seen = { day: dayKey(Date.now()), met: metNow(get().todayMs ?? 0).met };
    },
  };
}
