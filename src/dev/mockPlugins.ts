// Plugins and 从链接导入 in the browser mock: the YouTube plugin is installed,
// a link resolves after a moment, and a download adds a track to the folder.
import { emit } from "@tauri-apps/api/event";
import type { Annotation, FolderListing, ImportStatus, PluginInfo, Resolved } from "../lib/api";

let plugins: PluginInfo[] = [
  {
    id: "youtube",
    name: "YouTube 导入",
    version: "0.1.0",
    author: "Shadowing",
    description: "粘贴 YouTube 链接，把视频的音频（m4a，不转码）和人工字幕导入到打开的文件夹。只下载你有权使用的内容。",
    importers: ["YouTube"],
    annotators: [],
    settings: [],
    permissions: { network: ["youtube.com", "googlevideo.com", "github.com"], runs: "第一次使用时下载 yt-dlp" },
    bytes: 126_400_000,
    problem: null,
  },
  {
    id: "furigana",
    name: "日语注音",
    version: "0.1.0",
    author: "Shadowing",
    description: "在日语句子的汉字上方标出读音：平假名、片假名或罗马音。词典（IPADIC）在插件里，不联网。",
    importers: [],
    annotators: ["日语注音"],
    settings: [
      {
        key: "style",
        kind: "select",
        label: "注音用",
        value: "hiragana",
        options: [
          { value: "hiragana", label: "平假名" },
          { value: "katakana", label: "片假名" },
          { value: "romaji", label: "罗马音" },
        ],
      },
    ],
    permissions: { network: [], runs: "只在这台电脑上分词、查读音，不下载、不运行别的程序" },
    bytes: 48_500_000,
    problem: null,
  },
];

// The kanji of the mock sentences: reading, romaji.
const WORDS: Record<string, [string, string]> = {
  今日: ["きょう", "kyou"], 天気: ["てんき", "tenki"], 話: ["はなし", "hanashi"], 朝: ["あさ", "asa"], 雨: ["あめ", "ame"],
  降: ["ふ", "fu"], 傘: ["かさ", "kasa"], 持: ["も", "mo"], 忘: ["わす", "wasu"], 駅: ["えき", "eki"], 一緒: ["いっしょ", "issho"],
  行: ["い", "i"], 助: ["たす", "tasu"], 週末: ["しゅうまつ", "shuumatsu"], 晴: ["は", "ha"], 公園: ["こうえん", "kouen"],
  弁当: ["べんとう", "bentou"], 作: ["つく", "tsuku"], 予報: ["よほう", "yohou"], 気温: ["きおん", "kion"], 上: ["あ", "a"],
  日焼: ["ひや", "hiya"], 止: ["ど", "do"], 願: ["ねが", "nega"],
};

/** What the 日语注音 plugin would answer, from WORDS. */
function annotate(texts: string[]): Annotation[] {
  const style = plugins.find((p) => p.id === "furigana")?.settings[0]?.value;
  const shown = ([kana, romaji]: [string, string]) =>
    style === "romaji" ? romaji : style === "katakana" ? kana.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)) : kana;
  return texts.map((text) => {
    const pieces: { text: string; ruby?: string }[] = [];
    for (let i = 0; i < text.length; ) {
      const word = [2, 1].map((n) => text.slice(i, i + n)).find((w) => WORDS[w]);
      if (word) pieces.push({ text: word, ruby: shown(WORDS[word]) });
      else if (pieces.length && !pieces[pieces.length - 1].ruby) pieces[pieces.length - 1].text += text[i];
      else pieces.push({ text: text[i] });
      i += word?.length ?? 1;
    }
    return { pieces };
  });
}

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
  videos: [
    { height: 360, size: 27_400_000 },
    { height: 480, size: 41_800_000 },
    { height: 720, size: 92_600_000 },
    { height: 1080, size: 176_300_000 },
  ],
  audioSize: 11_299_164,
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
    case "plugins_annotate":
      await wait(300);
      return plugins.some((p) => p.id === "furigana") ? annotate(a.texts) : (a.texts as string[]).map(() => ({}));
    case "plugins_set_setting":
      plugins = plugins.map((p) =>
        p.id === a.id ? { ...p, settings: p.settings.map((s) => (s.key === a.key ? { ...s, value: a.value } : s)) } : p,
      );
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
          status({ state: "downloading", title: a.title, message: a.video ? "下载画面和声音" : "下载音频", done, total });
          await wait(300);
        }
        const name = a.title as string;
        const relDir = (a.folder as string).trim();
        // With the picture (`video`: its height), an mp4 the mock plays as its test pattern.
        const kind = a.video ? "video" : "audio";
        const path = `${folder.root}/${relDir ? relDir + "/" : ""}${name}.${a.video ? "mp4" : "m4a"}`;
        if (!folder.tracks.some((t) => t.path === path)) folder.tracks.push({ path, name, relDir, size: total, kind });
        status({ state: "done", title: name, path, subtitles: !!a.subtitles });
      })();
      return null;
    }
    case "rescan_folder":
      return folder && { ...folder, tracks: [...folder.tracks] };
  }
  return undefined;
}
