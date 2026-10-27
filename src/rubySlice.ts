// 注音 part of the single store: readings over the words of the sentences, from
// the plugin that reads the transcript's language (lib/ruby.ts). Kept by text
// while the app runs, so an edited sentence is the only one asked again.
import { api, type RubyPiece } from "./lib/api";
import { rubyKey, transcriptLanguage, unread } from "./lib/ruby";
import type { AppState } from "./store";

export interface RubyState {
  /** Readings by sentence text, given by the plugin and settings in `key` ("" = none). */
  ruby: { key: string; byText: Record<string, RubyPiece[]> };
  /** Asks the plugin for the sentences of the open transcript it hasn't read yet. */
  loadRuby(): Promise<void>;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createRubySlice(set: Set, get: Get): RubyState {
  let running = false;
  let again = false;
  return {
    ruby: { key: "", byText: {} },

    async loadRuby() {
      if (running) {
        again = true;
        return;
      }
      const { transcript, plugins, settings, ruby } = get();
      const texts = transcript?.sentences.map((s) => s.text) ?? [];
      const key = settings.ruby ? rubyKey(plugins, transcriptLanguage(texts)) : "";
      const byText = key === ruby.key ? ruby.byText : {};
      if (key !== ruby.key) set({ ruby: { key, byText } });
      const ask = key ? unread(texts, byText) : [];
      if (!ask.length) return;
      running = true;
      try {
        const read = await api.plugins.readings(key.split("\n")[0], ask);
        if (read && get().ruby.key === key) {
          const more = Object.fromEntries(ask.map((t, i) => [t, read[i]]));
          set((s) => ({ ruby: { key, byText: { ...s.ruby.byText, ...more } } }));
        }
      } catch (e) {
        // Shown without readings; asked again when the transcript or the plugin changes.
        console.warn("readings", e);
      } finally {
        running = false;
      }
      if (again) {
        again = false;
        void get().loadRuby();
      }
    },
  };
}
