// Transcript part of the single store: loading/importing a track's sentences,
// and playing or looping them through the same A–B loop the L key uses.
import { listen } from "@tauri-apps/api/event";
import { isLoopActive, NO_LOOP, type Loop } from "./audio/logic";
import type { AudioEngine } from "./audio/engine";
import { api, type TranscribeStatus, type Transcript } from "./lib/api";
import { sentenceIndexAt, sentenceLoop, sentenceStart, stepTarget } from "./lib/sentences";
import type { AppState } from "./store";

export interface TranscriptState {
  transcript: Transcript | null;
  /** Index of the sentence being repeated, when the loop came from the transcript. */
  loopSentence: number | null;

  loadTranscript(path: string): Promise<void>;
  importTranscript(): Promise<void>;
  removeTranscript(): Promise<void>;
  /** Play from a sentence; an active loop moves to it. */
  playSentence(i: number): void;
  /** Repeat a sentence (default: the current one), or stop if it already repeats. */
  toggleSentenceLoop(i?: number): void;
  /** `[` / `]`: previous / next sentence, keeping a sentence loop going. */
  stepSentence(direction: 1 | -1): void;

  /** Latest transcription update (for whichever track is being transcribed). */
  job: TranscribeStatus | null;
  /** Transcribes the current track with the service chosen in settings. */
  startTranscribe(language: string): Promise<void>;
  cancelTranscribe(): void;
  /** Forget a finished, failed or cancelled job. */
  dismissJob(): void;
  /** After a reload mid-job: pick the running job back up. */
  restoreJob(): Promise<void>;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export function createTranscriptSlice(
  set: Set,
  get: Get,
  engine: AudioEngine,
  applyLoop: (loop: Loop, sentence?: number | null) => void,
): TranscriptState {
  const sentences = () => get().transcript?.sentences ?? [];

  /** Ignore results that arrive after the user moved to another track. */
  const forCurrent = (path: string, transcript: Transcript | null) => {
    if (get().current?.path === path) set({ transcript, loopSentence: null });
  };

  void listen<TranscribeStatus>("transcribe:status", ({ payload }) => {
    set({ job: payload });
    if (payload.state === "done") forCurrent(payload.path, payload.transcript);
  });

  function startAt(i: number) {
    get().seek(sentenceStart(sentences()[i]));
    if (engine.paused) engine.play();
  }

  function loopSentenceAt(i: number) {
    applyLoop(sentenceLoop(sentences()[i], engine.duration), i);
    startAt(i);
  }

  return {
    transcript: null,
    loopSentence: null,
    job: null,

    async startTranscribe(language) {
      const path = get().current?.path;
      if (!path) return;
      get().setTranscribeLanguage(language);
      set({ job: { state: "running", path, done: 0, total: get().duration } });
      try {
        await api.transcribe.start(path, language);
      } catch (e) {
        set({ job: { state: "failed", path, message: String(e) } });
      }
    },

    cancelTranscribe() {
      void api.transcribe.cancel();
    },

    dismissJob() {
      if (get().job?.state !== "running") set({ job: null });
    },

    async restoreJob() {
      const path = await api.transcribe.running().catch(() => null);
      if (path) set({ job: { state: "running", path, done: 0, total: 0 } });
    },

    async loadTranscript(path) {
      forCurrent(path, await api.getTranscript(path).catch(() => null));
    },

    async importTranscript() {
      const path = get().current?.path;
      if (!path) return;
      try {
        const transcript = await api.importTranscript(path);
        if (transcript) forCurrent(path, transcript);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    async removeTranscript() {
      const path = get().current?.path;
      if (!path) return;
      try {
        forCurrent(path, await api.removeTranscript(path));
      } catch (e) {
        set({ error: String(e) });
      }
    },

    playSentence(i) {
      if (!sentences()[i]) return;
      const { loop } = get();
      if (isLoopActive(loop)) return loopSentenceAt(i);
      if (loop.a !== null) applyLoop(NO_LOOP); // half-set A–B: drop it
      startAt(i);
    },

    toggleSentenceLoop(i) {
      const list = sentences();
      const index = i ?? Math.max(0, sentenceIndexAt(list, engine.time));
      if (!list[index]) return;
      if (get().loopSentence === index) applyLoop(NO_LOOP);
      else loopSentenceAt(index);
    },

    stepSentence(direction) {
      const list = sentences();
      const { loopSentence } = get();
      if (loopSentence !== null) {
        loopSentenceAt(Math.min(list.length - 1, Math.max(0, loopSentence + direction)));
        return;
      }
      const target = stepTarget(list, engine.time, direction);
      if (target >= 0) get().playSentence(target);
    },
  };
}
