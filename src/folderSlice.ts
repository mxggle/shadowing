// Switching between folders opened before (the folder name at the top of the sidebar,
// or ⌘O): pinned ones and the last few, each coming back to the track you were on.
// Rust keeps the list (src-tauri/src/folders.rs); lib/folders.ts has the rules.
import { api, type FolderEntry, type OpenedFolder } from "./lib/api";
import { others } from "./lib/folders";
import type { AppState } from "./store";

export interface FolderState {
  /** Folders to switch to: pinned, then the recent ones; the open one among them. */
  folders: FolderEntry[];
  switcherOpen: boolean;
  setSwitcherOpen(open: boolean): void;
  /** ⌘O: the switcher, or the native dialog when there is no other folder to switch to. */
  openSwitcher(): void;
  /**
   * Opens a folder from the list. `track`: the one to open there (null: none);
   * left out, the one you were on there last time. False when it couldn't open.
   */
  switchFolder(path: string, track?: string | null): Promise<boolean>;
  pinFolder(path: string, pinned: boolean): Promise<void>;
  forgetFolder(path: string): Promise<void>;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

/** Shows a folder just opened (shared with the native dialog's 打开文件夹). */
export type EnterFolder = (opened: OpenedFolder, track?: string | null) => void;

export function createFolderSlice(set: Set, get: Get, enterFolder: EnterFolder): FolderState {
  const keep = (folders: FolderEntry[]) => set({ folders });
  const fail = (e: unknown) => get().say(String(e), 5000);

  return {
    folders: [],
    switcherOpen: false,

    setSwitcherOpen(switcherOpen) {
      set({ switcherOpen });
      // A missing folder may be back (its drive plugged in) since the list was read.
      if (switcherOpen) void api.folders.list().then(keep, () => {});
    },

    openSwitcher() {
      const s = get();
      if (s.switcherOpen) return s.setSwitcherOpen(false);
      if (!s.folder || others(s.folders).length === 0) return void s.chooseFolder();
      // The switcher is at the top of the sidebar: show the sidebar first.
      if (!s.shelfOpen) s.toggleShelf();
      s.setSwitcherOpen(true);
    },

    async switchFolder(path, track) {
      set({ switcherOpen: false });
      if (get().folder?.root === path) return true;
      try {
        enterFolder(await api.folders.open(path), track);
        return true;
      } catch (e) {
        fail(e);
        void api.folders.list().then(keep, () => {});
        return false;
      }
    },

    async pinFolder(path, pinned) {
      await api.folders.pin(path, pinned).then(keep, fail);
    },

    async forgetFolder(path) {
      await api.folders.forget(path).then(keep, fail);
    },
  };
}
