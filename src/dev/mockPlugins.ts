// Plugins and 从链接导入 in the browser mock: the YouTube plugin is installed,
// a link resolves after a moment, and a download adds a track to the folder.
import { emit } from "@tauri-apps/api/event";
import type { FolderListing, ImportStatus, PluginInfo, Resolved } from "../lib/api";

let plugins: PluginInfo[] = [
  {
    id: "youtube",
    name: "YouTube 导入",
    version: "0.1.0",
    author: "Shadowing",
    description: "粘贴 YouTube 链接，把视频的音频（m4a，不转码）和人工字幕导入到打开的文件夹。只下载你有权使用的内容。",
    importers: ["YouTube"],
    permissions: { network: ["youtube.com", "googlevideo.com", "github.com"], runs: "第一次使用时下载 yt-dlp" },
    bytes: 126_400_000,
    problem: null,
  },
];

const resolved: Resolved = {
  title: "日本語練習／中級【～によって】会話",
  duration: 698,
  uploader: "Let's speak Japanese with Yuki",
  language: "ja",
  subtitles: [
    { lang: "en", name: "English" },
    { lang: "ja", name: "Japanese" },
  ],
  plugin: "YouTube 导入",
  via: "YouTube",
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = (s: ImportStatus) => void emit("import:status", s);
let cancelled = false;

export async function mockPlugins(cmd: string, a: Record<string, never>, folder: FolderListing | null): Promise<unknown> {
  switch (cmd) {
    case "plugins_list":
      return plugins;
    case "plugins_pick":
      return {
        name: "YouTube 导入",
        version: "0.1.0",
        author: "Shadowing",
        description: plugins[0]?.description ?? "",
        permissions: { network: ["youtube.com", "googlevideo.com", "github.com"], runs: "第一次使用时从 GitHub 下载 yt-dlp（约 51 MB）和 QuickJS（约 1 MB）" },
        replacing: plugins.length ? "0.1.0" : null,
      };
    case "plugins_install":
      return plugins;
    case "plugins_remove":
      plugins = plugins.filter((p) => p.id !== a.id);
      return plugins;
    case "import_clipboard":
      return "https://www.youtube.com/watch?v=FFMoTdeD1aM";
    case "import_cancel":
      cancelled = true;
      return null;
    case "import_resolve": {
      const url = a.url as string;
      if (!plugins.length) throw "还没有能导入 YouTube 链接的插件。在 设置 → 插件 里安装 YouTube 导入插件。";
      if (!/youtu/.test(url)) throw "没有能导入这个链接的插件";
      status({ state: "resolving", message: "读取视频信息", done: 0, total: 0 });
      await wait(900);
      if (url.includes("private")) throw "这是私享视频，下载不了";
      return resolved;
    }
    case "import_start": {
      if (!folder) throw "请先打开一个文件夹，导入的音频会放在里面";
      cancelled = false;
      const total = 11_299_164;
      void (async () => {
        if ((a.url as string).includes("fail")) {
          await wait(1200);
          return status({ state: "failed", title: a.title, message: "YouTube 要求登录确认不是机器人。过一会儿再试，或换个网络。" });
        }
        for (let done = 0; done <= total; done += 700_000) {
          if (cancelled) return status({ state: "cancelled", title: a.title });
          status({ state: "downloading", title: a.title, message: "下载音频", done, total });
          await wait(300);
        }
        const name = a.title as string;
        const relDir = (a.folder as string).trim();
        const path = `${folder.root}/${relDir ? relDir + "/" : ""}${name}.m4a`;
        if (!folder.tracks.some((t) => t.path === path)) folder.tracks.push({ path, name, relDir, size: total });
        status({ state: "done", title: name, path, subtitles: !!a.subtitles });
      })();
      return null;
    }
    case "rescan_folder":
      return folder && { ...folder, tracks: [...folder.tracks] };
  }
  return undefined;
}
