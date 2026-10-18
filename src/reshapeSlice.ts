// Changing where sentences begin and end, part of the single store: cut one
// in two where the cursor is (⇧↩ while correcting it), join one with the next
// (or, ⌫ at its start, with the one before), and undo either (⌘Z). Rust makes
// the change (src-tauri/src/reshape.rs); this keeps what hangs on a
// sentence's place in the list in step: explanations, the recorder card, the
// repeating sentence, AI suggestions and the sentence being corrected.
import type { AudioEngine } from "./audio/engine";
import type { Loop } from "./audio/logic";
import { moveExplanations } from "./explainSlice";
import { api, type Transcript } from "./lib/api";
import { t } from "./lib/i18n";
import { caretInClean, cleanText, cutText, moveSuggestions, movedIndex, restoredSections, undoChange, undoOf, type Change, type Undo } from "./lib/reshape";
import { sectionsOf } from "./lib/sections";
import { sentenceIndexAt, sentenceLoop } from "./lib/sentences";
import type { AppState } from "./store";
import type { LoopFrom } from "./transcriptSlice";

/** What a cut or join replaced, for ⌘Z. */
export interface Shape extends Undo {
  /** Where the correction was, to go back to if it's still open when this is undone. */
  draft?: { index: number; caret: number };
}

export interface ReshapeState {
  /** Joins sentence `i` with the one after it. */
  mergeSentence(i: number): Promise<void>;
  /** ⇧↩ in the open correction: what's typed is saved, then the sentence is cut at `caret`; you go on correcting the second part. */
  splitDraft(caret: number): Promise<void>;
  /** ⌫ at the start (−1) or ⌦ at the end (+1) of the open correction: joins it with the sentence before or after. */
  mergeDraft(direction: -1 | 1): Promise<void>;
  /** Puts back what a cut or join replaced (⌘Z); false when that couldn't be saved. */
  restoreShape(shape: Shape): Promise<boolean>;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export function createReshapeSlice(set: Set, get: Get, engine: AudioEngine, applyLoop: (loop: Loop, from?: LoopFrom) => void): ReshapeState {
  const sentences = () => get().transcript?.sentences ?? [];
  /** One change at a time: a second ⇧↩ before the first is back would cut the wrong sentence. */
  let busy = false;

  /**
   * Runs one change, unless another is under way, you're recording (a take is
   * of one sentence) or AI proofreading is reading the sentences as they were.
   */
  async function alone<T>(nothing: T, run: () => Promise<T>): Promise<T> {
    const s = get();
    if (busy || s.rec || s.live || !s.current || !s.transcript) return nothing;
    if (s.proofread?.state === "running") {
      set({ error: t("AI 校对还在进行，完成后再拆分或合并句子") });
      return nothing;
    }
    busy = true;
    try {
      return await run();
    } finally {
      busy = false;
    }
  }

  /** The open correction saved as it is typed, if it changed; false when that failed. */
  async function saveDraft(): Promise<boolean> {
    const open = get().editing;
    if (!open) return true;
    const text = cleanText(open.text);
    if (!text) return false;
    if (text === sentences()[open.index]?.text) return true;
    return get().applyEdits([{ index: open.index, text, unsure: [] }]);
  }

  /** The new transcript, and everything held by sentence index moved along with `c`. */
  function follow(next: Transcript, c: Change) {
    const s = get();
    const path = s.current!.path;
    const patch: Partial<AppState> = { transcript: next, explain: moveExplanations(s.explain, path, c) };
    if (typeof s.recordAt === "number") patch.recordAt = movedIndex(s.recordAt, c) ?? c.at;
    if (s.proofread?.state === "done") {
      const suggestions = moveSuggestions(s.proofread.suggestions, c);
      patch.proofread = suggestions.length ? { ...s.proofread, suggestions } : null;
    }
    if (s.editing) {
      const index = movedIndex(s.editing.index, c);
      patch.editing = index === null ? null : { ...s.editing, index };
    }
    if (sectionsOf(next).length !== sectionsOf(s.transcript).length) patch.loopSection = null;
    if (s.loopSentence !== null) {
      const moved = movedIndex(s.loopSentence, c);
      if (moved !== null) patch.loopSentence = moved;
    }
    set(patch);
    // The sentence repeating was cut or joined: repeat the new one the playhead is in.
    if (s.loopSentence !== null && movedIndex(s.loopSentence, c) === null) {
      const here = sentenceIndexAt(next.sentences, engine.time);
      const k = Math.min(c.at + c.added - 1, Math.max(c.at, here));
      const loop = sentenceLoop(next.sentences[k], engine.duration);
      applyLoop(loop, { sentence: k });
      if (engine.time < loop.a! || engine.time > loop.b!) get().seek(loop.a!);
    }
  }

  /** Makes change `c` with `call`, follows it, and remembers `undo` for ⌘Z; false when nothing changed. */
  async function reshape(c: Change, call: (path: string) => Promise<Transcript>, undo: Shape | null): Promise<boolean> {
    const path = get().current!.path;
    try {
      const next = await call(path);
      if (get().current?.path !== path) return false;
      follow(next, c);
      if (undo) get().rememberUndo({ shape: undo });
      return true;
    } catch (e) {
      if (get().current?.path === path) set({ error: String(e) });
      return false;
    }
  }

  /** Joins sentences `i` and `i + 1`; `draft` is where the correction was, if one was open. */
  function merge(i: number, draft?: Shape["draft"]) {
    const list = sentences();
    if (!list[i] || !list[i + 1]) return Promise.resolve(false);
    const c: Change = { at: i, removed: 2, added: 1 };
    return reshape(c, (path) => api.mergeSentences(path, i), { ...undoOf(list, sectionsOf(get().transcript), c), draft });
  }

  return {
    mergeSentence(i) {
      return alone(undefined, async () => {
        if (get().editing) await get().saveEdit();
        await merge(i);
      });
    },

    splitDraft(caret) {
      return alone(undefined, async () => {
        const open = get().editing;
        if (!open || open.path !== get().current?.path) return;
        const at = caretInClean(open.text, caret);
        if (!cutText(cleanText(open.text), at) || !(await saveDraft())) return;
        const { index } = open;
        const before = sentences()[index];
        if (!before || !cutText(before.text, at)) return;
        const c: Change = { at: index, removed: 1, added: 2 };
        const undo: Shape = { ...undoOf(sentences(), sectionsOf(get().transcript), c), draft: { index, caret: at } };
        if (!(await reshape(c, (path) => api.splitSentence(path, index, at), undo))) return;
        const second = sentences()[index + 1].text;
        set({ editing: { path: open.path, index: index + 1, original: second, text: second, caret: 0 } });
      });
    },

    mergeDraft(direction) {
      return alone(undefined, async () => {
        const open = get().editing;
        if (!open || open.path !== get().current?.path) return;
        const first = direction < 0 ? open.index - 1 : open.index;
        if (first < 0 || first + 1 >= sentences().length || !(await saveDraft())) return;
        const [a, b] = [sentences()[first].text, sentences()[first + 1].text];
        const draft = direction < 0 ? { index: first + 1, caret: 0 } : { index: first, caret: a.length };
        if (!(await merge(first, draft))) return;
        const text = sentences()[first].text;
        // The cursor stays where the two met.
        const caret = direction < 0 ? text.length - b.length : a.length;
        set({ editing: { path: open.path, index: first, original: text, text, caret } });
      });
    },

    restoreShape(shape) {
      return alone(false, async () => {
        const c = undoChange(shape);
        const open = get().editing;
        const reopen = open && open.index >= shape.at && open.index < shape.at + shape.count ? shape.draft : undefined;
        const sections = restoredSections(sectionsOf(get().transcript), c, shape.ended);
        const ok = await reshape(c, (path) => api.restoreSentences(path, shape.at, shape.count, shape.sentences, sections), null);
        // Undone while still correcting what it made: go on correcting where you were.
        const text = reopen && sentences()[reopen.index]?.text;
        if (ok && open && reopen && text !== undefined) set({ editing: { path: open.path, index: reopen.index, original: text, text, caret: reopen.caret } });
        return ok;
      });
    },
  };
}
