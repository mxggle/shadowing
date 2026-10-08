import { useRef, useState } from "react";
import { clamp } from "../audio/logic";
import { formatTime } from "../lib/time";
import { useApp } from "../store";

/** Progress bar with the A–B region drawn on it. Shows the time under the pointer; seeks on release. */
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
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={formatTime(shown)}
      data-active={drag !== null || undefined}
      className={`group relative h-6 touch-none ${ready ? "" : "pointer-events-none"}`}
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
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct(shown)}%` }} />
      </div>

      {loop.a !== null && loop.b !== null && (
        <div
          className="pointer-events-none absolute top-1/2 h-3.5 -translate-y-1/2 animate-fade rounded-[3px] border-x-2 border-accent bg-accent/20"
          style={{ left: `${pct(loop.a)}%`, width: `${pct(loop.b) - pct(loop.a)}%` }}
        />
      )}
      {loop.a !== null && loop.b === null && (
        <div
          className="pointer-events-none absolute top-1/2 h-3.5 w-0.5 -translate-1/2 animate-fade rounded-full bg-accent"
          style={{ left: `${pct(loop.a)}%` }}
        />
      )}

      <div
        className="pointer-events-none absolute top-1/2 size-3.5 -translate-1/2 scale-0 rounded-full border-2 border-accent bg-white shadow-sm transition-transform duration-150 ease-snappy group-hover:scale-100 group-data-[active]:scale-100"
        style={{ left: `${pct(shown)}%` }}
      />

      {tip !== null && (
        <div
          className="tabular pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 animate-fade rounded-md bg-fg px-1.5 py-0.5 text-[11px] font-medium text-canvas"
          style={{ left: `clamp(20px, ${pct(tip)}%, calc(100% - 20px))` }}
        >
          {formatTime(tip)}
        </div>
      )}
    </div>
  );
}
