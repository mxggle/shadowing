// "Explain this sentence" part of the single store: ask the explanation model
// about one sentence and show the answer under it. Answers are kept while the
// app runs, so closing and reopening a note doesn't ask (or pay) again.
import { api, type Explanation } from "./lib/api";
import { featureReady } from "./lib/aiReady";
import { movedIndex, type Change } from "./lib/reshape";
import { sentenceIndexAt } from "./lib/sentences";
import type { AppState } from "./store";

export type Explain = { open: boolean } & (
  | { state: "unset" }
  | { state: "running" }
  | { state: "done"; value: Explanation }
  | { state: "failed"; message: string }
);

/** One note per sentence of a track; the text is part of the key, so a corrected sentence is asked again. */
export const explainKey = (path: string, index: number, text: string) => `${path}\n${index}\n${text}`;

/**
 * A track's notes moved with their sentences after a cut or join. Those of the
 * sentences that changed wait at the first new one, unseen (their text no
 * longer matches), and show again if ⌘Z puts the sentence back.
 */
export function moveExplanations(explain: Record<string, Explain>, path: string, c: Change): Record<string, Explain> {
  const moved: Record<string, Explain> = {};
  for (const [key, entry] of Object.entries(explain)) {
    if (!key.startsWith(`${path}\n`)) {
      moved[key] = entry;
      continue;
    }
    const [index, ...text] = key.slice(path.length + 1).split("\n");
    moved[explainKey(path, movedIndex(Number(index), c) ?? c.at, text.join("\n"))] = entry;
  }
  return moved;
}

export interface ExplainState {
  explain: Record<string, Explain>;
  /** Opens or closes the note under a sentence (default: the current one); asks the model the first time. */
  toggleExplain(index?: number): void;
  retryExplain(index: number): void;
  /** Brings back the answers kept for a track (closed; what is already on screen stays). */
  loadExplanations(path: string): Promise<void>;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createExplainSlice(set: Set, get: Get): ExplainState {
  const put = (key: string, entry: Explain | null) =>
    set((s) => {
      const explain = { ...s.explain };
      if (entry) explain[key] = entry;
      else delete explain[key];
      return { explain };
    });

  async function ask(path: string, index: number, text: string) {
    const key = explainKey(path, index, text);
    if (!featureReady("chat", get().ai, get().local)) return put(key, { open: true, state: "unset" });
    put(key, { open: true, state: "running" });
    try {
      const value = await api.explainSentence(path, index, text);
      // Closed while waiting: keep the answer for later, but don't pop it open again.
      put(key, { open: get().explain[key]?.open ?? false, state: "done", value });
    } catch (e) {
      if (get().explain[key]) put(key, { open: get().explain[key].open, state: "failed", message: String(e) });
    }
  }

  return {
    explain: {},

    toggleExplain(i) {
      const { current, transcript, time } = get();
      const index = i ?? get().loopSentence ?? Math.max(0, sentenceIndexAt(transcript?.sentences ?? [], time));
      const text = transcript?.sentences[index]?.text;
      if (!current || text === undefined) return;
      const key = explainKey(current.path, index, text);
      const entry = get().explain[key];
      if (entry?.open) {
        // Answers are worth keeping; an unset or failed ask is not.
        put(key, entry.state === "done" || entry.state === "running" ? { ...entry, open: false } : null);
      } else if (entry?.state === "done" || entry?.state === "running") {
        put(key, { ...entry, open: true });
      } else {
        void ask(current.path, index, text);
      }
    },

    async loadExplanations(path) {
      const kept = await api.savedExplanations(path).catch(() => []);
      set((s) => {
        const explain = { ...s.explain };
        for (const k of kept) {
          const key = explainKey(path, k.index, k.text);
          explain[key] ??= { open: false, state: "done", value: k.explanation };
        }
        return { explain };
      });
    },

    retryExplain(index) {
      const { current, transcript } = get();
      const text = transcript?.sentences[index]?.text;
      if (current && text !== undefined) void ask(current.path, index, text);
    },
  };
}
