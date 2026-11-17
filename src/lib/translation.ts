// 译文: a translation under each sentence, shown, blurred until you look (hover or click), or
// off. It comes from bilingual subtitles when they have one (src-tauri/src/bilingual.rs),
// otherwise the explanation model translates the track a batch at a time, into the language
// picked (the interface's by default). Unit-tested in translation.test.ts.
import type { Sentence, Transcript } from "./api";
import type { Lang } from "./i18n";

export type TranslationMode = "show" | "blur" | "off";
export const TRANSLATION_MODES: TranslationMode[] = ["show", "blur", "off"];

export const translationModeOf = (v: string): TranslationMode =>
  TRANSLATION_MODES.includes(v as TranslationMode) ? (v as TranslationMode) : "show";

/** The key (T): 显示 → 模糊 → 不显示 → 显示. */
export const nextTranslationMode = (v: string): TranslationMode => {
  const i = TRANSLATION_MODES.indexOf(translationModeOf(v));
  return TRANSLATION_MODES[(i + 1) % TRANSLATION_MODES.length];
};

/** The languages to translate into, each by its own name (same list as src-tauri/src/translate/mod.rs). */
export const TRANSLATE_LANGUAGES: { code: string; name: string }[] = [
  { code: "zh-Hans", name: "简体中文" }, // i18n: keep
  { code: "zh-Hant", name: "繁體中文" }, // i18n: keep
  { code: "en", name: "English" },
  { code: "ja", name: "日本語" }, // i18n: keep
  { code: "ko", name: "한국어" }, // i18n: keep
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
];

/** The language to translate into: the one picked, or the interface's ("" in the setting). */
export function targetLanguage(setting: string, ui: Lang): string {
  if (TRANSLATE_LANGUAGES.some((l) => l.code === setting)) return setting;
  return ui === "en" ? "en" : "zh-Hans";
}

/** The translation shown under a sentence: the subtitles' own first, then the model's; "" for none. */
export function translationOf(text: string, transcript: Pick<Transcript, "translations"> | null, byText: Record<string, string>): string {
  return transcript?.translations?.[text] ?? byText[text] ?? "";
}

/** Sentences that still need translating: neither the subtitles nor an earlier answer has them. */
export function untranslated(sentences: Sentence[], fromSubtitles: Record<string, string> | undefined, byText: Record<string, string>): number[] {
  const out: number[] = [];
  const seen = new Set<string>();
  sentences.forEach((s, i) => {
    if (fromSubtitles?.[s.text] !== undefined || byText[s.text] !== undefined || seen.has(s.text)) return;
    seen.add(s.text);
    out.push(i);
  });
  return out;
}

/** Most sentences one request translates (src-tauri/src/translate/mod.rs `BATCH`). */
export const BATCH = 30;

/** `indices` in batches of `size`, in order: the start of the track comes back first. */
export function batches(indices: number[], size = BATCH): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < indices.length; i += size) out.push(indices.slice(i, i + size));
  return out;
}

/** Whether a track's translations came with its subtitles (bilingual subtitles). */
export const fromSubtitles = (transcript: Pick<Transcript, "translations"> | null) => Object.keys(transcript?.translations ?? {}).length > 0;
