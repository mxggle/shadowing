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
const cloud: Omit<Preset, "id" | "name" | "baseUrl"> = { api: "openAi", local: false, key: "required", keyUrl: "https://example.com", features: ["chat"], transcribeModel: null, chatModel: null, note: "" };
const presets: Preset[] = [
  { ...cloud, id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", features: ["transcribe"], transcribeModel: "whisper-large-v3", note: "Whisper large-v3，约 $0.11 / 小时音频，速度很快" },
  { ...cloud, id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", features: ["transcribe", "chat"], transcribeModel: "whisper-1", chatModel: "gpt-5-mini", note: "转写用 whisper-1（约 $0.36 / 小时）；解释可选 GPT 系列" },
  { ...cloud, id: "anthropic", name: "Anthropic", api: "anthropic", baseUrl: "https://api.anthropic.com/v1", chatModel: "claude-haiku-5-5", note: "Claude 系列" },
  { ...cloud, id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", note: "Gemini 系列；免费额度的数据可能被 Google 用于改进模型" },
  { ...cloud, id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", note: "价格低，中文好" },
  { ...cloud, id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", note: "一个 Key 使用多家的模型" },
  { ...cloud, id: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1", local: true, key: "none", keyUrl: null, note: "本机运行，需要先安装并启动 Ollama" },
  { ...cloud, id: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234/v1", local: true, key: "none", keyUrl: null, note: "本机运行，需要在 LM Studio 里启动本地服务" },
  { ...cloud, id: "custom-transcribe", name: "自定义", baseUrl: "", key: "optional", keyUrl: null, features: ["transcribe"], note: "任何 OpenAI 兼容的转写服务（需要支持 verbose_json 时间戳）" },
  { ...cloud, id: "custom-chat", name: "自定义", baseUrl: "", key: "optional", keyUrl: null, note: "任何 OpenAI 兼容的服务" },
];
const aiConfig: AiConfig = { transcribe: { provider: null, model: "" }, chat: { provider: null, model: "" }, baseUrls: {}, keyHints: {} };
const keys: Record<string, string> = {};
const mockModels: Record<string, string[]> = {
  groq: ["whisper-large-v3", "whisper-large-v3-turbo"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "whisper-1"],
  anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  ollama: ["gemma4:12b", "qwen3.5:9b"],
};
function mockList(provider: string, feature: Feature): string[] {
  const p = presets.find((x) => x.id === provider)!;
  if (p.key === "required" && !keys[provider]) throw `还没有填写 ${p.name} 的 API Key`;
  if (keys[provider] === "bad") throw `${p.name} 拒绝了这个 API Key（401），请检查是否填错或已失效：Incorrect API key provided`;
  if (provider === "lmstudio") throw "没有连接到 LM Studio，请确认它已经启动";
  if (!p.baseUrl && !aiConfig.baseUrls[provider]) throw "还没有填写自定义服务的地址";
  const all = mockModels[provider] ?? ["model-a", "model-b"];
  return all.filter((m) => (feature === "transcribe") === m.includes("whisper") || !p.baseUrl);
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const player = { path: null as string | null, time: 0, duration: 0, playing: false, rate: 1, a: null as number | null, b: null as number | null };
let seq = 0;
const status = () => ({ path: player.path, time: player.time, duration: player.duration, playing: player.playing, seq: ++seq });
const push = () => void emit("player:status", status());

setInterval(() => {
  if (!player.playing) return;
  const next = player.time + 0.05 * player.rate;
  if (player.a !== null && player.b !== null && player.time < player.b && next >= player.b) player.time = player.a;
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
    settings: { rate: 0.85, autoAdvance: true, seekStep: 5 },
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
          Object.assign(player, { path: a.path, time: a.startAt, duration: 180 + tracks.findIndex((t) => t.path === a.path) * 20, playing: a.autoplay, a: null, b: null });
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
          Object.assign(player, { a: a.a, b: a.b });
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
            return { models: list.length, modelFound: list.includes(choice.model) };
          });
        }
        case "smoke_mode":
          return false;
        default:
          return null; // save_progress, save_settings, set_last_track, choose_folder…
      }
    },
    { shouldMockEvents: true },
  );
}
