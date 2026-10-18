import { Play, Square } from "lucide-react";
import type { Take, TakePart } from "../lib/api";
import { t } from "../lib/i18n";
import { formatSecs, lanes, mineSecs } from "../lib/takes";

/** Peaks are stored 50 a second. */
const PER_SEC = 50;
/** Long takes are drawn with fewer, wider bars. */
const MAX_BARS = 160;

/**
 * The original above, you below, drawn to the same scale: 听完再说 lines both up
 * at their first sound, 边听边说 keeps the real timeline (the lag shows). A
 * playhead runs along whichever is playing (`head`, in the take's seconds); a
 * click plays that voice, and so does the ▶ by its name (`playing`: the one
 * that is). `compact`: thinner lanes and plain names, for the sentence playing.
 */
export function TakeWaves({ take, head, onPlay, compact, titles, playing }: {
  take: Take;
  head: { original: number | null; mine: number | null };
  onPlay: (lane: "original" | "mine") => void;
  compact?: boolean;
  /** What a click on each lane does, when it isn't just that voice. */
  titles?: string;
  playing?: TakePart | null;
}) {
  const l = lanes(take);
  const height = compact ? "h-5" : "h-9";
  return (
    <div className={`grid ${compact ? "grid-cols-[2.25rem_1fr_3.25rem] gap-y-0.5" : "grid-cols-[3.25rem_1fr_3.25rem] gap-y-1"} items-center gap-x-2`}>
      <Lane
        label={t("原句")}
        named={!compact}
        on={playing === "original"}
        peaks={take.peaks.original}
        from={l.original}
        width={l.width}
        secs={take.original[1] - take.original[0]}
        head={head.original}
        tone="text-fg/35"
        height={height}
        title={titles}
        onClick={() => onPlay("original")}
      />
      <Lane
        label={t("我的")}
        named={!compact}
        on={playing === "mine"}
        peaks={take.peaks.mine}
        from={l.mine}
        width={l.width}
        secs={mineSecs(take)}
        head={head.mine}
        tone="text-fg/80"
        height={height}
        title={titles}
        onClick={() => onPlay("mine")}
      />
    </div>
  );
}

function Lane({ label, named, on, peaks, from, width, secs, head, tone, height, title, onClick }: {
  label: string;
  /** The name is a ▶ button (`on`: that voice is playing). */
  named: boolean;
  on: boolean;
  peaks: number[];
  from: number;
  width: number;
  /** Length shown at the end. */
  secs: number;
  head: number | null;
  tone: string;
  height: string;
  title?: string;
  onClick: () => void;
}) {
  const samples = Math.max(1, Math.round(width * PER_SEC));
  const group = Math.ceil(samples / MAX_BARS);
  const bars = Math.ceil(samples / group);
  const first = Math.round(from * PER_SEC);
  const heights = Array.from({ length: bars }, (_, i) => {
    let peak = 0;
    for (let k = 0; k < group; k++) peak = Math.max(peak, peaks[first + i * group + k] ?? 0);
    return Math.sqrt(peak / 255);
  });
  const x = head === null ? null : (head - from) / width;
  return (
    <>
      {named ? (
        <button
          title={t("从这句听下去：只听{label}", { label })}
          aria-pressed={on}
          onClick={onClick}
          className={`flex h-6 items-center gap-1 justify-self-start rounded-[6px] px-1.5 text-[11px] transition-[background-color,color,scale] duration-150 active:scale-95 ${
            on ? "bg-press text-fg" : "text-muted hover:bg-hover hover:text-fg"
          }`}
        >
          {on ? <Square size={8} fill="currentColor" strokeWidth={0} /> : <Play size={9} fill="currentColor" strokeWidth={0} />}
          {label}
        </button>
      ) : (
        <span className="text-[11px] text-faint">{label}</span>
      )}
      <button
        title={title ?? t("听{label}", { label })}
        onClick={onClick}
        className={`relative ${height} w-full rounded-[6px] transition-colors hover:bg-hover ${tone}`}
      >
        <svg viewBox={`0 0 ${bars} 2`} preserveAspectRatio="none" className="size-full" aria-hidden>
          {heights.map((h, i) =>
            h > 0.02 ? <rect key={i} x={i + 0.15} y={1 - h * 0.92} width={0.7} height={h * 1.84} rx={0.2} fill="currentColor" /> : null,
          )}
        </svg>
        {x !== null && x >= 0 && x <= 1 && (
          <span className="pointer-events-none absolute inset-y-0 w-[1.5px] rounded-full bg-fg" style={{ left: `${x * 100}%` }} />
        )}
      </button>
      <span className="tabular text-right font-mono text-[11px] text-faint">{formatSecs(secs)}</span>
    </>
  );
}
