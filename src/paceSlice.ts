// 跟读停顿 part of the single store: with it on, the track plays one sentence at a time (an A–B
// loop's stretch, without a transcript), each `sentenceRepeats` times, waiting after each time so
// you can say it. The engine plays a stretch to the frame (playRange); its stop comes back as a
// pause, and this slice waits and goes on (lib/pace.ts has the rules). Off, nothing changes: the
// track and its loops play as they always did.
import { isLoopActive } from "./audio/logic";
import type { AudioEngine } from "./audio/engine";
import type { Settings } from "./lib/api";
import { t } from "./lib/i18n";
import { clampRatio, clampRepeats, clampSeconds, END_MARGIN, longer, nextAfter, paceActive, pauseAfter, pauseLengthOf, pauseModeOf, pauseWaitOf, shorter, stretchAt, type Next, type PaceSettings, type Stretch } from "./lib/pace";
import { micOpen } from "./recordSlice";
import type { AppState } from "./store";

export interface PaceRun {
  stretch: Stretch;
  /** Time through it (1, 2…). */
  pass: number;
}

export interface PaceGap {
  /** When it goes on by itself (performance.now() ms); null waits for you. */
  until: number | null;
  /** How long the whole pause is, in seconds (0 when it waits). */
  secs: number;
  /** Waiting until you've said it: the mic listens for you to start and stop. */
  listening?: boolean;
}

export interface PaceState {
  /** The stretch being played (or just played) one at a time. */
  pace: PaceRun | null;
  /** The pause after a time through, while it lasts. */
  paceGap: PaceGap | null;
  /** Pauses that have ended this session (the practice checklist counts them). */
  paceSaid: number;
  /** The deck key's menu is open (the loop strip opens it too). */
  paceMenu: boolean;
  setPaceMenu(open: boolean): void;
  /** Changes the settings; any change but switching it off turns 跟读停顿 on. */
  setPace(patch: Partial<PaceSettings>): void;
  /** On / off, keeping the settings (the deck key, G). */
  togglePace(): void;
  /** Plays from `t`: a stretch at a time with 跟读停顿 on, else straight on. */
  playFrom(t: number): void;
  /** A seek while it plays (or pauses after a time through) plays a stretch from there; false: an ordinary seek. */
  paceSeek(t: number): boolean;
  /** The play key with 跟读停顿 on (false: not its business). */
  paceToggle(): boolean;
  /** Ends a pause now and goes on. */
  paceGoOn(): void;
  /** A pause that goes on by itself waits for you instead (Esc). False when there's none. */
  paceHold(): boolean;
  /** The engine started or stopped playing. */
  pacePlaying(playing: boolean): void;
  /** The sentences or the loop changed while playing: the stretch's end may have moved. */
  paceRearm(): void;
  /** Forgets everything (another track, another folder). */
  paceReset(): void;
}

/** The store's 跟读停顿 settings, for components (with useShallow). */
export const paceSettingsOf = (s: AppState): PaceSettings => {
  const { paceOn, pauseMode, pauseLength, pauseSeconds, pauseRatio, pauseWait, sentenceRepeats } = s.settings;
  return { paceOn, pauseMode, pauseLength, pauseSeconds, pauseRatio, pauseWait, sentenceRepeats };
};

type Get = () => AppState;
type Set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

const STOP_TOLERANCE = 0.1;

export function createPaceSlice(set: Set, get: Get, engine: AudioEngine, persistSettings: (patch: Partial<Settings>) => void): PaceState {
  /** The stop of the range this slice asked the engine for, while it plays it. */
  let armed: number | null = null;
  let timer = 0;
  /** What the pause leads to. */
  let after: Next | null = null;
  /** Pauses in a row ended early by the learner, or held with Esc: a nudge to change the length. */
  let early = 0;
  let held = 0;

  const sentences = () => get().transcript?.sentences ?? [];

  /** On, and nothing else using the track (a recording, a playback, the mic). */
  function free(): boolean {
    const s = get();
    return paceActive(s.settings) && !!s.current && s.current.kind !== "unsupported" && !micOpen(s) && !s.rec && !s.live && !s.drill && !s.playingTake && !s.playingReading;
  }

  function clearGap() {
    window.clearTimeout(timer);
    after = null;
    if (get().paceGap) set({ paceGap: null });
  }

  /** Plays the stretch at `t` from `t`, as time `pass` through it; with none, straight on. */
  function run(t: number, pass = 1) {
    clearGap();
    const stretch = stretchAt(sentences(), get().loop, t);
    if (!stretch || stretch.stop - t < END_MARGIN) {
      armed = null;
      set({ pace: null });
      engine.seek(t);
      if (engine.paused) engine.play();
      return;
    }
    armed = stretch.stop;
    set({ pace: { stretch, pass } });
    engine.playRange(t, stretch.stop);
  }

  /** Going on from where it stopped, keeping the count if it's the same stretch. */
  function resume() {
    const t = engine.time;
    const was = get().pace;
    const stretch = stretchAt(sentences(), get().loop, t);
    if (!stretch) {
      // After the last sentence: the rest plays straight on.
      armed = null;
      set({ pace: null });
      if (engine.paused) engine.play();
      return;
    }
    const same = was && stretch && was.stretch.stop === stretch.stop && was.stretch.from === stretch.from;
    run(t, same ? was.pass : 1);
  }

  /** A time through ended at its stop: count it, then pause and go on. */
  function passDone(run: PaceRun) {
    const { settings } = get();
    const { stretch, pass } = run;
    const next = nextAfter(stretch, pass, settings.sentenceRepeats, sentences());
    const secs = pauseAfter(settings, stretch.stop - stretch.from, settings.rate);
    after = next;
    if (secs === 0) return go();
    set({ paceGap: { until: secs === null ? null : performance.now() + secs * 1000, secs: secs ?? 0 } });
    if (secs !== null)
      timer = window.setTimeout(() => {
        early = 0;
        set((s) => ({ paceSaid: s.paceSaid + 1 }));
        go();
      }, secs * 1000);
  }

  /** The pause is over: what comes after it. */
  function go() {
    const next = after;
    const was = get().pace;
    clearGap();
    if (!next || !was || !free()) return;
    const { stretch, pass } = was;
    // The loop's "第 n 遍" counts its times through, as the engine's own wraps do.
    if (stretch.wrap !== null && isLoopActive(get().loop) && next.kind !== "end") {
      set((s) => ({ repeats: s.repeats + 1 }));
      get().notePass();
    }
    if (next.kind === "again") return run(stretch.from, pass + 1);
    if (next.kind === "end") {
      armed = null;
      set({ pace: null });
      engine.play(); // the rest of the track after the last sentence, then on as the play order says
      return;
    }
    // Back to a loop's start: the loop may have gone meanwhile, then on to the next sentence.
    run(stretch.wrap !== null && !isLoopActive(get().loop) ? stretch.stop : next.at);
  }

  /** Offers a pause that fits better, once the learner has shown it three times in a row. */
  function suggest(id: "paceShorter" | "paceLonger", label: string, patch: Partial<PaceSettings> | null) {
    if (patch) get().nudge(id, { label, run: () => get().setPace(patch) });
  }

  return {
    pace: null,
    paceGap: null,
    paceSaid: 0,
    paceMenu: false,

    setPaceMenu(paceMenu) {
      set({ paceMenu });
    },

    setPace(patch) {
      const before = paceActive(get().settings);
      const clean: Partial<Settings> = {};
      if (patch.paceOn !== undefined) clean.paceOn = patch.paceOn;
      if (patch.pauseMode !== undefined) clean.pauseMode = pauseModeOf(patch.pauseMode);
      if (patch.pauseLength !== undefined) clean.pauseLength = pauseLengthOf(patch.pauseLength);
      if (patch.pauseSeconds !== undefined) clean.pauseSeconds = clampSeconds(patch.pauseSeconds);
      if (patch.pauseRatio !== undefined) clean.pauseRatio = clampRatio(patch.pauseRatio);
      if (patch.pauseWait !== undefined) clean.pauseWait = pauseWaitOf(patch.pauseWait);
      if (patch.sentenceRepeats !== undefined) clean.sentenceRepeats = clampRepeats(patch.sentenceRepeats);
      // Choosing how it pauses means wanting it.
      if (patch.paceOn === undefined) clean.paceOn = true;
      persistSettings(clean);
      const now = paceActive(get().settings);
      if (now === before) return;
      if (now) get().nudge("paceFirst");
      if (now) {
        if (!engine.paused && free()) resume();
        return;
      }
      // Off: the stretch playing plays on; a pause ends and the track goes on.
      const waiting = !!get().paceGap;
      clearGap();
      set({ pace: null });
      if (armed !== null) engine.endRange();
      armed = null;
      if (waiting && !micOpen(get())) engine.play();
    },

    togglePace() {
      get().setPace({ paceOn: !get().settings.paceOn });
    },

    playFrom(t) {
      if (micOpen(get())) return;
      if (free()) return run(t);
      get().seek(t);
      if (engine.paused) engine.play();
    },

    paceSeek(t) {
      if (!free()) return false;
      const gap = get().paceGap;
      if (engine.paused && gap?.until == null) {
        // Paused (or waiting for you): moves there and stays paused, as always.
        clearGap();
        armed = null;
        if (get().pace) set({ pace: null });
        return false;
      }
      run(t);
      return true;
    },

    paceToggle() {
      if (!free()) return false;
      if (get().paceGap) get().paceGoOn();
      else if (!engine.paused) engine.pause();
      else resume();
      return true;
    },

    paceGoOn() {
      const gap = get().paceGap;
      if (!gap) return;
      set((s) => ({ paceSaid: s.paceSaid + 1 }));
      if (gap.until !== null) {
        held = 0;
        if (++early >= 3) suggest("paceShorter", t("调短一点"), shorter(get().settings));
      }
      go();
    },

    paceHold() {
      const gap = get().paceGap;
      if (!gap) return false;
      if (gap.until === null) return false; // already waiting: Esc does what it always did
      window.clearTimeout(timer);
      set({ paceGap: { until: null, secs: 0 } });
      early = 0;
      if (++held >= 3) suggest("paceLonger", t("调长一点"), longer(get().settings));
      return true;
    },

    pacePlaying(playing) {
      if (playing) {
        // Started some other way (a track playing on by itself, the play order repeating it…).
        if (armed === null && !get().paceGap && free()) {
          const stretch = stretchAt(sentences(), get().loop, engine.time);
          if (stretch) resume();
        }
        return;
      }
      const stop = armed;
      armed = null;
      const run = get().pace;
      if (stop === null || !run || get().paceGap || !free()) return;
      // Reaching the stop, not paused before it.
      if (Math.abs(engine.time - stop) < STOP_TOLERANCE) passDone(run);
    },

    paceRearm() {
      if (!engine.paused && free() && !get().paceGap) resume();
    },

    paceReset() {
      clearGap();
      armed = null;
      if (get().pace) set({ pace: null });
    },
  };
}
