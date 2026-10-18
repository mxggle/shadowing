// AI proofreading part of the single store: ask the explanation model which
// words were misheard, then accept (an ordinary, undoable edit) or ignore each one.
import { listen } from "@tauri-apps/api/event";
import { api, type ProofreadProgress, type SentenceEdit, type Suggestion } from "./lib/api";
import { fixEdit, matchingSentences } from "./lib/edits";
import { isCancelled } from "./lib/i18n";
import type { AppState } from "./store";

export type Proofread = { path: string } & (
  | /** Says what will be sent where, before anything is. */ { state: "ready" }
  | { state: "running"; done: number; total: number }
  | { state: "done"; suggestions: Suggestion[] }
  | { state: "failed"; message: string }
);

export interface ProofreadState {
  proofread: Proofread | null;
  /** Shows the proofread bar (it asks before sending anything). */
  openProofread(): void;
  closeProofread(): void;
  startProofread(): Promise<void>;
  cancelProofread(): void;
  acceptSuggestion(s: Suggestion): Promise<void>;
  ignoreSuggestion(s: Suggestion): void;
  acceptAll(): Promise<void>;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export function createProofreadSlice(set: Set, get: Get): ProofreadState {
  const pending = () => {
    const p = get().proofread;
    return p?.state === "done" ? p.suggestions : [];
  };
  /** Leaves the other suggestions; the bar closes once none are left. */
  const without = (handled: (s: Suggestion) => boolean) => {
    const p = get().proofread;
    if (p?.state !== "done") return;
    const suggestions = p.suggestions.filter((s) => !handled(s));
    set({ proofread: suggestions.length ? { ...p, suggestions } : null });
  };

  void listen<ProofreadProgress>("proofread:progress", ({ payload }) => {
    const p = get().proofread;
    if (p?.state === "running" && p.path === payload.path) set({ proofread: { ...p, done: payload.done, total: payload.total } });
  });

  return {
    proofread: null,

    openProofread() {
      const path = get().current?.path;
      if (path && get().proofread?.state !== "running") set({ proofread: { path, state: "ready" } });
    },

    closeProofread() {
      if (get().proofread?.state === "running") void api.proofread.cancel();
      set({ proofread: null });
    },

    async startProofread() {
      const path = get().current?.path;
      if (!path) return;
      // The open correction first, so it's part of what is checked.
      if (get().editing) await get().saveEdit();
      set({ proofread: { path, state: "running", done: 0, total: 0 } });
      try {
        const suggestions = await api.proofread.start(path);
        if (get().proofread?.path === path) set({ proofread: { path, state: "done", suggestions } });
      } catch (e) {
        const cancelled = isCancelled(e);
        if (get().proofread?.path === path) set({ proofread: cancelled ? null : { path, state: "failed", message: String(e) } });
      }
    },

    cancelProofread() {
      void api.proofread.cancel();
    },

    async acceptSuggestion(s) {
      const sentence = get().transcript?.sentences[s.index];
      const edit = sentence ? fixEdit(sentence, s.index, s.from, s.to) : null;
      const others = pending().filter((o) => o !== s);
      without((o) => o === s);
      if (!edit || !(await get().applyEdits([edit]))) return;
      // The same word elsewhere, if the AI didn't already point it out there.
      const covered = new Set(others.filter((o) => o.from === s.from).map((o) => o.index));
      const rest = matchingSentences(get().transcript?.sentences ?? [], s.from).filter((i) => !covered.has(i));
      if (rest.length) get().offerReplace(s.from, s.to);
    },

    ignoreSuggestion(s) {
      without((o) => o === s);
    },

    async acceptAll() {
      const list = pending();
      const sentences = get().transcript?.sentences ?? [];
      // Several fixes in one sentence apply one after another, as one undo step.
      const edits = new Map<number, SentenceEdit>();
      for (const s of list) {
        const before = edits.get(s.index);
        const sentence = before ? { ...sentences[s.index], text: before.text, unsure: before.unsure } : sentences[s.index];
        const edit = sentence ? fixEdit(sentence, s.index, s.from, s.to) : null;
        if (edit) edits.set(s.index, edit);
      }
      without(() => true);
      await get().applyEdits([...edits.values()]);
    },
  };
}
