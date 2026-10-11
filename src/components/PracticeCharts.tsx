// The two charts on the 学习记录 sheet: the last 14 days as bars (playing vs.
// pauses kept apart), and half a year as a calendar heatmap. One hue (ink),
// darker = more; hover any day for its numbers.
import { useRef, useState, type ReactNode } from "react";
import type { GoalChange } from "../lib/api";
import { dayKey, formatDuration, goalOn, level, metGoal, shiftDay, type DayTotal } from "../lib/practice";

const MIN = 60_000;
const WEEKDAYS = "日一二三四五六";

const dateLabel = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`;
};

function dayTip(ms: number, day: DayTotal | undefined, goals: GoalChange[]): ReactNode {
  const goal = goalOn(goals, dayKey(ms));
  return (
    <>
      <div className="text-faint">{dateLabel(ms)}</div>
      <div className="mt-0.5 font-medium text-fg">{day ? formatDuration(day.active) : "没有练习"}</div>
      {day && day.active >= MIN && <div className="text-muted">其中播放 {formatDuration(day.played)}</div>}
      {goal > 0 && day && metGoal(day.active, goal) && <div className="text-muted">达到当天目标（{goal} 分钟）</div>}
    </>
  );
}

/** A box for a chart with one tooltip that follows whichever mark is hovered. */
function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const show = (el: HTMLElement, content: ReactNode) => {
    const outer = box.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (outer) setTip({ x: r.left + r.width / 2 - outer.left, y: r.top - outer.top, content });
  };
  const view = tip && (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[8px] bg-raised px-2.5 py-1.5 text-[12px] leading-[18px] whitespace-nowrap shadow-lift"
      style={{ left: Math.max(60, Math.min(tip.x, (box.current?.clientWidth ?? 0) - 60)), top: tip.y - 6 }}
    >
      {tip.content}
    </div>
  );
  return { box, show, hide: () => setTip(null), view };
}

/** Rounds the busiest day up to a scale line worth reading: 10, 20, 30, 45, 60 minutes, then whole hours. */
function scaleTop(maxMinutes: number): number {
  for (const m of [10, 20, 30, 45, 60, 90, 120]) if (maxMinutes <= m) return m;
  return Math.ceil(maxMinutes / 60) * 60;
}

type ChartProps = { days: Map<string, DayTotal>; goals: GoalChange[]; now: number };

export function DailyBars({ days, goals, now }: ChartProps) {
  const { box, show, hide, view } = useTip();
  const list = Array.from({ length: 14 }, (_, i) => {
    const ms = shiftDay(now, i - 13);
    return { ms, day: days.get(dayKey(ms)) };
  });
  // Today's goal as a line across: past days were mostly on the same one, and the tooltip says which they met.
  const goal = goalOn(goals, dayKey(now));
  // Headroom over the goal keeps its line (and label) clear of the top line.
  const top = scaleTop(Math.max(goal * 1.25, ...list.map((d) => (d.day?.active ?? 0) / MIN)));
  const pct = (ms: number) => `${Math.min(100, (ms / MIN / top) * 100)}%`;

  return (
    <div ref={box} className="relative">
      <div className="flex gap-3">
        <div className="relative h-[120px] flex-1">
          {/* Scale lines: recessive, labelled on the right. */}
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-line" />
          {goal > 0 && <div className="absolute inset-x-0 z-[1] border-t border-dashed border-fg/45" style={{ bottom: `${(goal / top) * 100}%` }} />}
          <div className="absolute inset-x-0 bottom-0 border-t border-line-strong" />
          <div className="absolute inset-0 flex items-end">
            {list.map(({ ms, day }) => (
              <div
                key={ms}
                className="group flex h-full flex-1 cursor-default flex-col items-center justify-end px-[3px]"
                onPointerEnter={(e) => show(e.currentTarget, dayTip(ms, day, goals))}
                onPointerLeave={hide}
              >
                {day && (
                  // Pauses on top, playing at the base; a 2px gap of surface between them.
                  <div className="flex w-full max-w-[22px] flex-col gap-[2px] transition-opacity group-hover:opacity-80" style={{ height: pct(day.active) }}>
                    {day.played < day.active * 0.97 && <div className="min-h-0 flex-1 rounded-t-[4px] bg-ink/20" />}
                    <div className="min-h-[2px] rounded-t-[1px] bg-ink/75 first:rounded-t-[4px]" style={{ height: `${(day.played / day.active) * 100}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="relative w-9 text-[11px] text-faint">
          <span className="tabular absolute -translate-y-1/2 font-mono" style={{ top: 0 }}>{formatScale(top)}</span>
          {goal > 0 && (
            <span className="absolute translate-y-1/2 text-muted" style={{ bottom: `${(goal / top) * 100}%` }}>
              目标
            </span>
          )}
        </div>
      </div>
      <div className="mr-12 flex pt-1.5">
        {list.map(({ ms }, i) => (
          <span key={ms} className={`tabular flex-1 text-center font-mono text-[11px] ${i === 13 ? "text-fg" : "text-faint"}`}>
            {i === 13 ? "今" : new Date(ms).getDate()}
          </span>
        ))}
      </div>
      {view}
    </div>
  );
}

const formatScale = (minutes: number) => (minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}时` : `${minutes}分`);

const SHADES = ["bg-fill", "bg-ink/20", "bg-ink/40", "bg-ink/62", "bg-ink/85"];
const WEEKS = 26;

export function Heatmap({ days, goals, now }: ChartProps) {
  const { box, show, hide, view } = useTip();
  const today = shiftDay(now, 0);
  const sinceMonday = (new Date(today).getDay() + 6) % 7;
  const first = shiftDay(now, -sinceMonday - (WEEKS - 1) * 7);
  const weeks = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => shiftDay(first, w * 7 + d)));

  return (
    <div ref={box} className="relative">
      {/* Column by column: weekday names, then one column per week sharing the width. */}
      <div className="grid grid-flow-col grid-cols-[auto_repeat(26,minmax(0,1fr))] grid-rows-[auto_repeat(7,auto)] gap-[3px]">
        <span />
        {[..."一二三四五六日"].map((d, i) => (
          <span key={d} className={`mr-1 self-center text-[11px] leading-none text-faint ${i % 2 ? "invisible" : ""}`}>
            {d}
          </span>
        ))}
        {weeks.flatMap((week, w) => {
          const month = new Date(week[0]).getMonth();
          const newMonth = w === 0 || month !== new Date(weeks[w - 1][0]).getMonth();
          return [
            <span key={`m${week[0]}`} className="h-[15px] overflow-visible text-[11px] leading-[12px] whitespace-nowrap text-faint">
              {newMonth ? `${month + 1}月` : ""}
            </span>,
            ...week.map((ms) => {
              const day = days.get(dayKey(ms));
              const future = ms > today;
              return (
                <span
                  key={ms}
                  className={`aspect-square rounded-[3px] ${future ? "invisible" : SHADES[level(day?.active ?? 0)]} ${
                    ms === today ? "shadow-[0_0_0_1.5px_var(--raised),0_0_0_2.5px_var(--line-strong)]" : ""
                  }`}
                  onPointerEnter={(e) => !future && show(e.currentTarget, dayTip(ms, day, goals))}
                  onPointerLeave={hide}
                />
              );
            }),
          ];
        })}
      </div>
      <div className="mt-2 flex items-center justify-end gap-[3px] text-[11px] text-faint">
        <span className="mr-1">少</span>
        {SHADES.map((s) => (
          <span key={s} className={`size-3 rounded-[3px] ${s}`} />
        ))}
        <span className="ml-1">多</span>
      </div>
      {view}
    </div>
  );
}
