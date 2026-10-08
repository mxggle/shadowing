// Browser-only fake backend for UI work: `npm run dev` then open localhost:1420.
// Simulates the Rust commands and player:* events; no real audio.
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { AiConfig, Feature, Preset, Snapshot, Track, Transcript } from "../lib/api";

const root = "/Mock/日本語ポッドキャスト";
const tracks: Track[] = [
  ["", "01 自己紹介"],
  ["", "02 天気の話"],
  ["", "03 A very long episode title about shadowing practice and pronunciation"],
  ["Unit 2", "04 駅で"],
  ["Unit 2", "05 カフェで"],
].map(([relDir, name], i) => ({ path: `${root}/${relDir}/${name}.mp3`, name, relDir, size: 1e6 * (i + 1) }));

const lines = [
  "おはようございます。今日もよろしくお願いします。",
  "今日は天気の話をしましょう。",
  "朝から雨が降っていますね。",
  "傘を持ってきましたか？",
  "いいえ、忘れてしまいました。",
  "駅まで一緒に行きましょうか。",
  "ありがとうございます。助かります。",
  "週末は晴れるそうですよ。",
  "それなら、公園でピクニックをしたいですね。",
  "いいですね。お弁当を作りましょう。",
  "天気予報によると、気温も上がるそうです。",
  "日焼け止めを忘れないようにしないと。",
];
const mockTranscript = (origin: string, count: number): Transcript => ({
  source: "imported",
  origin,
  sentences: Array.from({ length: count }, (_, i) => ({ start: 2 + i * 6, end: 2 + i * 6 + 4.2, text: lines[i % lines.length] })),
});
const transcripts = new Map<string, Transcript>([[tracks[1].path, { ...mockTranscript("02 天気の話.srt", 32), source: "sidecar" }]]);

// AI settings: a trimmed copy of the Rust presets; "bad" as a key fails the test, LM Studio is "not running".
const cloud: Omit<Preset, "id" | "name" | "baseUrl"> = { api: "openAi", local: false, key: "required", keyUrl: "https://example.com", features: ["chat"], transcribeModel: null, transcribePrices: [], chatModel: null, note: "" };
const presets: Preset[] = [
  { ...cloud, id: "local", name: "本机", api: "builtin", baseUrl: "", local: true, key: "none", keyUrl: null, features: ["transcribe"], note: "在这台 Mac 上用 Whisper 转写：免费、可离线，需要先下载一个模型" },
  { ...cloud, id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", features: ["transcribe"], transcribeModel: "whisper-large-v3", transcribePrices: [["whisper-large-v3", 0.111], ["whisper-large-v3-turbo", 0.04]], note: "Whisper large-v3，约 $0.11 / 小时音频，速度很快" },
  { ...cloud, id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", features: ["transcribe", "chat"], transcribeModel: "whisper-1", transcribePrices: [["whisper-1", 0.36]], chatModel: "gpt-5-mini", note: "转写用 whisper-1（约 $0.36 / 小时）；解释可选 GPT 系列" },
  { ...cloud, id: "chatgpt", name: "ChatGPT 账号", api: "responses", baseUrl: "https://api.openai.com/v1", key: "account", keyUrl: null, note: "用 ChatGPT Plus / Pro 套餐的额度，不需要 API Key（OpenAI 的预览功能，可能变化）" },
  { ...cloud, id: "anthropic", name: "Anthropic", api: "anthropic", baseUrl: "https://api.anthropic.com/v1", chatModel: "claude-haiku-5-5", note: "Claude 系列" },
  { ...cloud, id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", note: "Gemini 系列；免费额度的数据可能被 Google 用于改进模型" },
  { ...cloud, id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", note: "价格低，中文好" },
  { ...cloud, id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", note: "一个 Key 使用多家的模型" },
  { ...cloud, id: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1", local: true, key: "none", keyUrl: null, note: "本机运行，需要先安装并启动 Ollama" },
  { ...cloud, id: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234/v1", local: true, key: "none", keyUrl: null, note: "本机运行，需要在 LM Studio 里启动本地服务" },
  { ...cloud, id: "custom-transcribe", name: "自定义", baseUrl: "", key: "optional", keyUrl: null, features: ["transcribe"], note: "任何 OpenAI 兼容的转写服务（需要支持 verbose_json 时间戳）" },
  { ...cloud, id: "custom-chat", name: "自定义", baseUrl: "", key: "optional", keyUrl: null, note: "任何 OpenAI 兼容的服务" },
];
const aiConfig: AiConfig = { transcribe: { provider: null, model: "" }, chat: { provider: null, model: "" }, baseUrls: {}, keyHints: {}, chatgptClientId: null, chatgptHostId: null };
const keys: Record<string, string> = {};
const mockModels: Record<string, string[]> = {
  groq: ["whisper-large-v3", "whisper-large-v3-turbo"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "whisper-1"],
  anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  chatgpt: ["gpt-6.1-luna", "gpt-6.1-sol"],
  ollama: ["gemma4:12b", "qwen3.5:9b"],
};
function mockList(provider: string, feature: Feature): string[] {
  const p = presets.find((x) => x.id === provider)!;
  if (p.key === "required" && !keys[provider]) throw `还没有填写 ${p.name} 的 API Key`;
  if (p.key === "account" && !aiConfig.keyHints[provider]) throw `还没有用 ${p.name} 登录`;
  if (keys[provider] === "bad") throw `${p.name} 拒绝了这个 API Key（401），请检查是否填错或已失效：Incorrect API key provided`;
  if (provider === "lmstudio") throw "没有连接到 LM Studio，请确认它已经启动";
  if (!p.baseUrl && !aiConfig.baseUrls[provider]) throw "还没有填写自定义服务的地址";
  const all = mockModels[provider] ?? ["model-a", "model-b"];
  return all.filter((m) => (feature === "transcribe") === m.includes("whisper") || !p.baseUrl);
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Local models: downloads take ~5 s; turbo q5 is "already downloaded".
const localModels = [
  { id: "large-v3-turbo-q5_0", name: "Large v3 Turbo（压缩）", size: 574e6, memoryGb: 1, note: "速度和准确度平衡，日语、英语都不错", downloaded: true, partial: 0, fit: "good" as const },
  { id: "large-v3-turbo-q8_0", name: "Large v3 Turbo", size: 874e6, memoryGb: 1.3, note: "比压缩版略准一点，速度差不多", downloaded: false, partial: 0, fit: "good" as const },
  { id: "large-v3", name: "Large v3", size: 3.1e9, memoryGb: 3.9, note: "最准（尤其日语），但慢很多", downloaded: false, partial: 9e8, fit: "tight" as const },
  { id: "small-q5_1", name: "Small", size: 190e6, memoryGb: 0.6, note: "很快、很小，但日语错误较多，适合先试试", downloaded: false, partial: 0, fit: "good" as const },
];
let downloading: { id: string; timer: number; cancelled: boolean } | null = null;
const localOverview = () => ({ supported: true, ramGb: 16, freeBytes: 120e9, recommended: "large-v3-turbo-q8_0", models: localModels, downloading: downloading?.id ?? null });
function mockDownload(id: string) {
  if (downloading) throw "已经有一个模型在下载";
  const m = localModels.find((x) => x.id === id)!;
  let done = m.partial;
  const status = (s: object) => void emit("local:download", { id, ...s });
  downloading = {
    id,
    cancelled: false,
    timer: window.setInterval(() => {
      const end = (s: object) => (window.clearInterval(downloading!.timer), (downloading = null), status(s));
      if (downloading?.cancelled) return (m.partial = done), end({ state: "cancelled" });
      done = Math.min(m.size, done + m.size / 20);
      if (done < m.size) return status({ state: "running", done, total: m.size });
      Object.assign(m, { downloaded: true, partial: 0 });
      end({ state: "done" });
    }, 250),
  };
}

// Transcription: ~4 s of fake progress, then a transcript. Language "xx" fails, to see the error state.
let job: { path: string; timer: number; cancelled: boolean } | null = null;
function mockTranscribe(path: string, language: string) {
  if (!aiConfig.transcribe.provider) throw "还没有设置转写服务";
  if (job) throw "已经有一个音频在转写，请等它完成";
  const total = 180 + tracks.findIndex((t) => t.path === path) * 20;
  let done = 0;
  const status = (s: object) => void emit("transcribe:status", { path, ...s });
  job = {
    path,
    cancelled: false,
    timer: window.setInterval(() => {
      if (job?.cancelled) return finish({ state: "cancelled" });
      done = Math.min(total, done + total / 8);
      if (language === "xx" && done > total / 2) return finish({ state: "failed", message: "Groq 额度不足或请求太频繁（429）" });
      if (done < total) return status({ state: "running", done, total });
      const transcript = { ...mockTranscript(`${presets.find((p) => p.id === aiConfig.transcribe.provider)?.name} · ${aiConfig.transcribe.model}`, 28), source: "transcribed" as const };
      transcripts.set(path, transcript);
      finish({ state: "done", transcript });
    }, 500),
  };
  function finish(s: object) {
    window.clearInterval(job!.timer);
    job = null;
    status(s);
  }
}

const player = { path: null as string | null, time: 0, duration: 0, playing: false, rate: 1, a: null as number | null, b: null as number | null, repeats: 0 };
let seq = 0;
const status = () => ({ path: player.path, time: player.time, duration: player.duration, playing: player.playing, repeats: player.repeats, seq: ++seq });
const push = () => void emit("player:status", status());

setInterval(() => {
  if (!player.playing) return;
  const next = player.time + 0.05 * player.rate;
  if (player.a !== null && player.b !== null && player.time < player.b && next >= player.b) {
    player.time = player.a;
    player.repeats++;
  }
  else if (next >= player.duration) {
    player.time = player.duration;
    player.playing = false;
    void emit("player:ended", { path: player.path });
  } else player.time = next;
  push();
}, 50);

export function installMockBackend() {
  const snapshot: Snapshot = {
    folder: { root, name: "日本語ポッドキャスト", tracks },
    missingFolder: null,
    lastTrack: tracks[1].path,
    settings: { rate: 0.85, autoAdvance: true, seekStep: 5, transcribeLanguage: "" },
    progress: {
      [tracks[0].path]: { position: 178, duration: 180, updatedAt: 0 },
      [tracks[1].path]: { position: 64, duration: 200, updatedAt: 0 },
    },
  };
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, never>;
      switch (cmd) {
        case "get_snapshot":
          return snapshot;
        case "player_load":
          Object.assign(player, { path: a.path, time: a.startAt, duration: 180 + tracks.findIndex((t) => t.path === a.path) * 20, playing: a.autoplay, a: null, b: null, repeats: 0 });
          return status();
        case "player_play":
        case "player_pause":
        case "player_toggle":
          player.playing = cmd === "player_toggle" ? !player.playing : cmd === "player_play";
          return status();
        case "player_seek":
          player.time = a.time;
          return status();
        case "player_set_rate":
          player.rate = a.rate;
          return;
        case "player_set_loop":
          Object.assign(player, { a: a.a, b: a.b, repeats: 0 });
          return;
        case "player_status":
          return status();
        case "transcript_get":
          return transcripts.get(a.path) ?? null;
        case "transcript_import": {
          const t = mockTranscript("imported.vtt", 24);
          transcripts.set(a.path, t);
          return t;
        }
        case "transcript_remove":
          transcripts.delete(a.path);
          return null;
        case "ai_get":
          return { presets, config: aiConfig };
        case "ai_choose":
          aiConfig[a.feature as Feature] = { provider: a.provider, model: a.model };
          return aiConfig;
        case "ai_set_base_url":
          if (a.url) aiConfig.baseUrls[a.provider] = a.url;
          else delete aiConfig.baseUrls[a.provider];
          return aiConfig;
        case "ai_set_key":
          if (a.key) {
            keys[a.provider] = a.key;
            aiConfig.keyHints[a.provider] = (a.key as string).length < 12 ? "••••" : `${(a.key as string).slice(0, 3)}…${(a.key as string).slice(-4)}`;
          } else {
            delete keys[a.provider];
            delete aiConfig.keyHints[a.provider];
          }
          return aiConfig;
        case "ai_models":
          return delay(400).then(() => mockList(a.provider, a.feature));
        case "ai_test": {
          const choice = aiConfig[a.feature as Feature];
          if (!choice.provider) throw "还没有选择服务";
          return delay(600).then(() => {
            const list = mockList(choice.provider!, a.feature);
            const chat = a.feature === "chat";
            return {
              models: list.length,
              modelFound: list.includes(choice.model),
              sample: chat ? "今日はいい天気ですね。散歩に行きましょう。" : null,
              reply: chat ? "今天天气真好啊。我们去散步吧。\n「〜ましょう」表示提议或邀请，相当于“一起……吧”。" : null,
              millis: 1240,
            };
          });
        }
        case "local_models":
          return localOverview();
        case "local_download":
          return mockDownload(a.id);
        case "local_cancel_download":
          if (downloading) downloading.cancelled = true;
          return;
        case "local_delete":
          Object.assign(localModels.find((m) => m.id === a.id)!, { downloaded: false, partial: 0 });
          return localOverview();
        case "ai_detect_local":
          return [{ id: "ollama", models: 2 }];
        case "ai_sign_in_openrouter":
          return delay(1500).then(() => {
            keys.openrouter = "sk-or-v1-mock000000001234";
            aiConfig.keyHints.openrouter = "sk-…1234";
            return aiConfig;
          });
        case "ai_sign_in_cancel":
          return;
        case "ai_sign_in_chatgpt":
          return delay(1500).then(() => ((aiConfig.keyHints.chatgpt = "learner@example.com"), aiConfig));
        case "ai_sign_out_chatgpt":
          delete aiConfig.keyHints.chatgpt;
          return aiConfig;
        case "transcribe_start":
          return mockTranscribe(a.path, a.language);
        case "transcribe_cancel":
          if (job) job.cancelled = true;
          return;
        case "transcribe_running":
          return job?.path ?? null;
        case "smoke_mode":
          return false;
        default:
          return null; // save_progress, save_settings, set_last_track, choose_folder…
      }
    },
    { shouldMockEvents: true },
  );
}
