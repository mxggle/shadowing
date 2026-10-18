// 学习记录: how long you practised, today and over time. The numbers come from
// sessions Rust records while you play (src-tauri/src/practice); this sheet only
// sums them per day (src/lib/practice.ts).
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type PracticeSession } from "../lib/api";
import { count, t } from "../lib/i18n";
import { durationParts, formatDuration, shiftDay, summarize, topAudios } from "../lib/practice";
import { useApp } from "../store";
import { IconButton } from "./ui";
import { DailyBars, Heatmap } from "./PracticeCharts";
import { GoalRow } from "./PracticeGoal";

/** While the sheet is open, the running session keeps growing; refresh this often. */
const REFRESH_MS = 15_000;

export function PracticeDialog() {
  const open = useApp((s) => s.statsOpen);
  const setOpen = useApp((s) => s.setStatsOpen);
  const [sessions, setSessions] = useState<PracticeSession[] | null>(null);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!open) return;
    const load = () => {
      void useApp.getState().refreshToday();
      void api.practice.log().then((s) => {
        setSessions(s);
        setNow(Date.now());
      });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    // Capture phase: Esc closes the sheet instead of also clearing the loop.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-30 flex animate-fade justify-center bg-black/25 px-6 pt-[7vh] pb-6 dark:bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="practice-title"
        className="flex max-h-full w-full max-w-[640px] animate-pop-in flex-col self-start overflow-hidden rounded-[16px] bg-raised shadow-lift"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-2.5 pl-6">
          <h2 id="practice-title" className="text-[14px] font-semibold">
            {t("学习记录", "Practice log")}
          </h2>
          <IconButton title={t("关闭 (Esc)", "Close (Esc)")} onClick={() => setOpen(false)}>
            <X />
          </IconButton>
        </header>
        <div className="scrollbar-none overflow-y-auto px-6 pt-5 pb-6">{sessions && <Records sessions={sessions} now={now} />}</div>
      </div>
    </div>
  );
}

function Records({ sessions, now }: { sessions: PracticeSession[]; now: number }) {
  const goals = useApp((s) => s.settings.dailyGoals);
  const summary = useMemo(() => summarize(sessions, goals, now), [sessions, goals, now]);
  const { today, week, total, days } = summary;
  const practisedDays = [...days.values()].filter((d) => d.active >= 60_000).length;

  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Figure label={t("今天", "Today")} ms={today.active} note={today.active ? t(`播放 ${formatDuration(today.played)}`, `Played ${formatDuration(today.played)}`) : t("还没开始", "Not started yet")} />
        <Figure label={t("最近 7 天", "Last 7 days")} ms={week.active} note={t(`日均 ${formatDuration(week.active / 7)}`, `Avg ${formatDuration(week.active / 7)} a day`)} />
        <Figure label={t("累计", "All time")} ms={total.active} note={count(practisedDays, "天", "day")} />
        <div>
          <div className="text-[12px] text-faint">{t(summary.goal ? "连续达标" : "连续", "Streak")}</div>
          <Big parts={[[String(summary.streak), t("天", summary.streak === 1 ? "day" : "days")]]} />
          <div className="text-[12px] text-muted">
            {t("最长", "Longest")} {count(summary.longestStreak, "天", "day")}
          </div>
        </div>
      </div>

      <GoalRow weekMet={summary.weekMet} />

      {sessions.length === 0 ? (
        <p className="mt-6 rounded-[10px] bg-fill px-4 py-3 text-[13px] leading-relaxed text-muted">
          {t(
            "还没有记录。播放一段音频，这里就会记下你每天练了多久。",
            "No records yet. Play some audio and this will log how long you practice each day.",
          )}
        </p>
      ) : (
        <>
          <Section title={t("最近 14 天", "Last 14 days")} legend>
            <DailyBars days={days} goals={goals} now={now} />
          </Section>
          <Section title={t("近半年", "Past 6 months")}>
            <Heatmap days={days} goals={goals} now={now} />
          </Section>
          <TopAudios sessions={sessions} now={now} />
        </>
      )}

      <p className="mt-6 border-t border-line pt-4 text-[12px] leading-relaxed text-muted">
        {t(
          "怎么算：音频播放、回听自己录音的时间都算；跟读录音、整段录音时录音的时间也算（算在“暂停”里）；暂停后 90 秒内又有操作（继续播放、点句子、看解释），中间跟读、思考的时间也算； 更久没有动静就当作离开，那段时间不算。每天从凌晨 4 点算起；连续天数只算达到当天目标的日子，改目标只影响今天和以后。记录只存在这台 Mac 上。",
          "How it’s counted: time playing audio and listening back to your own recordings counts. So does time spent recording takes or whole sections, which counts as Paused. If you act within 90 seconds of a pause (resume, click a sentence, read an explanation), the time in between counts too, including time spent shadowing or thinking. Longer idle time counts as away and isn’t included. Each day starts at 4 a.m.; streaks only count days that met their goal, and changing the goal affects only today and later. Records are kept on this Mac only.",
        )}
      </p>
    </>
  );
}

function Figure({ label, ms, note }: { label: string; ms: number; note: string }) {
  return (
    <div>
      <div className="text-[12px] text-faint">{label}</div>
      <Big parts={durationParts(ms)} />
      <div className="text-[12px] text-muted">{note}</div>
    </div>
  );
}

function Big({ parts }: { parts: [string, string][] }) {
  return (
    <div className="mt-0.5 mb-0.5 flex items-baseline gap-1 whitespace-nowrap">
      {parts.map(([n, unit]) => (
        <span key={unit} className="flex items-baseline gap-0.5">
          <span className="tabular font-mono text-[24px] leading-[32px] font-medium tracking-[-0.02em]">{n}</span>
          <span className="text-[12px] text-muted">{unit}</span>
        </span>
      ))}
    </div>
  );
}

function Section({ title, legend, children }: { title: string; legend?: boolean; children: React.ReactNode }) {
  return (
    <section className="mt-6 border-t border-line pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[12px] font-medium text-faint">{title}</h3>
        {legend && (
          <div className="flex items-center gap-3 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-ink/75" />
              {t("播放", "Playing")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-ink/20" />
              {t("暂停（跟读、录音、看解释）", "Paused (shadowing, recording, explanations)")}
            </span>
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function TopAudios({ sessions, now }: { sessions: PracticeSession[]; now: number }) {
  const tracks = useApp((s) => s.folder?.tracks);
  const sample = useApp((s) => s.sample);
  const top = topAudios(sessions, shiftDay(now, -29));
  if (top.length === 0) return null;
  // Audio outside the open folder (an older folder) is named after its file.
  const name = (path: string) =>
    [...(tracks ?? []), ...(sample ? [sample] : [])].find((t) => t.path === path)?.name ?? path.split("/").pop()!.replace(/\.[^.]+$/, "");
  const most = top[0].active;
  return (
    <Section title={t("最近 30 天练得最多", "Most practiced, last 30 days")}>
      <ol className="flex flex-col gap-2.5">
        {top.map(({ audio, active }) => (
          <li key={audio} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1">
            <span className="truncate font-script text-[14px]" title={audio}>
              {name(audio)}
            </span>
            <span className="tabular text-[12px] text-muted">{formatDuration(active)}</span>
            <span className="col-span-2 h-[3px] rounded-full bg-fill">
              <span className="block h-full rounded-full bg-ink/40" style={{ width: `${(active / most) * 100}%` }} />
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
