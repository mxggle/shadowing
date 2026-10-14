import type { Take } from "../lib/api";
import { formatSecs, lanes, mineSecs, playheadAt } from "../lib/takes";
import type { PlayingTake } from "../recordSlice";

/** Peaks are stored 50 a second. */
const PER_SEC = 50;
/** Long takes are drawn with fewer, wider bars. */
const MAX_BARS = 160;

/**
 * The original above, you below, drawn to the same scale: 听完再说 lines both up
 * at their first sound, 边听边说 keeps the real timeline (the lag shows). A
 * playhead runs along whichever is playing; a click plays that voice.
 */
export function TakeWaves({ take, playing, onPlay }: {
  take: Take;
  playing: PlayingTake | null;
  onPlay: (lane: "original" | "mine") => void;
}) {
  const l = lanes(take);
  const head = playing ? playheadAt(playing.parts, playing.secs) : { original: null, mine: null };
  return (
    <div className="grid grid-cols-[2.25rem_1fr_3.25rem] items-center gap-x-2 gap-y-1">
      <Lane
        label="原句"
        peaks={take.peaks.original}
        from={l.original}
        width={l.width}
        secs={take.original[1] - take.original[0]}
        head={head.original}
        tone="text-fg/35"
        onClick={() => onPlay("original")}
      />
      <Lane
        label="我的"
        peaks={take.peaks.mine}
        from={l.mine}
        width={l.width}
        secs={mineSecs(take)}
        head={head.mine}
        tone="text-fg/80"
        onClick={() => onPlay("mine")}
      />
    </div>
  );
}

function Lane({ label, peaks, from, width, secs, head, tone, onClick }: {
  label: string;
  peaks: number[];
  from: number;
  width: number;
  /** Length shown at the end. */
  secs: number;
  head: number | null;
  tone: string;
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
      <span className="text-[11px] text-faint">{label}</span>
      <button
        title={`听${label}`}
        onClick={onClick}
        className={`relative h-9 w-full rounded-[6px] transition-colors hover:bg-hover ${tone}`}
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
