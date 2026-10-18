// 新功能: the CHANGELOG.md bundled with the app, read into releases to show, and
// whether to say “已更新到 …” after an update.
import { lang } from "./i18n";

/** A run of a point's text: plain, **bold**, or a `key` (shown as a Kbd). */
export type Inline = { kind: "text" | "bold" | "key"; text: string };

export interface NoteItem {
  text: Inline[];
  children: NoteItem[];
}

export interface NoteGroup {
  /** 新增, 改进, 修复, 已知限制… */
  title: string;
  items: NoteItem[];
}

export interface Release {
  version: string;
  /** "2026-10-17". */
  date: string | null;
  groups: NoteGroup[];
}

/** The released versions, newest first (as the file has them); 未发布 and the link list are left out. */
export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let group: NoteGroup | null = null;
  let last: NoteItem | null = null;
  for (const line of md.split("\n")) {
    const heading = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (heading) {
      const released = /^\d+\.\d+\.\d+$/.test(heading[1]);
      release = released ? { version: heading[1], date: heading[2] ?? null, groups: [] } : null;
      if (release) releases.push(release);
      group = null;
      last = null;
      continue;
    }
    if (!release) continue;
    if (/^\[[^\]]+\]: /.test(line)) break; // the link list at the end
    const title = /^### (.+)/.exec(line);
    if (title) {
      group = { title: title[1].trim(), items: [] };
      release.groups.push(group);
      last = null;
      continue;
    }
    const point = /^( *)[-*] (.*)/.exec(line);
    if (point) {
      if (!group) {
        group = { title: "", items: [] };
        release.groups.push(group);
      }
      const item: NoteItem = { text: inline(point[2]), children: [] };
      const parent = point[1].length >= 2 ? group.items.at(-1) : undefined;
      (parent ? parent.children : group.items).push(item);
      last = item;
      continue;
    }
    // A wrapped line of the point above.
    if (last && /^ +\S/.test(line)) last.text.push(...inline(" " + line.trim()));
  }
  return releases;
}

/** **bold**, `keys` and [links](…) (their text only: the app doesn't leave the window). */
export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g;
  let at = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > at) out.push({ kind: "text", text: s.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "key", text: m[2] });
    else out.push({ kind: "text", text: m[3] });
    at = re.lastIndex;
  }
  if (at < s.length) out.push({ kind: "text", text: s.slice(at) });
  return out;
}

/** A point's name: its bold lead (“**自己断句、合并句子**：…”), else its whole text. */
export function headline(item: NoteItem): string {
  const [first] = item.text;
  if (first?.kind === "bold") return first.text;
  return item.text.map((t) => t.text).join("");
}

/** What a release brought, by name, for the card after an update (its known limits aren't news). */
export function highlights(release: Release): string[] {
  return release.groups.filter((g) => g.title !== "已知限制").flatMap((g) => g.items.map(headline));
}

/**
 * Everything new since the version last seen, up to this one, newest first: skipping a
 * version (0.7 → 0.8.1) still tells what the one in between brought.
 */
export function highlightsSince(releases: Release[], seen: string, current: string): string[] {
  return releases
    .filter((r) => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0)
    .flatMap(highlights);
}

/** "2026-10-17" → "10 月 17 日" (with the year when it isn't `thisYear`). */
export function dateLabel(date: string | null, thisYear = new Date().getFullYear()): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (lang() === "en") {
    const label = new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return y === thisYear ? label : `${label}, ${y}`;
  }
  const day = `${m} 月 ${d} 日`;
  return y === thisYear ? day : `${y} 年 ${day}`;
}

/** -1, 0 or 1; anything that isn't a version (an empty “seen”) is older than all. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (/^\d+(\.\d+)*$/.test(v) ? v.split(".").map(Number) : null);
  const x = parts(a);
  const y = parts(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/**
 * After an update, say what's new once: the learner has been here before (`welcomed`),
 * last saw an older version's notes, and this version has some.
 */
export function announces(current: string, seen: string, welcomed: boolean, releases: Release[]): boolean {
  if (!welcomed || compareVersions(current, seen) <= 0) return false;
  return releases.some((r) => r.version === current && r.groups.some((g) => g.items.length > 0));
}
