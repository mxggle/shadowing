/**
 * Interface language: Simplified Chinese or English. Copy stays in the components, both
 * wordings side by side: `t("设置", "Settings")`. The language is set once at start and
 * when settings change it; App re-renders the whole tree then (memo'd rows read `lang`
 * from the store too), so call `t` while rendering, never in a module-level constant.
 */

export type Lang = "zh" | "en";
/** What settings keep: a language, or "" to follow the Mac. */
export type LanguageChoice = "" | Lang;

/** Chinese until `setLang`, so tests read the Chinese wording. */
let current: Lang = "zh";

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang) {
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = next === "en" ? "en" : "zh-CN";
}

/** The wording for the language in use; works for strings and JSX alike. */
export function t<T>(zh: T, en: T): T {
  return current === "en" ? en : zh;
}

/** `settings.language` resolved against the Mac's language (from Rust, see src-tauri/src/i18n.rs). */
export function resolveLang(choice: string, system: string): Lang {
  if (choice === "zh" || choice === "en") return choice;
  return system === "en" ? "en" : "zh";
}

/** "1 sentence" / "3 sentences" in English, "3 句" in Chinese. */
export function count(n: number, zh: string, one: string, many = `${one}s`): string {
  return current === "en" ? `${n} ${n === 1 ? one : many}` : `${n} ${zh}`;
}

/** For Intl / toLocale*String. */
export function locale(): string {
  return current === "en" ? "en-US" : "zh-CN";
}
