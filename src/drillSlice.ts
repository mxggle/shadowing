// 逐句跟读 part of the single store: a paragraph (the section you're in, or the
// whole text) sentence by sentence. Each sentence is a take said up to
// `drillRounds` times (连续录 with a cap, lib/rounds.ts), kept like any other
// take (on its row); then the next starts by itself. Space keeps one early
// and goes on; Esc, an error, or a first time with nothing of yours stops it,
// keeping the sentences done.
import type { AudioEngine } from "./audio/engine";
import type { Settings } from "./lib/api";
import { readingRange, type ReadingScope } from "./lib/readings";
import { clampRounds } from "./lib/rounds";
import { sectionsOf } from "./lib/sections";
import { sentenceIndexAt } from "./lib/sentences";
import type { AppState } from "./store";

export interface Drill {
  /** Sentences [first, end) gone through. */
  first: number;
  end: number;
  /** The sentence being said (transcript index). */
  current: number;
  rounds: number;
}

export interface DrillState {
  drill: Drill | null;
  /** Starts with the section you're in, or the one sentence `at` is in (or everything). */
  startDrill(opts?: { scope?: ReadingScope; at?: number }): void;
  /**
   * A take ended (`kept`, or not: stopped, failed). Kept, the drill goes on to
   * the next sentence or is done; otherwise it stops. Returns whether the take
   * was the drill's.
   */
  drillNext(kept: boolean): boolean;
  setDrillRounds(n: number): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createDrillSlice(set: Set, get: Get, engine: AudioEngine, persistSettings: (patch: Partial<Settings>) => void): DrillState {
  const say = (d: Drill) => void get().startTake(d.current, { again: d.rounds > 1, max: d.rounds });

  return {
    drill: null,

    startDrill({ scope = "section", at } = {}) {
      const s = get();
      const list = s.transcript?.sentences ?? [];
      if (!s.current || !list.length || s.live || s.rec || s.drill) return;
      const here = at ?? s.loopSentence ?? sentenceIndexAt(list, engine.time);
      const [first, end] = readingRange(scope, sectionsOf(s.transcript), here, list.length);
      if (end <= first) return;
      get().stopReadingPlayback();
      const drill = { first, end, current: first, rounds: clampRounds(s.settings.drillRounds) };
      set({ drill, readingError: null, shownReading: null });
      say(drill);
    },

    drillNext(kept) {
      const d = get().drill;
      if (!d) return false;
      const next = { ...d, current: d.current + 1 };
      if (!kept || next.current >= d.end) {
        set({ drill: null });
        return true;
      }
      set({ drill: next });
      say(next);
      return true;
    },

    setDrillRounds(n) {
      persistSettings({ drillRounds: clampRounds(n) });
    },
  };
}
