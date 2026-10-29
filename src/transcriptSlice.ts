// Transcript part of the single store: loading/importing a track's sentences,
// playing or looping them (or a whole section) through the same A–B loop the
// L key uses, and splitting, merging and naming sections.
// Correcting their text is in correctSlice.ts.
import { listen } from "@tauri-apps/api/event";
import { isLoopActive, NO_LOOP, type Loop } from "./audio/logic";
import type { AudioEngine } from "./audio/engine";
import { api, type Section, type TranscribeStatus, type Transcript } from "./lib/api";
import { mergeUp, rename, sectionIndexOf, sectionLoop, sectionsOf, sectionStep, splitAt } from "./lib/sections";
import { sentenceIndexAt, sentenceLoop, sentenceStart, stepTarget } from "./lib/sentences";
import type { AppState } from "./store";
import { micOpen } from "./recordSlice";

/** What an A–B loop repeats, when it came from the transcript. */
export interface LoopFrom {
  sentence?: number | null;
  section?: number | null;
}

export interface TranscriptState {
  transcript: Transcript | null;
  /** Index of the sentence being repeated, when the loop came from the transcript. */
  loopSentence: number | null;
  /** Index of the section being repeated, when the loop came from a section heading. */
  loopSection: number | null;

  loadTranscript(path: string): Promise<void>;
  importTranscript(): Promise<void>;
  removeTranscript(): Promise<void>;
  /** Play from a sentence; an active loop moves to it. */
  playSentence(i: number): void;
  /** Repeat a sentence (default: the current one), or stop if it already repeats. */
  toggleSentenceLoop(i?: number): void;
  /** `[` / `]`: previous / next sentence, keeping a sentence loop going. */
  stepSentence(direction: 1 | -1): void;

  /** Play from a section's first sentence; an active loop moves to it. */
  playSection(k: number): void;
  /** Repeat a whole section (default: the current one), or stop if it already repeats. */
  toggleSectionLoop(k?: number): void;
  /** `{` / `}`: previous / next section, keeping a section or sentence loop going. */
  stepSection(direction: 1 | -1): void;
  /** Start a new section at sentence `i`. */
  splitSection(i: number): void;
  /** Fold section `k` into the one before it. */
  mergeSection(k: number): void;
  renameSection(k: number, title: string): void;

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
  applyLoop: (loop: Loop, from?: LoopFrom) => void,
): TranscriptState {
  const sentences = () => get().transcript?.sentences ?? [];
  const sections = () => sectionsOf(get().transcript);

  /** Ignore results that arrive after the user moved to another track. */
  const forCurrent = (path: string, transcript: Transcript | null) => {
    if (get().current?.path !== path) return;
    get().forgetCorrections(path);
    set({ transcript, loopSentence: null, loopSection: null });
    // Already playing (it opened before its sentences came): 跟读停顿 starts with this sentence.
    get().paceRearm();
  };

  void listen<TranscribeStatus>("transcribe:status", ({ payload }) => {
    set({ job: payload });
    if (payload.state === "done" && payload.saved) forCurrent(payload.path, payload.transcript);
  });

  function startAt(i: number) {
    get().playFrom(sentenceStart(sentences()[i]));
  }

  function loopSentenceAt(i: number) {
    applyLoop(sentenceLoop(sentences()[i], engine.duration), { sentence: i });
    startAt(i);
  }

  function loopSectionAt(k: number) {
    const loop = sectionLoop(sentences(), sections(), k, engine.duration);
    if (!loop) return;
    applyLoop(loop, { section: k });
    startAt(sections()[k].start);
  }

  /** Shows new sections at once, then saves them (going back if that fails). */
  async function saveSections(next: Section[]) {
    const { transcript, current, loopSection } = get();
    if (!transcript || !current || next === sections()) return;
    // A repeating section that changed shape keeps its loop, as a plain A–B one.
    const reshaped = next.length !== sections().length || next.some((x, k) => x.start !== sections()[k].start);
    if (loopSection !== null && reshaped) set({ loopSection: null });
    set({ transcript: { ...transcript, sections: next } });
    try {
      const saved = await api.setSections(current.path, next);
      // A later change may already be on screen; its own save brings the final word.
      if (get().transcript?.sections === next) set({ transcript: saved });
    } catch (e) {
      if (get().transcript?.sections === next) set({ transcript, error: String(e) });
    }
  }

  return {
    transcript: null,
    loopSentence: null,
    loopSection: null,
    job: null,

    async startTranscribe(language) {
      const path = get().current?.path;
      if (!path) return;
      get().setTranscribeLanguage(language);
      set({ job: { state: "running", path, step: "transcribe", done: 0, total: get().duration } });
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
      if (path) set({ job: { state: "running", path, step: "transcribe", done: 0, total: 0 } });
    },

    async loadTranscript(path) {
      const transcript = await api.getTranscript(path).catch(() => null);
      forCurrent(path, transcript);
      if (transcript) void get().loadExplanations(path);
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
      if (micOpen(get())) return;
      if (!sentences()[i]) return;
      const { loop } = get();
      if (isLoopActive(loop)) return loopSentenceAt(i);
      if (loop.a !== null) applyLoop(NO_LOOP); // half-set A–B: drop it
      startAt(i);
    },

    toggleSentenceLoop(i) {
      if (micOpen(get())) return;
      const list = sentences();
      const index = i ?? Math.max(0, sentenceIndexAt(list, engine.time));
      if (!list[index]) return;
      if (get().loopSentence === index) applyLoop(NO_LOOP);
      else loopSentenceAt(index);
    },

    stepSentence(direction) {
      if (micOpen(get())) return;
      const list = sentences();
      const { loopSentence } = get();
      if (loopSentence !== null) {
        loopSentenceAt(Math.min(list.length - 1, Math.max(0, loopSentence + direction)));
        return;
      }
      const target = stepTarget(list, engine.time, direction);
      if (target >= 0) get().playSentence(target);
    },

    playSection(k) {
      if (micOpen(get())) return;
      const first = sections()[k]?.start;
      if (first === undefined || !sentences()[first]) return;
      const { loop } = get();
      if (isLoopActive(loop)) return loopSectionAt(k);
      if (loop.a !== null) applyLoop(NO_LOOP);
      startAt(first);
    },

    toggleSectionLoop(k) {
      if (micOpen(get())) return;
      const index = k ?? sectionIndexOf(sections(), sentenceIndexAt(sentences(), engine.time));
      if (get().loopSection === index) applyLoop(NO_LOOP);
      else loopSectionAt(index);
    },

    stepSection(direction) {
      if (micOpen(get())) return;
      const list = sections();
      const { loopSection, loopSentence } = get();
      if (loopSection !== null) {
        loopSectionAt(Math.min(list.length - 1, Math.max(0, loopSection + direction)));
        return;
      }
      const active = loopSentence ?? sentenceIndexAt(sentences(), engine.time);
      const target = sectionStep(list, active, direction);
      if (loopSentence !== null) loopSentenceAt(list[target].start);
      else get().playSection(target);
    },

    splitSection(i) {
      void saveSections(splitAt(sections(), i));
    },

    mergeSection(k) {
      void saveSections(mergeUp(sections(), k));
    },

    renameSection(k, title) {
      const next = rename(sections(), k, title);
      if ((next[k]?.title ?? "") !== (sections()[k]?.title ?? "")) void saveSections(next);
    },
  };
}
