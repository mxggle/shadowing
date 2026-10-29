import { memo, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Sentence, Take } from "../lib/api";
import { t } from "../lib/i18n";
import { headOnTake } from "../lib/readings";
import { comparePart, inTurns, lagNote, paceNote, peekTake, playheadAt } from "../lib/takes";
import { useApp, type AppState } from "../store";
import { TakeWaves } from "./TakeWaves";
import { useKeys } from "../hooks/useKeys";

/**
 * Under the sentence playing (or paused on, or looped) once you've recorded
 * it: your take against the original, opening up like the current line of
 * lyrics and closing again as playback moves on. A click plays the comparison,
 * and on through the recorded sentences after it; the full card (how to
 * record, earlier takes, 录一遍 / 连续录) is the mic's.
 */
export const TakePeek = memo(function TakePeek({ sentence, open }: { sentence: Sentence; open: boolean }) {
  // Kept a moment after closing, so it can fold away.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), 250);
    return () => window.clearTimeout(timer);
  }, [open]);
  return (
    <div
      aria-hidden={!open}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="min-h-0 overflow-hidden">{mounted && <Peek start={sentence.start} end={sentence.end} />}</div>
    </div>
  );
});

function Peek({ start, end }: { start: number; end: number }) {
  const take = useApp((s) => {
    const reading = s.readings.find((r) => r.id === (s.playingReading?.id ?? s.shownReading));
    return peekTake(s.takes, start, end, [s.playingTake?.id, s.shownTake, ...(reading?.parts.map((p) => p.take) ?? [])]);
  });
  if (!take) return null;
  return <PeekTake take={take} />;
}

function PeekTake({ take }: { take: Take }) {
  const key = useKeys();
  const head = useApp(useShallow((s) => headOf(s, take)));
  const playing = useApp((s) => s.playingTake?.id === take.id);
  const { playTake, stopTake } = useApp.getState();
  const both = comparePart(take);
  const note = inTurns(take) ? paceNote(take) : lagNote(take.lagMs, take.bluetooth);
  return (
    <div className="max-w-[560px] pt-1 pb-1.5">
      <TakeWaves
        compact
        take={take}
        head={head}
        titles={playing ? t("停 (空格)") : inTurns(take) ? t("从这句听下去：每句先原句，再你的 ({key})", { key: key("replay") }) : t("从这句听下去：原句和你的一起放 ({key})", { key: key("replay") })}
        onPlay={() => (playing ? stopTake() : void playTake(take.id, both))}
      />
      {note && <p className="mt-0.5 pl-[2.75rem] text-[12px] leading-4 text-faint">{note}</p>}
    </div>
  );
}

/** Where playback is on the take: playing the take itself, or a reading it was cut from. */
function headOf(s: AppState, take: Take): { original: number | null; mine: number | null } {
  if (s.playingTake?.id === take.id) return playheadAt(s.playingTake.parts, s.playingTake.secs);
  const p = s.playingReading;
  const part = p ? s.readings.find((r) => r.id === p.id)?.parts.findIndex((x) => x.take === take.id) ?? -1 : -1;
  if (p && part >= 0) return headOnTake(p, p.secs, part, take);
  return { original: null, mine: null };
}
