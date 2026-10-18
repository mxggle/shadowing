import { useLayoutEffect, useRef, useState } from "react";
import { clamp } from "../audio/logic";
import { sentenceIndexAt } from "../lib/sentences";
import { formatTime } from "../lib/time";
import { t } from "../lib/i18n";
import { useApp } from "../store";

/**
 * Progress track with the A–B region drawn on it. Under the
 * pointer it shows the time and, with a transcript, the sentence you'd land
 * in. Seeks on release.
 */
export function Scrubber() {
  const time = useApp((s) => s.time);
  const duration = useApp((s) => s.duration);
  const loop = useApp((s) => s.loop);
  const seek = useApp((s) => s.seek);
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const ready = duration > 0;
  const toTime = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
  };
  const pct = (t: number) => (ready ? clamp((t / duration) * 100, 0, 100) : 0);
  const shown = drag ?? time;
  const tip = drag ?? hover;

  return (
    <div
      ref={bar}
      role="slider"
      aria-label={t("播放进度", "Playback progress")}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={formatTime(shown)}
      data-active={drag !== null || undefined}
      className={`group relative h-5 touch-none ${ready ? "" : "pointer-events-none"}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(toTime(e.clientX));
      }}
      onPointerMove={(e) => (drag !== null ? setDrag(toTime(e.clientX)) : setHover(toTime(e.clientX)))}
      onPointerLeave={() => setHover(null)}
      onPointerUp={(e) => {
        if (drag === null) return;
        seek(toTime(e.clientX));
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-track transition-[height] duration-150 ease-snappy group-hover:h-1.5 group-data-[active]:h-1.5">
        <div className="h-full rounded-full bg-played" style={{ width: `${pct(shown)}%` }} />
      </div>

      {loop.a !== null && loop.b !== null && (
        <div
          className="pointer-events-none absolute top-1/2 h-[15px] -translate-y-1/2 animate-fade rounded-[3px] border-x-2 border-loop bg-loop-soft"
          style={{ left: `${pct(loop.a)}%`, width: `${pct(loop.b) - pct(loop.a)}%` }}
        />
      )}
      {loop.a !== null && loop.b === null && (
        <div
          className="pointer-events-none absolute top-1/2 h-[15px] w-0.5 -translate-1/2 animate-fade rounded-full bg-loop"
          style={{ left: `${pct(loop.a)}%` }}
        />
      )}

      {/* The handle appears while you're on the track. */}
      <div
        className="pointer-events-none absolute top-1/2 size-3 -translate-1/2 scale-50 rounded-full bg-ink opacity-0 transition-[scale,opacity] duration-150 ease-snappy group-hover:scale-100 group-hover:opacity-100 group-data-[active]:scale-100 group-data-[active]:opacity-100"
        style={{ left: `${pct(shown)}%` }}
      />

      {tip !== null && <Tip time={tip} left={pct(tip)} />}
    </div>
  );
}

/** Time under the pointer, plus the sentence there when there's a transcript. Kept inside the track's ends. */
function Tip({ time, left }: { time: number; left: number }) {
  const text = useApp((s) => {
    const sentences = s.transcript?.sentences;
    if (!sentences?.length) return null;
    const i = sentenceIndexAt(sentences, time);
    return i >= 0 && time <= sentences[i].end + 1.5 ? sentences[i].text : null;
  });
  const ref = useRef<HTMLDivElement>(null);
  const [half, setHalf] = useState(24);
  useLayoutEffect(() => setHalf((ref.current?.offsetWidth ?? 48) / 2), [text]);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute bottom-full mb-2 flex max-w-[280px] -translate-x-1/2 animate-fade items-baseline gap-2 rounded-[8px] bg-ink px-2 py-1 text-on-ink shadow-lift"
      style={{ left: `clamp(${half}px, ${left}%, calc(100% - ${half}px))` }}
    >
      <span className="tabular shrink-0 font-mono text-[11px]">{formatTime(time)}</span>
      {text && <span className="truncate font-script text-[12px] opacity-80">{text}</span>}
    </div>
  );
}
