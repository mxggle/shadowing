// Switching folders (the list itself is kept in Rust, src-tauri/src/folders.rs):
// how the switcher groups and focuses them, and which known folder holds a file.
import type { FolderEntry } from "./api";

/** Pinned ones (in the order pinned), then the recent ones (most recent first), as Rust lists them. */
export function switcherGroups(folders: FolderEntry[]): { pinned: FolderEntry[]; recent: FolderEntry[] } {
  return { pinned: folders.filter((f) => f.pinned), recent: folders.filter((f) => !f.pinned) };
}

/** Folders to switch to: any but the open one. */
export function others(folders: FolderEntry[]): FolderEntry[] {
  return folders.filter((f) => !f.current);
}

/**
 * Where the switcher's focus starts: the folder you were in before this one, so
 * ⌘O then ↩ goes back and forth between two folders.
 */
export function firstFocus(folders: FolderEntry[]): string | null {
  const ready = folders.filter((f) => !f.current && !f.missing);
  if (ready.length === 0) return null;
  return ready.reduce((a, b) => (b.recency < a.recency ? b : a)).path;
}

/** Whether `path` is `folder` or inside it, whole names only (`/a` doesn't hold `/ab`). */
export function holds(folder: string, path: string): boolean {
  const root = folder.replace(/[\\/]+$/, "");
  if (!path.startsWith(root)) return false;
  const next = path.charAt(root.length);
  return next === "/" || next === "\\";
}

/**
 * The known folder (not the open one, not missing) a file is in: to open a
 * 句子本 sentence whose audio is elsewhere. The deepest one when they nest.
 */
export function folderHolding(folders: FolderEntry[], path: string): FolderEntry | null {
  let best: FolderEntry | null = null;
  for (const f of folders) {
    if (f.current || f.missing || !holds(f.path, path)) continue;
    if (!best || f.path.length > best.path.length) best = f;
  }
  return best;
}
