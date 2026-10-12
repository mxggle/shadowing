// Rules for showing an update: what the release notes say, how far the download is.

/** The top-level points of a release's CHANGELOG section, as plain text, at most `max`. */
export function noteLines(notes: string | null, max = 4): { lines: string[]; more: boolean } {
  const all = (notes ?? "")
    .split("\n")
    .filter((line) => /^[-*] /.test(line))
    .map((line) =>
      line
        .slice(2)
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .trim(),
    )
    .filter(Boolean);
  return { lines: all.slice(0, max), more: all.length > max };
}

/** Whole percent downloaded, or null when the size isn't known. */
export function percent(done: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.floor((done / total) * 100));
}
