// Interface language. The Chinese text in the code is the key: t("设置") is "设置" in Chinese and
// whatever src/i18n/en.ts gives for it in English, falling back to the Chinese. Rust picks the
// language (settings, else the Mac's own; src-tauri/src/i18n.rs) and the store re-renders the app
// when it changes. Text is looked up when it's shown, so module-level labels stay Chinese keys.
import { en } from "../i18n/en";

export type Lang = "zh" | "en";
/** What the learner chose in settings: "" follows the Mac. */
export type LangSetting = "" | "zh" | "en";

type Vars = Record<string, string | number>;
/** An English entry: text with the same {name} slots as the key, or a function for plurals. */
export type Entry = string | ((vars: Vars) => string);

let lang: Lang = "zh";

export function setLang(next: Lang) {
  lang = next;
  if (typeof document !== "undefined") document.documentElement.lang = next === "en" ? "en" : "zh-Hans";
}

export const getLang = (): Lang => lang;
export const isEnglish = () => lang === "en";

/** The text in the interface language; {name} slots are filled from `vars`. */
export function t(zh: string, vars?: Vars): string {
  const entry = lang === "en" ? en[zh] : undefined;
  const text = entry === undefined ? zh : typeof entry === "function" ? entry(vars ?? {}) : entry;
  return vars ? fill(text, vars) : text;
}

/** Marks a Chinese label kept in a constant as a key; t() translates it where it's shown. */
export const tk = (zh: string) => zh;

export function fill(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (slot, name: string) => (name in vars ? String(vars[name]) : slot));
}

/** English plural for a count: plural(2, "take") is "2 takes". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Rust's "cancelled" error, in either language (the learner stopped it; nothing to show). */
export const isCancelled = (e: unknown) => /已取消|Cancelled/.test(String(e)); // i18n: keep (Rust's text in either language)
