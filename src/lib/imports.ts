// 从链接导入: which subtitles to bring along, and how progress reads.
import type { Resolved } from "./api";

const base = (lang: string) => lang.toLowerCase().split("-")[0];

/**
 * The subtitles to tick by default: in the language spoken (or, when the site
 * doesn't say, the one being learned). Never a translation: English subtitles on
 * a Japanese video don't line up with what is said.
 */
export function pickSubtitle(subtitles: Resolved["subtitles"], spoken: string | null, learning: string): string | null {
  const want = spoken || (learning && learning !== "other" ? learning : null);
  if (!want) return null;
  const exact = subtitles.find((s) => s.lang.toLowerCase() === want.toLowerCase());
  return (exact ?? subtitles.find((s) => base(s.lang) === base(want)))?.lang ?? null;
}

let names: Intl.DisplayNames | null = null;

/** "ja" → "日语", "zh-Hant" → "繁体中文"; the site's own name when the code isn't known. */
export function languageName(lang: string, fallback: string): string {
  try {
    names ??= new Intl.DisplayNames(["zh-Hans"], { type: "language", fallback: "none" });
    return names.of(lang) ?? fallback;
  } catch {
    return fallback;
  }
}

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);

/** Percent done, or null while the size isn't known. */
export function percent(done: number, total: number): number | null {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
}

/** "下载音频 3.2 / 10.8 MB"; just the message while nothing is counted. */
export function progressText(message: string, done: number, total: number): string {
  if (total > 0) return `${message} ${mb(done)} / ${mb(total)} MB`;
  if (done > 0) return `${message} ${mb(done)} MB`;
  return message;
}
