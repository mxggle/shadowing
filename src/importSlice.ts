// Plugins and 从链接导入 part of the single store. A plugin (src-tauri/src/plugins)
// says what a link is, then downloads it in the background. Downloads queue up
// here and run one at a time; each shows as a row in the folder group it lands in
// (lib/imports.ts, Library.tsx), and becomes a normal track when it's done.
import { listen } from "@tauri-apps/api/event";
import { api, type ImportStatus, type PluginInfo, type Resolved, type Settings } from "./lib/api";
import { nextDownload, type Download } from "./lib/imports";
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
  /** Downloads waiting, running (one) or failed, in the order they were asked for. */
  downloads: Download[];
  /** Settings should scroll to this part when it opens (“更多导入方式…”). */
  settingsFocus: "plugins" | null;
  loadPlugins(): Promise<void>;
  setPlugins(plugins: PluginInfo[]): void;
  /** Opens the sheet; with a link (or one on the clipboard) it is read at once. */
  openImport(url?: string): Promise<void>;
  resolveImport(url: string): Promise<void>;
  /**
   * Queues the link the sheet read. `folder`: subfolder of the open folder ("" = the folder itself);
   * `video`: the picture too, at most this tall (null: only the sound), remembered for next time.
   */
  startImport(subtitles: string | null, folder: string, video: number | null): void;
  closeImport(): void;
  /** Stops a running download, or drops a waiting or failed one. */
  dropDownload(id: number): void;
  retryDownload(id: number): void;
  /** ⌘V outside a text field: a link on the clipboard opens the sheet. */
  pasteLink(): Promise<void>;
  /** Settings, scrolled to 插件. */
  showPlugins(): void;
  watchImports(): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

let lastId = 0;

export function createImportSlice(set: Set, get: Get, persistSettings: (patch: Partial<Settings>) => void): ImportState {
  const patch = (change: Partial<LinkImport>) => {
    const current = get().linkImport;
    if (current) set({ linkImport: { ...current, ...change } });
  };
  const update = (id: number, change: Partial<Download>) =>
    set({ downloads: get().downloads.map((d) => (d.id === id ? { ...d, ...change } : d)) });
  const remove = (id: number) => set({ downloads: get().downloads.filter((d) => d.id !== id) });
  const running = () => get().downloads.find((d) => d.state === "downloading");

  /** Starts the next waiting download when none is running. */
  const pump = () => {
    const next = nextDownload(get().downloads);
    if (!next) return;
    update(next.id, { state: "downloading", message: "", done: 0, total: 0 });
    api.imports.start(next.url, next.title, next.subtitles, next.folder, next.video).catch((e) => {
      update(next.id, { state: "failed", message: String(e) });
      pump();
    });
  };

  return {
    plugins: [],
    linkImport: null,
    downloads: [],
    settingsFocus: null,

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

    startImport(subtitles, folder, video) {
      const link = get().linkImport;
      if (!link?.resolved) return;
      if (link.resolved.videos?.length) persistSettings({ importVideo: video ?? 0 });
      const download: Download = {
        id: ++lastId,
        url: link.url,
        title: link.resolved.title,
        subtitles,
        video,
        folder,
        state: "queued",
        message: "",
        done: 0,
        total: 0,
      };
      set({ linkImport: null, downloads: [...get().downloads, download] });
      pump();
    },

    closeImport() {
      if (get().linkImport?.resolving) void api.imports.cancel("resolve");
      set({ linkImport: null });
    },

    dropDownload(id) {
      // A running one ends with a “cancelled” status, which takes its row away.
      if (running()?.id === id) void api.imports.cancel("download");
      else remove(id);
    },

    retryDownload(id) {
      update(id, { state: "queued", message: "" });
      pump();
    },

    async pasteLink() {
      const url = await api.imports.clipboard().catch(() => null);
      if (url) await get().openImport(url);
    },

    showPlugins() {
      set({ linkImport: null, settingsFocus: "plugins" });
      get().setSettingsOpen(true);
    },

    watchImports() {
      void listen<ImportStatus>("import:status", ({ payload }) => {
        if (payload.state === "resolving") {
          const { message, done, total } = payload;
          if (get().linkImport?.resolving) patch({ progress: { message, done, total } });
          return;
        }
        const current = running();
        if (!current) return;
        switch (payload.state) {
          case "downloading":
            update(current.id, { message: payload.message, done: payload.done, total: payload.total });
            return;
          case "failed":
            update(current.id, { state: "failed", message: payload.message });
            break;
          case "cancelled":
            remove(current.id);
            break;
          case "done":
            // The row stays until the new track is listed, so nothing blinks out in between.
            update(current.id, { state: "finishing" });
            void get()
              .rescan()
              .finally(() => remove(current.id));
            break;
        }
        pump();
      });
      void get().loadPlugins();
    },
  };
}
