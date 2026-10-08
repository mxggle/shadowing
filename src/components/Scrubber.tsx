import { useRef, useState } from "react";
import { clamp } from "../audio/logic";
import { useApp } from "../store";

/** Progress bar with the A–B region drawn on it. Seeks on release. */
export function Scrubber() {
  const time = useApp((s) => s.time);
  const duration = useApp((s) => s.duration);
  const loop = useApp((s) => s.loop);
  const seek = useApp((s) => s.seek);
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const toTime = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
  };
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const shown = drag ?? time;

  return (
    <div
      ref={bar}
      className="group relative h-4 cursor-pointer touch-none"
      onPointerDown={(e) => {
        if (duration <= 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(toTime(e.clientX));
      }}
      onPointerMove={(e) => drag !== null && setDrag(toTime(e.clientX))}
      onPointerUp={(e) => {
        if (drag === null) return;
        seek(toTime(e.clientX));
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct(shown)}%` }} />
      </div>
      {loop.a !== null && (
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm border-x-2 border-accent bg-accent/20"
          style={{
            left: `${pct(loop.a)}%`,
            width: loop.b !== null ? `${pct(loop.b) - pct(loop.a)}%` : 0,
          }}
        />
      )}
      <div
        className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-0 shadow group-hover:opacity-100"
        style={{ left: `${pct(shown)}%`, opacity: drag !== null ? 1 : undefined }}
      />
    </div>
  );
}
