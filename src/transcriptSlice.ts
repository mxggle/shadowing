// Transcript part of the single store: loading/importing a track's sentences,
// playing or looping them through the same A–B loop the L key uses, and
// correcting their text (one sentence, or find and replace across all).
import { listen } from "@tauri-apps/api/event";
import { isLoopActive, NO_LOOP, type Loop } from "./audio/logic";
import type { AudioEngine } from "./audio/engine";
import { api, type SentenceEdit, type TranscribeStatus, type Transcript } from "./lib/api";
import { changedWord, matchingSentences, replaceEdits } from "./lib/edits";
import { sentenceIndexAt, sentenceLoop, sentenceStart, stepTarget } from "./lib/sentences";
import type { AppState } from "./store";

/** A sentence being corrected, with what has been typed so far. */
export interface Draft {
  path: string;
  index: number;
  original: string;
  text: string;
}

/** The find-and-replace bar over the sentence list. */
export interface ReplaceBar {
  find: string;
  with: string;
  /** Opened by a correction whose old word is also in other sentences. */
  suggested: boolean;
  /** Sentences changed by the last "replace all", until the fields change. */
  replaced: number | null;
  /** Bumped to put the cursor in the find field. */
  focus: number;
}

export interface TranscriptState {
  transcript: Transcript | null;
  /** Index of the sentence being repeated, when the loop came from the transcript. */
  loopSentence: number | null;
  editing: Draft | null;
  replace: ReplaceBar | null;
  /** Earlier text of corrected sentences, newest last, for ⌘Z. */
  undo: SentenceEdit[][];

  loadTranscript(path: string): Promise<void>;
  importTranscript(): Promise<void>;
  removeTranscript(): Promise<void>;
  /** Play from a sentence; an active loop moves to it. */
  playSentence(i: number): void;
  /** Repeat a sentence (default: the current one), or stop if it already repeats. */
  toggleSentenceLoop(i?: number): void;
  /** `[` / `]`: previous / next sentence, keeping a sentence loop going. */
  stepSentence(direction: 1 | -1): void;

  /** Correct a sentence's text (default: the current one); one already open is saved first. */
  editSentence(i?: number): void;
  setDraft(text: string): void;
  cancelEdit(): void;
  /** Saves the open correction; if the old word is also in other sentences, offers to replace it there. */
  saveEdit(): Promise<void>;
  /** Opens the replace bar, looking for `find` (default: what it had). */
  openReplace(find?: string): void;
  setReplace(fields: { find?: string; with?: string }): void;
  closeReplace(): void;
  replaceAll(): Promise<void>;
  /** Puts back the text from before the last correction or replacement. */
  undoEdit(): Promise<void>;

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

/** How many corrections ⌘Z can take back. */
const UNDO_LIMIT = 50;

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
    if (get().current?.path !== path) return;
    // A correction left open on the track you moved away from is kept there.
    const open = get().editing;
    if (open && open.path !== path) void saveQuietly(open);
    set({ transcript, loopSentence: null, editing: null, replace: null, undo: [] });
  };

  /** Saves a draft for a track that is no longer shown: no undo, no suggestion. */
  async function saveQuietly(draft: Draft) {
    const text = draft.text.trim();
    if (!text || text === draft.original) return;
    await api.editTranscript(draft.path, [{ index: draft.index, text }]).catch((e) => set({ error: String(e) }));
  }

  /**
   * Applies edits straight away, then saves them; puts the text back if saving fails.
   * Returns the edits that would undo them, or null when nothing was saved (or
   * you've moved to another track meanwhile, so there's nothing here to undo).
   */
  async function commit(edits: SentenceEdit[]): Promise<SentenceEdit[] | null> {
    const path = get().current?.path;
    const before = get().transcript;
    if (!path || !before || !edits.length) return null;
    const previous = edits.map(({ index }) => ({ index, text: before.sentences[index].text }));
    const texts = new Map(edits.map((e) => [e.index, e.text.trim()]));
    set({ transcript: { ...before, sentences: before.sentences.map((s, i) => (texts.has(i) ? { ...s, text: texts.get(i)! } : s)) } });
    try {
      const transcript = await api.editTranscript(path, edits);
      if (get().current?.path !== path) return null;
      set({ transcript });
      return previous;
    } catch (e) {
      if (get().current?.path === path) set({ transcript: before, error: String(e) });
      return null;
    }
  }

  const remember = (previous: SentenceEdit[] | null) => {
    if (previous) set({ undo: [...get().undo, previous].slice(-UNDO_LIMIT) });
  };

  void listen<TranscribeStatus>("transcribe:status", ({ payload }) => {
    set({ job: payload });
    if (payload.state === "done" && payload.saved) forCurrent(payload.path, payload.transcript);
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
    editing: null,
    replace: null,
    undo: [],
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

    editSentence(i) {
      const path = get().current?.path;
      const index = i ?? get().loopSentence ?? Math.max(0, sentenceIndexAt(sentences(), engine.time));
      const original = sentences()[index]?.text;
      if (!path || original === undefined || get().editing?.index === index) return;
      if (get().editing) void get().saveEdit();
      set({ editing: { path, index, original, text: original } });
    },

    setDraft(text) {
      const open = get().editing;
      if (open) set({ editing: { ...open, text } });
    },

    cancelEdit() {
      set({ editing: null });
    },

    async saveEdit() {
      const open = get().editing;
      if (!open) return;
      set({ editing: null });
      if (open.path !== get().current?.path) return saveQuietly(open);
      const text = open.text.trim();
      if (!text || text === open.original) return;
      const previous = await commit([{ index: open.index, text }]);
      remember(previous);
      const after = sentences()[open.index]?.text;
      const change = previous && after !== undefined ? changedWord(open.original, after) : null;
      // Leave the bar alone if you're already replacing something.
      if (change && !get().replace && matchingSentences(sentences(), change.from).length) {
        set({ replace: { find: change.from, with: change.to, suggested: true, replaced: null, focus: 0 } });
      }
    },

    openReplace(find) {
      const bar = get().replace;
      set({
        replace: {
          find: find ?? bar?.find ?? "",
          with: bar?.with ?? "",
          suggested: false,
          replaced: null,
          focus: (bar?.focus ?? 0) + 1,
        },
      });
    },

    setReplace(fields) {
      const bar = get().replace;
      if (bar) set({ replace: { ...bar, ...fields, suggested: false, replaced: null } });
    },

    closeReplace() {
      set({ replace: null });
    },

    async replaceAll() {
      // The open correction first, so the replacement doesn't land under it.
      if (get().editing) await get().saveEdit();
      const bar = get().replace;
      if (!bar?.find) return;
      const edits = replaceEdits(sentences(), bar.find, bar.with);
      const previous = await commit(edits);
      remember(previous);
      const now = get().replace;
      if (previous && now) set({ replace: { ...now, replaced: edits.length } });
    },

    async undoEdit() {
      const { undo, current } = get();
      const last = undo[undo.length - 1];
      if (!last) return;
      set({ undo: undo.slice(0, -1) });
      const restored = await commit(last);
      if (!restored && get().current === current) set({ undo }); // not saved: keep it to try again
      // A sentence open for correction whose text was just put back starts over.
      const open = get().editing;
      if (restored && open && last.some((e) => e.index === open.index)) set({ editing: null });
      const bar = get().replace;
      if (restored && bar && bar.replaced !== null) set({ replace: { ...bar, replaced: null } });
    },
  };
}
