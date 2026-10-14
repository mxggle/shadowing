// 跟读录音 part of the single store. A take: open the mic → play the sentence
// once (听完再说: then it's your turn; 边听边说: you speak over it) → Rust says
// when you've stopped → the take is kept and, by default, played back against
// the original. Works without headphones: Rust takes the original out of the mic.
// Playing takes back is in takePlayback.ts.
import { listen } from "@tauri-apps/api/event";
import type { AudioEngine } from "./audio/engine";
import { isLoopActive } from "./audio/logic";
import { api, type RecordMode, type Settings, type Take } from "./lib/api";
import { blurField } from "./lib/focus";
import { sentenceIndexAt } from "./lib/sentences";
import { comparePart, takesFor } from "./lib/takes";
import type { AppState } from "./store";
import { createTakePlayback, type TakePlayback } from "./takePlayback";

/** Where the recorder is: under a sentence, or (without a transcript) the A–B loop. */
export type RecordAt = number | "loop";

export interface Rec {
  at: RecordAt;
  start: number;
  end: number;
  mode: RecordMode;
  /** starting: opening the mic · listening: the original plays (听完再说) ·
   *  speaking: your turn (`along`: the original is still playing, 边听边说) · saving: building the take. */
  phase: "starting" | "listening" | "speaking" | "saving";
  along: boolean;
  /** Recent mic levels (0–1), newest last, for the live meter. */
  levels: number[];
  /** Seconds since your turn began. */
  secs: number;
  /** The microphone recording (the Mac's own when the default is a Bluetooth headset). */
  mic: string;
}

export interface RecordState extends TakePlayback {
  /** Takes of the open track. */
  takes: Take[];
  /** Where the recorder card is open. */
  recordAt: RecordAt | null;
  rec: Rec | null;
  recError: string | null;
  /** The take shown in the card (null: the newest there). */
  shownTake: string | null;

  loadTakes(path: string): Promise<void>;
  /** Opens or closes the card (default: the current sentence); with no takes there yet it starts one. */
  toggleRecorder(at?: RecordAt): void;
  closeRecorder(): void;
  /** Records a take (default: the current sentence, or the A–B loop). M while recording finishes it. */
  startTake(at?: RecordAt): Promise<void>;
  finishTake(): Promise<void>;
  cancelTake(): void;
  /** Space while recording: skip the rest of the original, or finish. */
  advanceTake(): void;
  /** P: your last take here against the original (or stop it). */
  replayTake(): void;
  deleteTake(id: string): Promise<void>;
  showTake(id: string): void;
  setRecordMode(mode: RecordMode): void;
  setRecordReplay(on: boolean): void;
  /** The track paused (a range played to its end, or anything else). */
  playbackStopped(): void;
}

export type Get = () => AppState;
export type Set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

const LEVELS_KEPT = 48;

/**
 * The microphone is open (a take or a paragraph, not yet saving): only the
 * recording's own controls act; anything else that moves or restarts the
 * track would play past the original's end or record the wrong thing.
 */
export const micOpen = (s: AppState) => (!!s.rec && s.rec.phase !== "saving") || (!!s.live && s.live.phase !== "saving");

/** The stretch a take at `at` is of, and its text. */
export function recordTarget(s: AppState, at: RecordAt) {
  if (at === "loop") {
    const { a, b } = s.loop;
    return a !== null && b !== null ? { start: a, end: b, text: "" } : null;
  }
  const sentence = s.transcript?.sentences[at];
  return sentence ? { start: sentence.start, end: sentence.end, text: sentence.text } : null;
}

/** The takes shown in the card at `at`, newest last. */
export function takesAt(s: AppState, at: RecordAt | null): Take[] {
  const target = at === null ? null : recordTarget(s, at);
  return target ? takesFor(s.takes, target.start, target.end) : [];
}

export function createRecordSlice(set: Set, get: Get, engine: AudioEngine, persistSettings: (patch: Partial<Settings>) => void): RecordState {
  const patchRec = (patch: Partial<Rec>) => set((s) => (s.rec ? { rec: { ...s.rec, ...patch } } : {}));
  /** Bumped by each start, so a start's reply knows whether it's still the latest. */
  let starts = 0;

  void listen<{ level: number; speaking: boolean; secs: number }>("recorder:level", ({ payload }) => {
    const rec = get().rec;
    if (!rec || rec.phase === "saving") return;
    patchRec({ levels: [...rec.levels, payload.level].slice(-LEVELS_KEPT), secs: payload.secs });
  });
  void listen<"pause" | "nothing" | "long">("recorder:auto", ({ payload }) => {
    const phase = get().rec?.phase;
    // Too long: Rust has closed the mic, whatever the take was doing.
    if (phase === "speaking" || (payload === "long" && phase === "listening")) void get().finishTake();
  });
  void listen<string>("recorder:error", ({ payload }) => {
    if (!get().rec) return;
    get().cancelTake();
    set({ recError: payload });
  });
  /** Default place: the looped / current sentence, else the A–B loop. */
  function here(): RecordAt | null {
    const s = get();
    const sentences = s.transcript?.sentences ?? [];
    if (sentences.length) return s.loopSentence ?? Math.max(0, sentenceIndexAt(sentences, engine.time));
    return isLoopActive(s.loop) ? "loop" : null;
  }

  return {
    ...createTakePlayback(set, get, engine),
    takes: [],
    recordAt: null,
    rec: null,
    recError: null,
    shownTake: null,

    async loadTakes(path) {
      set({ takes: [], recordAt: null, shownTake: null, recError: null });
      const takes = await api.record.takes(path).catch(() => []);
      if (get().current?.path === path) set({ takes });
    },

    toggleRecorder(at) {
      if (micOpen(get())) return;
      const where = at ?? here();
      if (where === null) return;
      if (get().recordAt === where && !get().rec) return get().closeRecorder();
      set({ recordAt: where, shownTake: null, recError: null });
      if (takesAt(get(), where).length === 0) void get().startTake(where);
    },

    closeRecorder() {
      if (get().rec) get().cancelTake();
      get().stopTake();
      set({ recordAt: null, shownTake: null, recError: null });
    },

    async startTake(at) {
      const s = get();
      if (s.rec) return;
      const where = at ?? (s.recordAt !== null && recordTarget(s, s.recordAt) ? s.recordAt : here());
      const target = where === null ? null : recordTarget(s, where);
      if (!s.current || where === null || !target || s.live) return;
      get().stopTake();
      get().stopReadingPlayback();
      blurField();
      const mode = s.settings.recordMode;
      const mine = ++starts;
      set({
        recordAt: where,
        shownTake: null,
        recError: null,
        rec: { at: where, ...target, mode, phase: "starting", along: false, levels: [], secs: 0, mic: "" },
      });
      let mic: string;
      try {
        mic = await api.record.begin({ audio: s.current.path, ...target, mode, rate: s.settings.rate });
      } catch (e) {
        if (mine === starts) set({ rec: null, recError: String(e) });
        return;
      }
      if (mine !== starts) return; // cancelled and started again: the newer one has the mic now
      if (!get().rec) return void api.record.cancel(); // cancelled while the mic opened
      patchRec(mode === "listen" ? { phase: "listening", mic } : { phase: "speaking", along: true, mic });
      engine.playRange(target.start, target.end);
    },

    playbackStopped() {
      const rec = get().rec;
      if (!rec || rec.phase === "saving" || !(rec.phase === "listening" || rec.along)) return;
      patchRec({ phase: "speaking", along: false });
      void api.record.turn();
    },

    advanceTake() {
      const rec = get().rec;
      if (!rec) return;
      if (rec.phase === "listening" || rec.along) engine.pause(); // → playbackStopped: your turn
      else if (rec.phase === "speaking") void get().finishTake();
    },

    async finishTake() {
      const rec = get().rec;
      const path = get().current?.path;
      if (!rec || rec.phase === "saving" || rec.phase === "starting") return;
      if (!engine.paused) engine.pause();
      patchRec({ phase: "saving" });
      // Saved for the track it was recorded on; if you've gone to another, it's there when you're back.
      const still = () => get().rec?.phase === "saving" && get().current?.path === path;
      try {
        const take = (await api.record.finish()).takes[0];
        if (!still()) return;
        set((s) => ({ rec: null, takes: take ? [...s.takes, take] : s.takes, shownTake: take?.id ?? null }));
        if (take && get().settings.recordReplay) void get().playTake(take.id, comparePart(take), false);
      } catch (e) {
        if (still()) set({ rec: null, recError: String(e) });
      }
    },

    cancelTake() {
      // Once saving, Rust has the take: it can't be called back (leaving the track clears it, `open`).
      if (!get().rec || get().rec?.phase === "saving") return;
      if (!engine.paused) engine.pause();
      set({ rec: null });
      void api.record.cancel();
    },

    replayTake() {
      if (get().playingTake) return get().stopTake();
      const where = get().recordAt ?? here();
      if (where === null) return;
      const takes = takesAt(get(), where);
      const take = takes.find((t) => t.id === get().shownTake) ?? takes[takes.length - 1];
      if (!take) return;
      set({ recordAt: where });
      void get().playTake(take.id, comparePart(take));
    },

    async deleteTake(id) {
      const path = get().current?.path;
      if (!path) return;
      if (get().playingTake?.id === id) get().stopTake();
      try {
        await api.record.remove(path, id);
      } catch (e) {
        return void set({ recError: String(e) });
      }
      set((s) => ({ takes: s.takes.filter((t) => t.id !== id), shownTake: s.shownTake === id ? null : s.shownTake }));
    },

    showTake(id) {
      get().stopTake();
      set({ shownTake: id });
    },

    setRecordMode(recordMode) {
      persistSettings({ recordMode });
    },

    setRecordReplay(recordReplay) {
      persistSettings({ recordReplay });
    },
  };
}
