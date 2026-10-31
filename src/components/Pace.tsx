import { ChevronUp, Hourglass, Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDismiss } from "../hooks/useDismiss";
import { useFlash } from "../hooks/useFlash";
import { useKeys } from "../hooks/useKeys";
import { t } from "../lib/i18n";
import { paceActive, paceLabel } from "../lib/pace";
import { paceSettingsOf } from "../paceSlice";
import { playable, useApp, type AppState } from "../store";
import { PaceMenu } from "./PaceMenu";

/** The pause after a time through, when nothing else (a recording) has the track. */
const gapOf = (s: AppState) => (s.rec || s.live || s.drill ? null : s.paceGap);

/**
 * 跟读停顿 on the deck: the key turns it on and off in one click (G too), keeping how it
 * pauses, and says what it does ("每句停 2 秒"); the arrow beside it opens how. While it waits
 * after a sentence the key counts down.
 */
export function PaceKey() {
  const pace = useApp(useShallow(paceSettingsOf));
  const hasTrack = useApp((s) => !!s.current && playable(s.current));
  const gap = useApp(gapOf);
  const run = useApp((s) => s.pace);
  const looping = useApp((s) => s.loop.b !== null);
  const open = useApp((s) => s.paceMenu);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => useApp.getState().setPaceMenu(false), []);
  useDismiss(open, close, root);
  const flashing = useFlash("pace");
  const keys = useKeys();
  const key = keys("pace");
  const on = pace.paceOn;
  const active = paceActive(pace);

  // Which time through, outside a loop (a loop counts its own times on the strip above).
  const pass = run && !looping ? run.pass : undefined;
  const waiting = gap ? <Waiting gap={gap} goOn={keys("toggle")} /> : null;
  const label = !on ? t("每句停") : (waiting ?? paceLabel(pace, pass));
  // A narrow window: a short word while it's off, and just the pause (or the seconds left) while on.
  const short = !on ? t("停顿") : gap ? gap.until === null ? <Waiting gap={gap} goOn={keys("toggle")} short /> : <Countdown until={gap.until} short /> : paceLabel({ ...pace, sentenceRepeats: 1 });
  const look = on ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "btn text-fg/85 hover:text-fg";

  return (
    <div ref={root} className="relative flex shrink-0">
      <button
        disabled={!hasTrack}
        aria-pressed={on}
        aria-label={t("跟读停顿")}
        title={
          on
            ? gap
              ? t("停顿中：{key} 马上继续，Esc 一直等你", { key: keys("toggle") })
              : t("跟读停顿：开，点一下关掉 ({key})", { key })
            : t("跟读停顿：每句放完停几秒，留时间给你说（也叫复读间隔、自动暂停）({key})", { key })
        }
        onClick={() => useApp.getState().togglePace()}
        data-flash={flashing || undefined}
        className={`relative flex h-8 min-w-0 items-center gap-1.5 overflow-hidden rounded-l-[8px] pr-2 pl-2.5 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,scale] duration-150 ease-snappy active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 data-[flash]:scale-[0.96] ${look}`}
      >
        {gap && gap.until !== null && (
          <span
            key={gap.until}
            aria-hidden
            className="absolute inset-0 origin-left bg-press"
            style={{ animation: `drain ${Math.max(0, gap.until - performance.now())}ms linear forwards` }}
          />
        )}
        <Hourglass size={14} strokeWidth={1.9} aria-hidden className={`relative shrink-0 ${on && active ? "" : "opacity-60"}`} />
        <span className="relative hidden @[640px]:inline">{label}</span>
        <span className="relative @[640px]:hidden">{short}</span>
      </button>
      <button
        disabled={!hasTrack}
        title={t("跟读停顿的设置")}
        aria-label={t("跟读停顿的设置")}
        aria-expanded={open}
        onClick={() => useApp.getState().setPaceMenu(!open)}
        className={`grid h-8 w-6 shrink-0 place-items-center rounded-r-[8px] border-l border-line transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${
          open ? "bg-press text-fg" : on ? "bg-raised text-muted shadow-[inset_0_0_0_1px_var(--line-strong)] hover:text-fg" : "btn text-muted hover:text-fg"
        }`}
      >
        <ChevronUp size={12} strokeWidth={2} aria-hidden className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <PaceMenu />}
    </div>
  );
}

/** Waiting for you after a sentence: counting down, or until you go on (a key, or your voice). */
function Waiting({ gap, goOn, short }: { gap: NonNullable<AppState["paceGap"]>; goOn: string; short?: boolean }) {
  if (gap.until !== null) return <Countdown until={gap.until} />;
  if (gap.listening)
    return (
      <span className="flex items-center gap-1">
        {short ? t("在听") : t("该你说 · 在听")}
        <Mic size={12} strokeWidth={2.2} aria-hidden className="text-danger" />
      </span>
    );
  return <>{short ? t("该你说") : t("该你说 · {key}", { key: goOn })}</>;
}

/** Seconds left in the pause, counting down. */
function Countdown({ until, short }: { until: number; short?: boolean }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, []);
  const left = Math.max(0, (until - now) / 1000);
  if (short) return <span className="tabular font-mono text-[12px]">{left.toFixed(1)}</span>;
  return (
    <>
      {t("该你说")} <span className="tabular font-mono text-[12px]">{left.toFixed(1)}</span>
    </>
  );
}
