// 素材库 part of the single store: the practice packs on the website and on this
// Mac, downloading one in the background, and opening a downloaded pack in the
// library (its folder is the app's own, so no folder dialog is needed).
import { listen } from "@tauri-apps/api/event";
import { api, type Catalog, type PackStatus } from "./lib/api";
import type { AppState } from "./store";

export interface PacksState {
  catalog: Catalog | null;
  /** Latest download update (whichever pack). */
  packDownload: PackStatus | null;
  /** The 素材库 sheet. */
  packsOpen: boolean;
  setPacksOpen(open: boolean): void;
  loadCatalog(): Promise<void>;
  downloadPack(id: string): Promise<void>;
  cancelPack(): void;
  removePack(id: string): Promise<void>;
  /** Opens a downloaded pack in the library, at its first dialogue. */
  openPack(id: string): Promise<void>;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

/** Whether `path` is one of the pack's tracks (it lives in `<root>/<folder>/`). */
export const inPack = (path: string, root: string, folder: string | null) => !!folder && path.startsWith(`${root}/${folder}/`);

export function createPacksSlice(set: Set, get: Get): PacksState {
  void listen<PackStatus>("packs:download", ({ payload }) => {
    set({ packDownload: payload });
    if (payload.state !== "done") return;
    void get().loadCatalog();
    // A newer version replaced files in the open folder.
    if (get().folder && get().folder?.root === get().catalog?.root) void get().rescan();
  });

  return {
    catalog: null,
    packDownload: null,
    packsOpen: false,

    setPacksOpen(packsOpen) {
      set(packsOpen ? { packsOpen, settingsOpen: false, statsOpen: false, wizardOpen: false } : { packsOpen });
      if (packsOpen) void get().loadCatalog();
    },

    async loadCatalog() {
      try {
        const catalog = await api.packs.catalog();
        set({ catalog });
        // Still downloading from before the window reloaded.
        if (catalog.downloading && get().packDownload?.state !== "running") {
          set({ packDownload: { state: "running", id: catalog.downloading, done: 0, total: 0 } });
        }
      } catch (e) {
        const before = get().catalog;
        set({ catalog: { packs: before?.packs ?? [], error: String(e), downloading: null, root: before?.root ?? "" } });
      }
    },

    async downloadPack(id) {
      const pack = get().catalog?.packs.find((p) => p.id === id);
      set({ packDownload: { state: "running", id, done: 0, total: pack?.size ?? 0 } });
      try {
        await api.packs.download(id);
      } catch (e) {
        set({ packDownload: { state: "failed", id, message: String(e) } });
      }
    },

    cancelPack() {
      void api.packs.cancel();
    },

    async removePack(id) {
      const { catalog, current, folder } = get();
      if (!catalog) return;
      const pack = catalog.packs.find((p) => p.id === id);
      if (current && pack && inPack(current.path, catalog.root, pack.folder)) get().closeTrack();
      try {
        const open = await api.packs.remove(id);
        // The packs folder was open: it lost a group, or (left empty) isn't open any more.
        if (folder?.root === catalog.root) set({ folder: open });
      } catch (e) {
        set({ error: String(e) });
      }
      await get().loadCatalog();
    },

    async openPack(id) {
      try {
        const { folder, first } = await api.packs.open(id);
        get().showFolder(folder);
        set({ packsOpen: false });
        const track = folder.tracks.find((t) => t.path === first);
        if (track) get().open(track, false);
        get().tip("pack");
      } catch (e) {
        set({ error: String(e) });
      }
    },
  };
}
