// 整段录音 part of the single store: a whole paragraph (a section, or the
// whole text) in one recording. 自己读: nothing plays; Rust follows your voice
// and says which sentence you're on (`recorder:sentence`), and ends after the
// last one. 跟着原文读: the original plays through and you shadow it; the
// highlight is simply the playing sentence. Either way, finishing keeps the
// whole reading and cuts a take per sentence (shown on each row). The deck's
// play key pauses it (or a reading playing back) and goes on.
import { listen } from "@tauri-apps/api/event";
import type { AudioEngine } from "./audio/engine";
import { api, type ParagraphMode, type Reading, type ReadingPlaying, type ReadingWhat, type Settings } from "./lib/api";
import { howSettings, readingHow, readingRange, readingsFor, type ReadingHow, type ReadingScope } from "./lib/readings";
import { sectionsOf } from "./lib/sections";
import { blurField } from "./lib/focus";
import { sentenceIndexAt } from "./lib/sentences";
import type { AppState } from "./store";

export interface LiveReading {
  /** Sentences [first, end) being read. */
  first: number;
  end: number;
  mode: ParagraphMode;
  /** starting: opening the mic · reading · saving: cutting it into sentences. */
  phase: "starting" | "reading" | "saving";
  /** 自己读: the sentence you're on (transcript index). */
  current: number;
  /** 跟着原文读: the original has finished; you may still be finishing. */
  tail: boolean;
  /** Paused (the deck's play key) since then (ms); the clock leaves it out. */
  pausedAt: number | null;
  levels: number[];
  mic: string;
  startedAt: number;
}

export interface PlayingReading extends ReadingPlaying {
  id: string;
  what: ReadingWhat;
  secs: number;
  paused: boolean;
}

export interface ReadingState {
  readings: Reading[];
  live: LiveReading | null;
  /** The reading shown in the paragraph's card (null: none open). */
  shownReading: string | null;
  playingReading: PlayingReading | null;
  readingError: string | null;

  loadReadings(path: string): Promise<void>;
  /** Starts reading the section you're in, or the one sentence `at` is in (or everything); ⇧M. 逐句跟读 is drillSlice.ts. */
  startReading(opts?: { scope?: ReadingScope; mode?: ParagraphMode; at?: number }): Promise<void>;
  finishReading(): Promise<void>;
  cancelReading(): void;
  /** 自己读: the highlight to the next (+1) / previous (−1) sentence by hand. */
  stepReading(by: 1 | -1): void;
  /** Pauses the paragraph being recorded where it is, or goes on with it. */
  pauseReading(paused: boolean): Promise<void>;
  playReading(id: string, what: ReadingWhat): Promise<void>;
  stopReadingPlayback(): void;
  pausePlayingReading(paused: boolean): void;
  deleteReading(id: string): Promise<void>;
  showReading(id: string | null): void;
  setParagraphMode(how: ReadingHow): void;
  /** The track paused: a 跟着原文读 original has played to its end. */
  readingPlaybackStopped(): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

const LEVELS_KEPT = 48;

/** The readings of the paragraph sentences [first, end) cover. */
export function readingsOf(s: AppState, first: number, end: number): Reading[] {
  const list = s.transcript?.sentences;
  if (!list?.[first] || !list[end - 1]) return [];
  return readingsFor(s.readings, list[first].start, list[end - 1].end);
}

export function createReadingSlice(set: Set, get: Get, engine: AudioEngine, persistSettings: (patch: Partial<Settings>) => void): ReadingState {
  const patch = (p: Partial<LiveReading>) => set((s) => (s.live ? { live: { ...s.live, ...p } } : {}));
  /** Bumped by each start, so a start's reply knows whether it's still the latest. */
  let starts = 0;

  void listen<{ level: number }>("recorder:level", ({ payload }) => {
    const live = get().live;
    if (live?.phase === "reading") patch({ levels: [...live.levels, payload.level].slice(-LEVELS_KEPT) });
  });
  void listen<number>("recorder:sentence", ({ payload }) => {
    const live = get().live;
    if (live?.phase === "reading") patch({ current: Math.min(live.end - 1, live.first + payload) });
  });
  void listen("recorder:auto", () => {
    if (get().live?.phase === "reading") void get().finishReading();
  });
  void listen<string>("recorder:error", ({ payload }) => {
    if (!get().live) return;
    get().cancelReading();
    set({ readingError: payload });
  });
  void listen<{ clip: number; secs: number; playing: boolean }>("recorder:clip", ({ payload }) => {
    const p = get().playingReading;
    if (!p || p.clip !== payload.clip) return;
    set({ playingReading: payload.playing ? { ...p, secs: payload.secs } : null });
  });

  return {
    readings: [],
    live: null,
    shownReading: null,
    playingReading: null,
    readingError: null,

    async loadReadings(path) {
      set({ readings: [], shownReading: null, readingError: null });
      const readings = await api.record.readings(path).catch(() => []);
      if (get().current?.path === path) set({ readings });
    },

    async startReading({ scope = "section", mode, at } = {}) {
      const s = get();
      const list = s.transcript?.sentences ?? [];
      if (!s.current || !list.length || s.live || s.rec) return;
      const how = mode ?? readingHow(s.settings);
      if (how === "drill") return get().startDrill({ scope, at });
      if (mode) persistSettings(howSettings(mode));
      const here = at ?? s.loopSentence ?? sentenceIndexAt(list, engine.time);
      const [first, end] = readingRange(scope, sectionsOf(s.transcript), here, list.length);
      if (end <= first) return;
      get().stopReadingPlayback();
      get().stopTake();
      if (!engine.paused) engine.pause();
      blurField();
      const sentences = list.slice(first, end).map(({ start, end, text }) => ({ start, end, text }));
      const mine = ++starts;
      set({
        readingError: null,
        shownReading: null,
        recordAt: null,
        live: { first, end, mode: how, phase: "starting", current: first, tail: false, pausedAt: null, levels: [], mic: "", startedAt: Date.now() },
      });
      let mic: string;
      try {
        mic = await api.record.begin({
          audio: s.current.path,
          start: sentences[0].start,
          end: sentences[sentences.length - 1].end,
          text: "",
          mode: how,
          rate: s.settings.rate,
          sentences,
        });
      } catch (e) {
        if (mine === starts) set({ live: null, readingError: String(e) });
        return;
      }
      if (mine !== starts) return; // cancelled and started again: the newer one has the mic now
      if (!get().live) return void api.record.cancel(); // cancelled while the mic opened
      patch({ phase: "reading", mic, startedAt: Date.now() });
      if (how === "shadow") engine.playRange(sentences[0].start, sentences[sentences.length - 1].end);
    },

    readingPlaybackStopped() {
      const live = get().live;
      // Paused, the original waits (going on says whether it had ended).
      if (live?.phase !== "reading" || live.mode !== "shadow" || live.tail || live.pausedAt !== null) return;
      patch({ tail: true });
      void api.record.turn();
    },

    async finishReading() {
      const live = get().live;
      const path = get().current?.path;
      if (!live || live.phase !== "reading") return;
      if (!engine.paused) engine.pause();
      patch({ phase: "saving" });
      // Saved for the track it was read on; if you've gone to another, it's there when you're back.
      const still = () => get().live?.phase === "saving" && get().current?.path === path;
      try {
        const done = await api.record.finish();
        if (!still()) return;
        const reading = done.reading;
        set((s) => ({
          live: null,
          takes: [...s.takes, ...done.takes],
          readings: reading ? [...s.readings, reading] : s.readings,
          shownReading: reading?.id ?? null,
        }));
      } catch (e) {
        if (still()) set({ live: null, readingError: String(e) });
      }
    },

    cancelReading() {
      // Once saving, Rust has the reading: it can't be called back (leaving the track clears it, `open`).
      if (!get().live || get().live?.phase === "saving") return;
      if (!engine.paused) engine.pause();
      set({ live: null });
      void api.record.cancel();
    },

    stepReading(by) {
      const live = get().live;
      if (live?.phase !== "reading" || live.mode !== "read") return;
      const current = Math.max(live.first, Math.min(live.end - 1, live.current + by));
      if (current === live.current) return;
      patch({ current });
      void api.record.step(by);
    },

    async pauseReading(paused) {
      const live = get().live;
      if (live?.phase !== "reading" || (live.pausedAt !== null) === paused) return;
      const [mine, now] = [starts, Date.now()];
      patch(paused ? { pausedAt: now } : { pausedAt: null, startedAt: live.startedAt + now - (live.pausedAt ?? now) });
      const going = await api.record.pause(paused).catch(() => false);
      // 跟着原文读: the original ended as you paused; you may still be finishing.
      if (!paused && !going && mine === starts) get().readingPlaybackStopped();
    },

    async playReading(id, what) {
      const path = get().current?.path;
      if (!path || get().live || get().rec) return;
      get().stopTake();
      try {
        const p = await api.record.playReading(path, id, what);
        set({ playingReading: { id, what, ...p, secs: 0, paused: false }, shownReading: id, readingError: null });
      } catch (e) {
        set({ readingError: String(e) });
      }
    },

    stopReadingPlayback() {
      if (!get().playingReading) return;
      set({ playingReading: null });
      void api.record.stop();
    },

    pausePlayingReading(paused) {
      const p = get().playingReading;
      if (!p || p.paused === paused) return;
      set({ playingReading: { ...p, paused } });
      void api.record.pauseClip(paused);
    },

    async deleteReading(id) {
      const path = get().current?.path;
      if (!path) return;
      if (get().playingReading?.id === id) get().stopReadingPlayback();
      try {
        await api.record.removeReading(path, id);
      } catch (e) {
        return void set({ readingError: String(e) });
      }
      set((s) => ({
        readings: s.readings.filter((r) => r.id !== id),
        takes: s.takes.filter((t) => t.group !== id),
        shownReading: null,
      }));
    },

    showReading(id) {
      get().stopReadingPlayback();
      set({ shownReading: id, readingError: null });
    },

    setParagraphMode(how) {
      persistSettings(howSettings(how));
    },
  };
}
