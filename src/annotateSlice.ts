// 标注 part of the single store: marks plugins put on the sentences (readings
// over words, a line under…; lib/annotations.ts). Kept by text while the app
// runs, so an edited sentence is the only one asked again.
import { api, type Annotation } from "./lib/api";
import { annotationKey, unread } from "./lib/annotations";
import type { AppState } from "./store";

export interface AnnotateState {
  /** Marks by sentence text, from the plugins and settings in `key` ("" = none). */
  annotations: { key: string; byText: Record<string, Annotation> };
  /** Asks the plugins about the sentences of the open transcript they haven't seen yet. */
  loadAnnotations(): Promise<void>;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createAnnotateSlice(set: Set, get: Get): AnnotateState {
  let running = false;
  let again = false;
  return {
    annotations: { key: "", byText: {} },

    async loadAnnotations() {
      if (running) {
        again = true;
        return;
      }
      const { transcript, plugins, settings, annotations } = get();
      const texts = transcript?.sentences.map((s) => s.text) ?? [];
      const key = settings.annotations ? annotationKey(plugins) : "";
      const byText = key === annotations.key ? annotations.byText : {};
      if (key !== annotations.key) set({ annotations: { key, byText } });
      const ask = key ? unread(texts, byText) : [];
      if (!ask.length) return;
      running = true;
      try {
        const marks = await api.plugins.annotate(ask);
        if (get().annotations.key === key) {
          const more = Object.fromEntries(ask.map((t, i) => [t, marks[i] ?? {}]));
          set((s) => ({ annotations: { key, byText: { ...s.annotations.byText, ...more } } }));
        }
      } catch (e) {
        // Shown without marks; asked again when the transcript or the plugins change.
        console.warn("annotations", e);
      } finally {
        running = false;
      }
      if (again) {
        again = false;
        void get().loadAnnotations();
      }
    },
  };
}
