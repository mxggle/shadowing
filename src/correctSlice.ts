// Correcting part of the single store: editing one sentence's text, find and
// replace across all of them, and undo. Every change of text goes through
// `applyEdits`; cutting and joining sentences is in reshapeSlice.ts.
import { api, type SentenceEdit } from "./lib/api";
import { changedWord, matchingSentences, replaceEdits } from "./lib/edits";
import { sentenceIndexAt } from "./lib/sentences";
import type { Shape } from "./reshapeSlice";
import type { AppState } from "./store";

/** A sentence being corrected, with what has been typed so far. */
export interface Draft {
  path: string;
  index: number;
  original: string;
  text: string;
  /** Where the cursor starts (default: the end). */
  caret?: number;
}

/** One ⌘Z: earlier text of corrected sentences, or the sentences a cut or join replaced. */
export type UndoStep = { edits: SentenceEdit[] } | { shape: Shape };

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

export interface CorrectState {
  editing: Draft | null;
  replace: ReplaceBar | null;
  /** What ⌘Z takes back, newest last. */
  undo: UndoStep[];

  /** Correct a sentence's text (default: the current one); one already open is saved first. */
  editSentence(i?: number): void;
  setDraft(text: string): void;
  cancelEdit(): void;
  /**
   * Saves the open correction, which also clears the sentence's underlines (it has
   * been checked, even if left as it was). If the old word is also in other
   * sentences, offers to replace it there.
   */
  saveEdit(): Promise<void>;
  /** Opens the replace bar, looking for `find` (default: what it had). */
  openReplace(find?: string): void;
  setReplace(fields: { find?: string; with?: string }): void;
  closeReplace(): void;
  replaceAll(): Promise<void>;
  /** Takes back the last correction, replacement, cut or join. */
  undoEdit(): Promise<void>;
  /** Adds a step for ⌘Z to take back (only the latest are kept). */
  rememberUndo(step: UndoStep): void;
  /** Applies edits as one undo step; false when they couldn't be saved. */
  applyEdits(edits: SentenceEdit[]): Promise<boolean>;
  /** After a correction: offers to replace `from` in the sentences that still have it. */
  offerReplace(from: string, to: string): void;
  /**
   * The shown transcript is about to be replaced (another track, or a new one
   * for this track): a draft left on another track is saved there, and
   * corrections in progress are dropped.
   */
  forgetCorrections(path: string): void;
}

/** How many corrections ⌘Z can take back. */
const UNDO_LIMIT = 50;

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export function createCorrectSlice(set: Set, get: Get): CorrectState {
  const sentences = () => get().transcript?.sentences ?? [];

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
    const previous = edits.map(({ index }) => {
      const { text, unsure = [] } = before.sentences[index];
      return { index, text, unsure };
    });
    const changed = new Map(edits.map((e) => [e.index, e]));
    const sentences = before.sentences.map((s, i) => {
      const e = changed.get(i);
      return e ? { ...s, text: e.text.trim(), unsure: e.unsure?.length ? e.unsure : undefined } : s;
    });
    set({ transcript: { ...before, sentences } });
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

  return {
    editing: null,
    replace: null,
    undo: [],

    editSentence(i) {
      const path = get().current?.path;
      const index = i ?? get().loopSentence ?? Math.max(0, sentenceIndexAt(sentences(), get().time));
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
      const underlined = !!sentences()[open.index]?.unsure?.length;
      if (!text || (text === open.original && !underlined)) return;
      if (!(await get().applyEdits([{ index: open.index, text, unsure: [] }]))) return;
      const after = sentences()[open.index]?.text;
      const change = after === undefined ? null : changedWord(open.original, after);
      if (change) get().offerReplace(change.from, change.to);
    },

    async applyEdits(edits) {
      const previous = await commit(edits);
      if (previous) get().rememberUndo({ edits: previous });
      return !!previous;
    },

    rememberUndo(step) {
      set({ undo: [...get().undo, step].slice(-UNDO_LIMIT) });
    },

    offerReplace(from, to) {
      // Leave the bar alone if you're already replacing something.
      if (get().replace || !matchingSentences(sentences(), from).length) return;
      set({ replace: { find: from, with: to, suggested: true, replaced: null, focus: 0 } });
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
      const saved = await get().applyEdits(edits);
      const now = get().replace;
      if (saved && now) set({ replace: { ...now, replaced: edits.length } });
    },

    async undoEdit() {
      const { undo, current } = get();
      const last = undo[undo.length - 1];
      if (!last) return;
      set({ undo: undo.slice(0, -1) });
      const restored = "shape" in last ? await get().restoreShape(last.shape) : !!(await commit(last.edits));
      if (!restored && get().current === current) set({ undo }); // not saved: keep it to try again
      // A sentence open for correction whose text was just put back starts over.
      const open = get().editing;
      if (restored && open && "edits" in last && last.edits.some((e) => e.index === open.index)) set({ editing: null });
      const bar = get().replace;
      if (restored && bar && bar.replaced !== null) set({ replace: { ...bar, replaced: null } });
    },

    forgetCorrections(path) {
      const open = get().editing;
      if (open && open.path !== path) void saveQuietly(open);
      if (get().proofread?.state === "running") void api.proofread.cancel();
      set({ editing: null, replace: null, undo: [], proofread: null });
    },
  };
}
