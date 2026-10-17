// Plugins and 从链接导入 part of the single store. A plugin (src-tauri/src/plugins)
// says what a link is, then downloads it in the background; the audio lands in the
// open folder and the sidebar shows how it is going (ImportLink.tsx).
import { listen } from "@tauri-apps/api/event";
import { api, type ImportStatus, type PluginInfo, type Resolved } from "./lib/api";
import type { AppState } from "./store";

export interface LinkImport {
  url: string;
  /** Asking the plugin what the link is (the first time it also fetches its tools). */
  resolving: boolean;
  progress: { message: string; done: number; total: number } | null;
  resolved: Resolved | null;
  error: string | null;
}

export interface ImportState {
  plugins: PluginInfo[];
  /** The 从链接导入 sheet, while open. */
  linkImport: LinkImport | null;
  /** The download in the sidebar, or how the last one ended until dismissed. */
  importJob: ImportStatus | null;
  /** Link of the last download, to try again. */
  importUrl: string;
  loadPlugins(): Promise<void>;
  setPlugins(plugins: PluginInfo[]): void;
  /** Opens the sheet; with a link (or one on the clipboard) it is read at once. */
  openImport(url?: string): Promise<void>;
  resolveImport(url: string): Promise<void>;
  /** `folder`: subfolder of the open folder ("" = the folder itself). */
  startImport(subtitles: string | null, folder: string): Promise<void>;
  closeImport(): void;
  cancelImport(): void;
  dismissImport(): void;
  /** ⌘V outside a text field: a link on the clipboard opens the sheet. */
  pasteLink(): Promise<void>;
  watchImports(): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export function createImportSlice(set: Set, get: Get): ImportState {
  const patch = (change: Partial<LinkImport>) => {
    const current = get().linkImport;
    if (current) set({ linkImport: { ...current, ...change } });
  };

  return {
    plugins: [],
    linkImport: null,
    importJob: null,
    importUrl: "",

    async loadPlugins() {
      try {
        set({ plugins: await api.plugins.list() });
      } catch {
        /* the list is only for showing what's installed */
      }
    },

    setPlugins(plugins) {
      set({ plugins });
    },

    async openImport(url) {
      set({ linkImport: { url: url ?? "", resolving: false, progress: null, resolved: null, error: null } });
      const link = url ?? (await api.imports.clipboard().catch(() => null));
      if (link && get().linkImport) await get().resolveImport(link);
    },

    async resolveImport(url) {
      url = url.trim();
      if (!url) return;
      set({ linkImport: { url, resolving: true, progress: null, resolved: null, error: null } });
      try {
        const resolved = await api.imports.resolve(url);
        // Closed or changed to another link meanwhile: this answer is stale.
        if (get().linkImport?.url === url) patch({ resolving: false, resolved, progress: null });
      } catch (e) {
        if (get().linkImport?.url === url) patch({ resolving: false, error: String(e), progress: null });
      }
    },

    async startImport(subtitles, folder) {
      const link = get().linkImport;
      if (!link?.resolved) return;
      const { title } = link.resolved;
      try {
        await api.imports.start(link.url, title, subtitles, folder);
        set({
          linkImport: null,
          importUrl: link.url,
          importJob: { state: "downloading", title, message: "开始下载", done: 0, total: 0 },
        });
      } catch (e) {
        patch({ error: String(e) });
      }
    },

    closeImport() {
      if (get().linkImport?.resolving) void api.imports.cancel();
      set({ linkImport: null });
    },

    cancelImport() {
      void api.imports.cancel();
    },

    dismissImport() {
      set({ importJob: null });
    },

    async pasteLink() {
      const url = await api.imports.clipboard().catch(() => null);
      if (url) await get().openImport(url);
    },

    watchImports() {
      void listen<ImportStatus>("import:status", ({ payload }) => {
        if (payload.state === "resolving") {
          const { message, done, total } = payload;
          if (get().linkImport?.resolving) patch({ progress: { message, done, total } });
          return;
        }
        if (payload.state === "cancelled") return set({ importJob: null });
        set({ importJob: payload });
        if (payload.state === "done") void get().rescan();
      });
      void get().loadPlugins();
    },
  };
}
