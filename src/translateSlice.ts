// 译文 part of the single store: the translations of the open track's sentences, and asking the
// explanation model for the missing ones a batch at a time (hooks/useTranslations.ts starts it
// whenever the track, its sentences or the language change). Rules in lib/translation.ts.
import { api, type Settings } from "./lib/api";
import { featureReady } from "./lib/aiReady";
import { t } from "./lib/i18n";
import { batches, nextTranslationMode, targetLanguage, untranslated, type TranslationMode } from "./lib/translation";
import type { AppState } from "./store";

export type TranslateStatus =
  | { state: "idle" }
  /** Translating: `done` of `total` sentences so far. */
  | { state: "running"; done: number; total: number }
  | { state: "failed"; message: string }
  /** Some sentences have none, and no model is set up for explanations to make them. */
  | { state: "unset" };

export interface TranslateState {
  /** For which track and language (`${path}\n${lang}`); sentence text → translation ("" = already in that language). */
  translations: { key: string; byText: Record<string, string>; status: TranslateStatus };
  /** Brings back the kept translations of the open track, then translates what is missing (while they're on). */
  loadTranslations(): Promise<void>;
  setTranslation(mode: TranslationMode): void;
  /** T: 显示 → 模糊 → 不显示. */
  cycleTranslation(): void;
  setTranslateTo(code: string): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createTranslateSlice(set: Set, get: Get, persistSettings: (patch: Partial<Settings>) => void): TranslateState {
  // Bumped by every load: answers for another track, language or set of sentences are dropped.
  let generation = 0;
  const status = (key: string, status: TranslateStatus) =>
    set((s) => ({ translations: { ...s.translations, key, byText: s.translations.key === key ? s.translations.byText : {}, status } }));

  return {
    translations: { key: "", byText: {}, status: { state: "idle" } },

    async loadTranslations() {
      const mine = ++generation;
      const { current, transcript, settings, lang } = get();
      if (!current || !transcript) return status("", { state: "idle" });
      const target = targetLanguage(settings.translateTo, lang);
      const key = `${current.path}\n${target}`;
      if (settings.translation === "off") return status(key, { state: "idle" });
      const kept = await api.savedTranslations(current.path, target).catch(() => ({}));
      if (mine !== generation) return;
      set({ translations: { key, byText: kept, status: { state: "idle" } } });
      const todo = untranslated(transcript.sentences, transcript.translations, kept);
      if (!todo.length) return;
      if (!featureReady("chat", get().ai, get().local)) return status(key, { state: "unset" });
      let done = 0;
      try {
        let byText = kept;
        for (const batch of batches(todo)) {
          status(key, { state: "running", done, total: todo.length });
          byText = await api.translateSentences(current.path, target, batch);
          if (mine !== generation) return;
          done += batch.length;
          set({ translations: { key, byText, status: { state: "running", done, total: todo.length } } });
        }
        // The model may leave a line out: say so, with 再试一次 asking only for those.
        const left = untranslated(transcript.sentences, transcript.translations, byText).length;
        status(key, left ? { state: "failed", message: t("有 {n} 句 AI 没给出译文", { n: left }) } : { state: "idle" });
      } catch (e) {
        if (mine === generation) status(key, { state: "failed", message: String(e) });
      }
    },

    setTranslation(translation) {
      persistSettings({ translation });
    },

    cycleTranslation() {
      get().setTranslation(nextTranslationMode(get().settings.translation));
    },

    setTranslateTo(translateTo) {
      persistSettings({ translateTo });
    },
  };
}
