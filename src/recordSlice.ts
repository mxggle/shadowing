// 跟读录音 part of the single store. A take: open the mic → play the sentence
// once (听完再说: then it's your turn; 边听边说: you speak over it, and once it
// has finished Rust waits only for your last words) → Rust says when you've
// stopped → the take is kept and, by default, played back against the
// original. Works without headphones: Rust takes the original out of the mic.
// 连续录 (the card's button, or M while it loops; lib/rounds.ts) says it again
// and again: the mic stays open, Rust starts afresh each time and keeps the
// time before aside; Space keeps one and stops. 逐句跟读 (drillSlice.ts) runs
// takes like that one sentence after another. The deck's play key pauses a
// take where it is and goes on (lib/playKey.ts; Rust leaves the time out).
// Playing takes back is in takePlayback.ts.
import { listen } from "@tauri-apps/api/event";
import type { AudioEngine } from "./audio/engine";
import { isLoopActive } from "./audio/logic";
import { api, type RecordMode, type Settings, type Take } from "./lib/api";
import { blurField } from "./lib/focus";
import { sentenceIndexAt } from "./lib/sentences";
import { goingOn } from "./lib/playKey";
import { advanceOf, goesAgain, recordsAgain } from "./lib/rounds";
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
  /** Again and again until you keep one (连续录). */
  again: boolean;
  /** Which time through, from 1. */
  n: number;
  /** 逐句跟读: at most this many times, then the next sentence (null: not drilling). */
  max: number | null;
  /** starting: opening the mic · listening: the original plays (听完再说) ·
   *  speaking: your turn (边听边说: the whole take, `along`) · saving: building the take. */
  phase: "starting" | "listening" | "speaking" | "saving";
  /** 边听边说: you speak along with the original. */
  along: boolean;
  /** 边听边说: the original has finished, you're on your last words (Rust stops it soon). */
  tail: boolean;
  /** Paused (the deck's play key): the mic, the original and stopping by itself all wait. */
  paused: boolean;
  /** Recent mic levels (0–1), newest last, for the live meter. */
  levels: number[];
  /** Seconds since your turn began. */
  secs: number;
  /** The microphone recording (the Mac's own when the default is a Bluetooth headset). */
  mic: string;
  /** 配音: said along with the picture, the speakers silent. */
  dub: boolean;
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
  /**
   * Records a take (default: the current sentence, or the A–B loop): once, or
   * again and again (`again`; by default, while it loops), at most `max` times.
   */
  startTake(at?: RecordAt, how?: { again?: boolean; max?: number }): Promise<void>;
  /** Stops and keeps the take; `previous`: said again and again, the time before this one. */
  finishTake(previous?: boolean): Promise<void>;
  cancelTake(): void;
  /** Space / M while recording: skip the rest of the original (听完再说), or keep this time (or the one before) and stop. */
  advanceTake(): void;
  /** Pauses the take where it is, or goes on with it. */
  pauseTake(paused: boolean): Promise<void>;
  /** P: your last take here against the original (or stop it). */
  replayTake(): void;
  deleteTake(id: string): Promise<void>;
  showTake(id: string): void;
  setRecordMode(mode: RecordMode): void;
  /** 配音 (on a video) instead of the other two ways. */
  setRecordDub(on: boolean): void;
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
  /** Bumped by each start and time through, so a reply knows whether it's still the latest. */
  let starts = 0;
  /** The time just said, being checked and kept aside (连续录): stopping waits for it. */
  let keeping: Promise<unknown> = Promise.resolve();
  /** 连续录, by start number: the time through Rust is setting up, and one that waits for the take to go on. */
  let rounding = -1;
  let deferred = -1;

  void listen<{ level: number; speaking: boolean; secs: number }>("recorder:level", ({ payload }) => {
    const rec = get().rec;
    if (!rec || rec.phase === "saving") return;
    patchRec({ levels: [...rec.levels, payload.level].slice(-LEVELS_KEPT), secs: payload.secs });
  });
  void listen<"pause" | "nothing" | "long">("recorder:auto", ({ payload }) => {
    const rec = get().rec;
    if (!rec) return;
    // Too long: Rust has closed the mic, whatever the take was doing.
    if (payload === "long") return void get().finishTake();
    // Only once the original has finished: the stop of a time before may still be on its way.
    if (rec.phase !== "speaking" || (rec.along && !rec.tail)) return;
    if (goesAgain(rec)) void again();
    else void get().finishTake();
  });
  void listen<string>("recorder:error", ({ payload }) => {
    if (!get().rec) return;
    get().cancelTake();
    set({ recError: payload });
  });
  /** How a time through begins: the original on its own (听完再说), or you along with it. */
  const opening = (mode: RecordMode): Pick<Rec, "phase" | "along" | "tail"> =>
    mode === "shadow" ? { phase: "speaking", along: true, tail: false } : { phase: "listening", along: false, tail: false };

  /** A time through, the take's way: the original, with you after it (听完再说) or along with it. */
  function play() {
    const rec = get().rec;
    if (!rec) return;
    patchRec({ ...opening(rec.mode), levels: [], secs: 0 });
    engine.playRange(rec.start, rec.end);
  }

  /**
   * You've stopped (again and again): Rust starts the take afresh, keeping the
   * time just said aside if it had your voice; then the next time. A time with
   * nothing of yours ends it, keeping the one before.
   */
  async function again() {
    const rec = get().rec;
    if (!rec) return;
    const mine = ++starts;
    // As the next time begins (Space now keeps the one just said).
    patchRec({ n: rec.n + 1, ...opening(rec.mode), levels: [], secs: 0 });
    const round = api.record.round();
    keeping = round.catch(() => false);
    rounding = mine;
    const going = () => !!get().rec && get().rec?.phase !== "saving";
    let voiced: boolean;
    try {
      voiced = await round;
    } catch (e) {
      if (mine === starts && going()) {
        get().cancelTake();
        set({ recError: String(e) });
      }
      return;
    } finally {
      if (rounding === mine) rounding = -1;
    }
    // Kept or cancelled meanwhile (Space keeps the time just said once Rust has it aside).
    if (mine !== starts || !going()) return;
    if (!voiced) return void get().finishTake(true);
    if (get().rec?.paused) deferred = mine; // starts once it goes on
    else play();
  }

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

    async startTake(at, how) {
      const s = get();
      if (s.rec) return;
      const where = at ?? (s.recordAt !== null && recordTarget(s, s.recordAt) ? s.recordAt : here());
      const target = where === null ? null : recordTarget(s, where);
      if (!s.current || where === null || !target || s.live) return;
      get().stopTake();
      get().stopReadingPlayback();
      blurField();
      const mode = s.settings.recordMode;
      const dub = mode === "shadow" && s.settings.recordDub && s.current.kind === "video";
      const again = how?.again ?? recordsAgain(where, s.loopSentence, isLoopActive(s.loop));
      const mine = ++starts;
      set({
        recordAt: where,
        shownTake: null,
        recError: null,
        rec: { at: where, ...target, mode, again, n: 1, max: how?.max ?? null, phase: "starting", along: false, tail: false, paused: false, levels: [], secs: 0, mic: "", dub },
      });
      let mic: string;
      try {
        mic = await api.record.begin({ audio: s.current.path, ...target, mode, rate: s.settings.rate, dub });
      } catch (e) {
        if (mine !== starts) return;
        set({ rec: null, recError: String(e) });
        return void get().drillNext(false);
      }
      if (mine !== starts) return; // cancelled and started again: the newer one has the mic now
      if (!get().rec) return void api.record.cancel(); // cancelled while the mic opened
      patchRec({ mic });
      play();
    },

    playbackStopped() {
      const rec = get().rec;
      // Paused, the original waits (going on says whether it had ended).
      if (!rec || rec.paused || rec.phase === "saving") return;
      if (rec.phase === "listening") patchRec({ phase: "speaking" });
      else if (rec.along && !rec.tail) patchRec({ tail: true });
      else return;
      void api.record.turn();
    },

    advanceTake() {
      const rec = get().rec;
      if (!rec || rec.phase === "starting" || rec.phase === "saving") return;
      const what = advanceOf(rec);
      if (what !== "skip") return void get().finishTake(what === "keepBefore");
      engine.pause(); // → playbackStopped: your turn
      if (!rec.paused) return;
      // Paused: the original won't go on (the pause above lets it go); your turn, going on now.
      patchRec({ paused: false });
      void api.record.pause(false);
      get().playbackStopped();
    },

    async pauseTake(paused) {
      const rec = get().rec;
      if (!rec || rec.paused === paused || rec.phase === "starting" || rec.phase === "saving") return;
      const mine = starts;
      patchRec({ paused });
      const going = await api.record.pause(paused).catch(() => false);
      const now = get().rec;
      if (paused || mine !== starts || !now || now.paused || now.phase === "saving") return;
      const next = goingOn({ ...now, going, waiting: rounding === mine ? "round" : deferred === mine ? "start" : null });
      deferred = -1;
      if (next === "start") play();
      else if (next === "turn") get().playbackStopped();
    },

    async finishTake(previous = false) {
      const rec = get().rec;
      const path = get().current?.path;
      if (!rec || rec.phase === "saving" || rec.phase === "starting") return;
      if (!engine.paused) engine.pause();
      patchRec({ phase: "saving" });
      await keeping;
      // Saved for the track it was recorded on; if you've gone to another, it's there when you're back.
      const still = () => get().rec?.phase === "saving" && get().current?.path === path;
      try {
        const take = (await api.record.finish(previous)).takes[0];
        if (!still()) return void get().drillNext(false);
        set((s) => ({ rec: null, takes: take ? [...s.takes, take] : s.takes, shownTake: take?.id ?? null }));
        if (get().drillNext(true)) return; // on to the next sentence
        if (take && get().settings.recordReplay) void get().playTake(take.id, comparePart(take), false);
      } catch (e) {
        if (still()) set({ rec: null, recError: String(e) });
        get().drillNext(false);
      }
    },

    cancelTake() {
      get().drillNext(false);
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

    setRecordDub(recordDub) {
      persistSettings({ recordDub });
    },

    setRecordMode(recordMode) {
      persistSettings({ recordMode });
    },

    setRecordReplay(recordReplay) {
      persistSettings({ recordReplay });
    },

  };
}
