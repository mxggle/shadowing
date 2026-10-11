// The daily goal: a ring in the top bar that fills as you practise and becomes a
// check once today's goal is met, and the goal row on the 学习记录 sheet.
import { ChartColumn, Check } from "lucide-react";
import { dayKey, formatDuration, GOAL_CHOICES, goalOn, metGoal } from "../lib/practice";
import { useApp } from "../store";
import { fieldClass, IconButton } from "./ui";

/** Today's goal and progress, live (refreshed every few seconds by the store). */
function useTodayGoal() {
  const todayMs = useApp((s) => s.todayMs);
  const goals = useApp((s) => s.settings.dailyGoals);
  const goal = goalOn(goals, dayKey(Date.now()));
  return { todayMs: todayMs ?? 0, loaded: todayMs !== null, goal, met: goal > 0 && metGoal(todayMs ?? 0, goal) };
}

/** Filling ring, or a green check once met. */
function GoalMark({ ratio, met, size }: { ratio: number; met: boolean; size: number }) {
  if (met) {
    return (
      <span className="grid shrink-0 animate-pop place-items-center rounded-full bg-ok text-white" style={{ width: size, height: size }}>
        <Check size={size * 0.7} strokeWidth={3} />
      </span>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0 -rotate-90" aria-hidden>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="1.75" />
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${Math.min(1, ratio) * 100} 100`}
        className={ratio > 0 ? "transition-[stroke-dasharray] duration-200" : "invisible"}
      />
    </svg>
  );
}

/** Opens 学习记录; shows today's progress towards the goal. */
export function PracticeButton() {
  const open = useApp((s) => s.statsOpen);
  const setOpen = useApp((s) => s.setStatsOpen);
  const { todayMs, loaded, goal, met } = useTodayGoal();
  const title = !goal
    ? "学习记录"
    : met
      ? `学习记录 · 今天的目标完成了（练了 ${formatDuration(todayMs)}）`
      : `学习记录 · 今天 ${Math.floor(todayMs / 60_000)} / ${goal} 分钟`;
  return (
    <IconButton title={title} aria-label={title} active={open} onClick={() => setOpen(true)}>
      {goal > 0 && loaded ? <GoalMark ratio={todayMs / (goal * 60_000)} met={met} size={16} /> : <ChartColumn />}
    </IconButton>
  );
}

/** Today against the goal, with the goal picker. `weekMet`: days of the last 7 that met theirs. */
export function GoalRow({ weekMet }: { weekMet: number }) {
  const { todayMs, goal, met } = useTodayGoal();
  const setGoal = useApp((s) => s.setDailyGoal);
  const left = goal * 60_000 - todayMs;
  const choices = GOAL_CHOICES.includes(goal) ? GOAL_CHOICES : [...GOAL_CHOICES, goal].sort((a, b) => a - b);

  return (
    <section className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] bg-fill py-2.5 pr-2.5 pl-3.5">
      {goal > 0 && <GoalMark ratio={todayMs / (goal * 60_000)} met={met} size={22} />}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">
          {!goal ? "没有设每日目标" : met ? `今天的 ${goal} 分钟完成了` : `今天还差 ${formatDuration(left).replace("不到 1 分钟", "1 分钟")}`}
        </div>
        <div className="text-[12px] text-muted">
          {goal ? `最近 7 天有 ${weekMet} 天达到目标` : "连续天数按每天至少练 1 分钟算"}
        </div>
      </div>
      <label className="flex items-center gap-2 text-[12px] whitespace-nowrap text-muted">
        每日目标
        <select className={`${fieldClass} w-auto`} value={goal} onChange={(e) => setGoal(Number(e.target.value))}>
          {choices.map((m) => (
            <option key={m} value={m}>
              {m ? `${m} 分钟` : "不设"}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
