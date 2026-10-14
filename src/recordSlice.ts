// 跟读录音 part of the single store. A take: open the mic → play the sentence
// once (听完再说: then it's your turn; 边听边说: you speak over it) → Rust says
// when you've stopped → the take is kept and, by default, played back against
// the original. Works without headphones: Rust takes the original out of the mic.
// Playing a take back goes on to the next recorded sentence, the same way
// (一起听 / 对比 / 原句 / 我的), so a whole text can be listened through.
import { listen } from "@tauri-apps/api/event";
import type { AudioEngine } from "./audio/engine";
import { isLoopActive } from "./audio/logic";
import { api, type ClipPart, type RecordMode, type Settings, type Take, type TakePart } from "./lib/api";
import { sentenceIndexAt } from "./lib/sentences";
import { comparePart, nextTake, sentenceOf, takesFor } from "./lib/takes";
import type { AppState } from "./store";

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

export interface PlayingTake {
  id: string;
  what: TakePart;
  /** At its end, go on to the next recorded sentence (not after a fresh recording's replay). */
  chain: boolean;
  clip: number;
  parts: ClipPart[];
  duration: number;
  secs: number;
}

export interface RecordState {
  /** Takes of the open track. */
  takes: Take[];
  /** Where the recorder card is open. */
  recordAt: RecordAt | null;
  rec: Rec | null;
  recError: string | null;
  /** The take shown in the card (null: the newest there). */
  shownTake: string | null;
  playingTake: PlayingTake | null;

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
  /** Plays a take, then (`chain`, the default) each recorded sentence after it the same way. */
  playTake(id: string, what: TakePart, chain?: boolean): Promise<void>;
  /** P: your last take here against the original (or stop it). */
  replayTake(): void;
  stopTake(): void;
  deleteTake(id: string): Promise<void>;
  showTake(id: string): void;
  setRecordMode(mode: RecordMode): void;
  setRecordReplay(on: boolean): void;
  /** The track paused (a range played to its end, or anything else). */
  playbackStopped(): void;
  /** The track started playing: a take playing, or about to, gives way to it. */
  trackPlaying(): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

const LEVELS_KEPT = 48;

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

  void listen<{ level: number; speaking: boolean; secs: number }>("recorder:level", ({ payload }) => {
    const rec = get().rec;
    if (!rec || rec.phase === "saving") return;
    patchRec({ levels: [...rec.levels, payload.level].slice(-LEVELS_KEPT), secs: payload.secs });
  });
  void listen("recorder:auto", () => {
    if (get().rec?.phase === "speaking") void get().finishTake();
  });
  void listen<string>("recorder:error", ({ payload }) => {
    if (!get().rec) return;
    get().cancelTake();
    set({ recError: payload });
  });
  void listen<{ clip: number; secs: number; playing: boolean; ended: boolean }>("recorder:clip", ({ payload }) => {
    const p = get().playingTake;
    if (!p || p.clip !== payload.clip) return;
    set({ playingTake: payload.playing ? { ...p, secs: payload.secs } : null });
    // Only a take that played to its end goes on; playing the track stops it short.
    if (payload.ended && p.chain) playOn(p);
  });

  /** Bumped by every play and stop; `stoppedAt` is the bump of the last stop. A play
   *  that was stopped while it started is stopped once it has (`resume`: by playing
   *  the track, which it paused); one that another play took over from is left to it. */
  let playing = 0;
  let stoppedAt = -1;
  let resume = false;

  /**
   * A take played to its end: the next recorded sentence, the same way. Its
   * card, left behind, closes; the track moves along (unless looping), so
   * stopping leaves you on the sentence you got to.
   */
  function playOn(p: PlayingTake) {
    const s = get();
    const sentences = s.transcript?.sentences ?? [];
    const take = s.takes.find((t) => t.id === p.id);
    const from = take ? sentenceOf(take, sentences) : -1;
    const next = from < 0 ? null : nextTake(s.takes, sentences, from, take?.group);
    if (!next || s.rec || s.live) return;
    if (s.recordAt === from) set({ recordAt: null, recError: null });
    if (!isLoopActive(s.loop)) get().seek(sentences[next.index].start);
    void get().playTake(next.take.id, p.what);
  }

  /** Default place: the looped / current sentence, else the A–B loop. */
  function here(): RecordAt | null {
    const s = get();
    const sentences = s.transcript?.sentences ?? [];
    if (sentences.length) return s.loopSentence ?? Math.max(0, sentenceIndexAt(sentences, engine.time));
    return isLoopActive(s.loop) ? "loop" : null;
  }

  return {
    takes: [],
    recordAt: null,
    rec: null,
    recError: null,
    shownTake: null,
    playingTake: null,

    async loadTakes(path) {
      set({ takes: [], recordAt: null, shownTake: null, recError: null });
      const takes = await api.record.takes(path).catch(() => []);
      if (get().current?.path === path) set({ takes });
    },

    toggleRecorder(at) {
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
      const mode = s.settings.recordMode;
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
        set({ rec: null, recError: String(e) });
        return;
      }
      if (!get().rec) return void api.record.cancel(); // cancelled while the mic opened
      patchRec(mode === "listen" ? { phase: "listening", mic } : { phase: "speaking", along: true, mic });
      engine.playRange(target.start, target.end);
    },

    playbackStopped() {
      const rec = get().rec;
      if (!rec || !(rec.phase === "listening" || rec.along)) return;
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
      if (!rec || rec.phase === "saving" || rec.phase === "starting") return;
      if (!engine.paused) engine.pause();
      patchRec({ phase: "saving" });
      try {
        const take = (await api.record.finish()).takes[0];
        set((s) => ({ rec: null, takes: take ? [...s.takes, take] : s.takes, shownTake: take?.id ?? null }));
        if (take && get().settings.recordReplay) void get().playTake(take.id, comparePart(take), false);
      } catch (e) {
        set({ rec: null, recError: String(e) });
      }
    },

    cancelTake() {
      if (!get().rec) return;
      if (!engine.paused) engine.pause();
      set({ rec: null });
      void api.record.cancel();
    },

    async playTake(id, what, chain = true) {
      const path = get().current?.path;
      if (!path || get().rec) return;
      const mine = ++playing;
      // Playing from now (clip −1 until it starts): the list moves to its sentence
      // without a gap, and the end of the clip it replaces isn't one to go on from.
      set({ playingTake: { id, what, chain, clip: -1, parts: [], duration: 0, secs: 0 }, shownTake: id, recError: null });
      try {
        const p = await api.record.play(path, id, what);
        if (mine !== playing) {
          if (stoppedAt === playing) void (resume ? engine.play() : api.record.stop());
          return;
        }
        set({ playingTake: { id, what, chain, ...p, secs: 0 } });
      } catch (e) {
        if (mine === playing) set({ playingTake: null, recError: String(e) });
      }
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

    stopTake() {
      stoppedAt = ++playing;
      resume = false;
      if (!get().playingTake) return;
      set({ playingTake: null });
      void api.record.stop();
    },

    trackPlaying() {
      const p = get().playingTake;
      if (!p) return;
      // The engine has stopped the clip already; one still starting pauses the track, so play it again then.
      stoppedAt = ++playing;
      resume = p.clip === -1;
      set({ playingTake: null });
    },

    async deleteTake(id) {
      const path = get().current?.path;
      if (!path) return;
      if (get().playingTake?.id === id) get().stopTake();
      await api.record.remove(path, id);
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
