// 从链接导入: which subtitles to bring along, how progress reads, and the
// downloads waiting or running in the track list (one runs at a time).
import type { PluginInfo, Resolved, Track } from "./api";
import { isEnglish, t } from "./i18n";

/** A link being downloaded, waiting its turn, or failed (shown in its folder's group). */
export interface Download {
  id: number;
  url: string;
  title: string;
  subtitles: string | null;
  /** Subfolder of the open folder, as typed ("" = the folder itself). */
  folder: string;
  /** `finishing`: in the folder, until the list shows it as a track. */
  state: "queued" | "downloading" | "finishing" | "failed";
  /** Progress note while downloading, the reason once failed. */
  message: string;
  done: number;
  total: number;
}

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

const names = new Map<string, Intl.DisplayNames>();

/** "ja" → "日语", "zh-Hant" → "繁体中文" (in the interface language); the site's own name when the code isn't known. */
export function languageName(lang: string, fallback: string): string {
  const ui = isEnglish() ? "en" : "zh-Hans";
  try {
    let of = names.get(ui);
    if (!of) names.set(ui, (of = new Intl.DisplayNames([ui], { type: "language", fallback: "none" })));
    return of.of(lang) ?? fallback;
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

/** What the installed plugins can import links from (“YouTube”, “Bilibili”). */
export function linkSites(plugins: PluginInfo[]): string[] {
  return [...new Set(plugins.filter((p) => !p.problem).flatMap((p) => p.importers))];
}

/**
 * The folder a download lands in, as the folder list will show it: the same
 * clean-up the Rust side does (plugins/accept.rs, `safe_name`).
 */
export function folderName(folder: string): string {
  const trimmed = folder.trim();
  if (!trimmed) return "";
  const name = trimmed
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "");
  return name || t("未命名");
}

/** The download to start now: the first waiting one, when none is running. */
export function nextDownload(downloads: Download[]): Download | null {
  if (downloads.some((d) => d.state === "downloading")) return null;
  return downloads.find((d) => d.state === "queued") ?? null;
}

/** The second line of a download's row. */
export function downloadLine(d: Download): string {
  if (d.state === "queued") return t("等前一个下载完");
  if (d.state === "failed") return d.message;
  if (d.state === "finishing") return t("已导入");
  return progressText(d.message || t("开始下载"), d.done, d.total);
}

export interface Group {
  dir: string;
  tracks: Track[];
  downloads: Download[];
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * Folder groups with each download in the group it lands in. A download into a
 * folder that doesn't exist yet gets its group now, where the list will put it.
 */
export function placeDownloads(groups: [string, Track[]][], downloads: Download[]): Group[] {
  const placed: Group[] = groups.map(([dir, tracks]) => ({ dir, tracks, downloads: [] }));
  for (const d of downloads) {
    const dir = folderName(d.folder);
    let group = placed.find((g) => g.dir === dir);
    if (!group) {
      group = { dir, tracks: [], downloads: [] };
      // The folder itself ("") comes first, subfolders in name order.
      const at = dir === "" ? 0 : placed.findIndex((g) => g.dir !== "" && byName(g.dir, dir) > 0);
      placed.splice(at < 0 ? placed.length : at, 0, group);
    }
    group.downloads.push(d);
  }
  return placed;
}
