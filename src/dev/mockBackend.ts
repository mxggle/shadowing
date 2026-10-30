// Browser-only fake backend for UI work: `npm run dev` then open localhost:1420.
// Simulates the Rust commands and player:* events; no real audio.
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { AiConfig, Explanation, Feature, PracticeSession, Preset, SavedExplanation, Section, SentenceEdit, Snapshot, Suggestion, Track, Transcript } from "../lib/api";
import { fresh, samples, sampleTranscripts } from "./mockSamples";
import { mockRecord, seedTakes, stopClip } from "./mockRecorder";
import { mockPlugins } from "./mockPlugins";
import { mockReshape } from "./mockReshape";
import { isWindows } from "../lib/platform";
// A 60-second test pattern with a running clock (checks the picture follows the mock player).
import mockVideo from "./mockVideo.mp4?url";

const root = "/Mock/日本語ポッドキャスト";
const tracks: Track[] = (
  [
    ["", "01 自己紹介", "mp3"],
    ["", "02 天気の話", "mp3"],
    ["", "03 A very long episode title about shadowing practice and pronunciation", "mp3"],
    ["Unit 2", "04 駅で", "mp3"],
    ["Unit 2", "05 カフェで", "mp3"],
    ["YouTube", "06 休日の朝ルーティン", "mp4"],
    ["YouTube", "07 街頭インタビュー", "webm"],
  ] as const
).map(([relDir, name, ext], i) => ({
  path: `${root}/${relDir}/${name}.${ext}`,
  name,
  relDir,
  size: 1e6 * (i + 1),
  kind: ext === "mp4" ? "video" : ext === "webm" ? "unsupported" : "audio",
}));
const VIDEO_SECS = 60;

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
// Who says each line when a transcription tells voices apart: a dialogue with uneven turns.
const turns = [0, 1, 1, 0, 1, 0, 0, 1, 0, 1];
// What a transcription was unsure of, by sentence: 傘, 予報, ピクニック.
const unsure: Record<number, [number, number][]> = { 3: [[0, 1]], 10: [[2, 4]], 20: [[8, 13]] };
// When each character is said, as a transcription times them: evenly through the sentence here.
const charTimes = (text: string, start: number, end: number): [number, number][] => {
  const letters = [...text.matchAll(/[\p{L}\p{N}]/gu)].map((m) => m.index);
  return letters.map((o, k) => [o, Math.round((start + ((end - start - 0.4) * k) / letters.length) * 100) / 100]);
};
/** `transcribed`: voices told apart, unsure words and character times, as a transcription has. */
const mockTranscript = (origin: string, count: number, transcribed = false): Transcript => ({
  source: "imported",
  origin,
  sentences: Array.from({ length: count }, (_, i) => {
    const [start, end, text] = [2 + i * 6, 2 + i * 6 + 4.2, lines[i % lines.length]];
    return { start, end, text, ...(transcribed ? { speaker: turns[i % turns.length], unsure: unsure[i], times: charTimes(text, start, end) } : {}) };
  }),
});
const transcripts = new Map<string, Transcript>([
  [tracks[1].path, { ...mockTranscript("02 天気の話.srt", 32), source: "sidecar" }],
  // The video: a transcription's sentences, lit a character at a time under the picture.
  [tracks[5].path, mockTranscript("本机 · large-v3-turbo-q8_0", 9, true)],
  // Transcribed earlier, with two voices told apart, in three sections (one named).
  [
    tracks[3].path,
    {
      ...mockTranscript("本机 · large-v3-turbo-q8_0", 24, true),
      source: "transcribed",
      sections: [{ start: 0 }, { start: 7, title: "駅まで一緒に" }, { start: 15 }],
    },
  ],
]);

for (const [path, t] of sampleTranscripts) transcripts.set(path, t);
if (!fresh) seedTakes(tracks[1].path, transcripts.get(tracks[1].path)!.sentences[2]);
const durationOf = (path: string) =>
  path.startsWith("/App/samples/") ? 32.7 : path.endsWith(".mp4") ? VIDEO_SECS : 180 + tracks.findIndex((t) => t.path === path) * 20;

// AI settings: a trimmed copy of the Rust presets; "bad" as a key fails the test, LM Studio is "not running".
const cloud: Omit<Preset, "id" | "name" | "baseUrl"> = { api: "openAi", local: false, key: "required", keyUrl: "https://example.com", features: ["chat"], transcribeModel: null, transcribePrices: [], chatModel: null, note: "" };
// ?platform=windows previews Windows: no transcribing on the computer itself there, so no "local" preset.
const allPresets: Preset[] = [
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
const presets = allPresets.filter((p) => !(isWindows && p.id === "local"));
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

// Local models: downloads take ~5 s; turbo q5 is "already downloaded" (on a Mac).
const localModels = [
  { id: "large-v3-turbo-q5_0", name: "Large v3 Turbo（压缩）", size: 574e6, memoryGb: 1, note: "速度和准确度平衡，日语、英语都不错", downloaded: !isWindows, partial: 0, fit: "good" as const },
  { id: "large-v3-turbo-q8_0", name: "Large v3 Turbo", size: 874e6, memoryGb: 1.3, note: "比压缩版略准一点，速度差不多", downloaded: false, partial: 0, fit: "good" as const },
  { id: "large-v3", name: "Large v3", size: 3.1e9, memoryGb: 3.9, note: "最准（尤其日语），但慢很多", downloaded: false, partial: 9e8, fit: "tight" as const },
  { id: "small-q5_1", name: "Small", size: 190e6, memoryGb: 0.6, note: "很快、很小，但日语错误较多，适合先试试", downloaded: false, partial: 0, fit: "good" as const },
];
let downloading: { id: string; timer: number; cancelled: boolean } | null = null;
const localOverview = () => ({ supported: !isWindows, chip: isWindows ? "" : "Apple M2 Pro", ramGb: 16, freeBytes: 120e9, recommended: "large-v3-turbo-q8_0", reason: "16 GB 内存，选比压缩版略准的 Turbo", models: localModels, downloading: downloading?.id ?? null });
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
function mockTranscribe(path: string, language: string, keep: boolean) {
  if (!aiConfig.transcribe.provider) throw "还没有设置转写服务";
  if (job) throw "已经有一个音频在转写，请等它完成";
  const total = durationOf(path);
  let done = 0;
  const status = (s: object) => void emit("transcribe:status", { path, ...s });
  job = {
    path,
    cancelled: false,
    timer: window.setInterval(() => {
      if (job?.cancelled) return finish({ state: "cancelled" });
      done = Math.min(total, done + total / 8);
      if (language === "xx" && done > total / 2) return finish({ state: "failed", message: "Groq 额度不足或请求太频繁（429）" });
      // The last stretch stands in for telling the voices apart.
      if (done < total) return status({ state: "running", step: done > total * 0.7 ? "speakers" : "transcribe", done, total });
      const origin = `${presets.find((p) => p.id === aiConfig.transcribe.provider)?.name} · ${aiConfig.transcribe.model}`;
      const transcript = { ...(transcripts.get(path) ?? mockTranscript(origin, 28, keep)), origin, source: "transcribed" as const };
      if (keep) transcripts.set(path, transcript);
      finish({ state: "done", transcript, saved: keep });
    }, 500),
  };
  function finish(s: object) {
    window.clearInterval(job!.timer);
    job = null;
    status(s);
  }
}

// Proofreading: two parts of fake progress, then a couple of demonstration suggestions.
let proofreading = 0;
async function mockProofread(path: string): Promise<Suggestion[]> {
  if (!aiConfig.chat.provider) throw "还没有设置「句子解释」用的 AI 服务";
  const run = ++proofreading;
  for (const done of [0, 1]) {
    void emit("proofread:progress", { path, done, total: 2 });
    await new Promise((r) => setTimeout(r, 1200));
    if (run !== proofreading) throw "已取消";
  }
  const sentences = transcripts.get(path)?.sentences ?? [];
  const at = (word: string) => sentences.findIndex((s) => s.text.includes(word));
  return [
    { index: at("傘"), from: "傘", to: "笠", reason: "（演示）读音相同的另一个字" },
    { index: at("公園"), from: "公園", to: "講演", reason: "（演示）前后说的是去听讲座" },
  ].filter((s) => s.index >= 0);
}

// Explaining a sentence: a pause, then a demonstration answer (the third sentence fails once).
let explainFailed = false;
const keptExplanations = new Map<string, SavedExplanation[]>();
async function mockExplain(path: string, index: number, text: string): Promise<Explanation> {
  if (!aiConfig.chat.provider) throw "还没有设置「句子解释」用的 AI 服务";
  await new Promise((r) => setTimeout(r, 900));
  if (text.includes("傘") && !explainFailed) {
    explainFailed = true;
    throw "请求超时了，请再试一次";
  }
  const value: Explanation = {
    source: "本机 Ollama · gemma4:12b",
    translation: `（演示）${text.length} 个字的句子，翻译会写在这里。`,
    tone: "随意地提议",
    parts: [
      { text: "今日は", reading: "きょうは", meaning: "今天", note: "" },
      { text: "ちょっと", reading: "", meaning: "稍微", note: "让提议显得随意" },
      { text: "散歩に", reading: "さんぽに", meaning: "去散步", note: "に 表示去的目的" },
      { text: "行こっか", reading: "いこっか", meaning: "去吧？", note: "= 行こうか，口语缩约，轻松地提议" },
      { text: "んだから", reading: "", meaning: "", note: "说明理由，带点埋怨：「都怪你…嘛」" },
    ],
  };
  keptExplanations.set(path, [...(keptExplanations.get(path) ?? []).filter((k) => k.index !== index), { index, text, explanation: value }]);
  return value;
}

const player = { path: null as string | null, time: 0, duration: 0, playing: false, rate: 1, a: null as number | null, b: null as number | null, repeats: 0, stop: null as number | null };
let seq = 0;
const status = () => ({ path: player.path, time: player.time, duration: player.duration, playing: player.playing, repeats: player.repeats, seq: ++seq });
const push = () => void emit("player:status", status());

/** Like the engine's hold: a recording paused pauses the track, a range keeping its end; going on plays it
 *  on if it was playing (and nothing has moved it since). Returns, going on, whether it does. */
let [held, recordingPaused] = [false, false];
function holdTrack(paused: boolean): boolean {
  const going = !paused && held;
  [held, recordingPaused] = [paused && player.playing, paused];
  if (paused || going) Object.assign(player, { playing: going }), push();
  return going;
}

setInterval(() => {
  if (!player.playing) return;
  // Practice time like Rust's clock, sped up 60× so the goal ring visibly fills (a second plays as a minute).
  const live = practiceLog.at(-1);
  if (live && live.audio === player.path && Date.now() - live.end < 90_000) {
    live.end += 3000;
    live.played += 3000;
  } else if (player.path) practiceLog.push({ audio: player.path, start: Date.now(), end: Date.now(), played: 0 });
  const next = player.time + 0.05 * player.rate;
  if (player.stop !== null && next >= player.stop) {
    Object.assign(player, { time: player.stop, stop: null, playing: false });
  } else if (player.a !== null && player.b !== null && player.time < player.b && next >= player.b) {
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

// Five months of practice: most days 5–45 minutes, some days off, today in progress. Empty with ?fresh.
const practiceLog: PracticeSession[] = [];
{
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const today = new Date();
  for (let back = 150; back >= 0; back--) {
    if (fresh || (back > 0 && rand() < (back > 60 ? 0.45 : 0.2))) continue;
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, 7 + Math.floor(rand() * 14));
    let start = Math.min(day.getTime(), Date.now() - 30 * 60_000);
    for (let n = 1 + Math.floor(rand() * 3); n > 0; n--) {
      const length = (4 + rand() * 25) * 60_000;
      const audio = tracks[Math.floor(rand() * rand() * tracks.length)].path;
      practiceLog.push({ audio, start, end: start + length, played: length * (0.55 + rand() * 0.35) });
      start += length + (20 + rand() * 120) * 60_000;
    }
  }
}

export function installMockBackend() {
  const snapshot: Snapshot = {
    folder: fresh ? null : { root, name: "日本語ポッドキャスト", tracks },
    missingFolder: null,
    lastTrack: fresh ? null : tracks[1].path,
    settings: { rate: 0.85, playMode: "next", seekStep: 5, transcribeLanguage: "", dailyGoals: [{ since: "2026-01-01", minutes: 30 }], recordMode: "listen", recordReplay: true, paragraphMode: "read", paragraphDrill: false, drillRounds: 3, wordHighlight: true, recordDub: false, importVideo: 0, pictureHeight: 300, pictureLayout: "side", pictureMask: false, maskTop: 0.74, maskBottom: 0.96, pictureHidden: false, annotations: true, paceOn: false, pauseMode: "length", pauseSeconds: 2, pauseRatio: 1.5, sentenceRepeats: 1, shortcuts: {}, mediaKeys: true, uiLanguage: "" },
    progress: {
      [tracks[0].path]: { position: 178, duration: 180, updatedAt: 0 },
      [tracks[1].path]: { position: 64, duration: 200, updatedAt: 0 },
    },
    guide: { welcomed: !fresh, language: fresh ? "" : "ja", practiced: !fresh, tips: [], seenVersion: "" },
    // ?en shows the interface in English.
    uiLang: new URLSearchParams(location.search).has("en") ? "en" : "zh",
    // Every video is the test pattern here: the path after "#" is a fragment, which loading ignores.
    mediaBase: `${mockVideo}#`,
  };
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, never>;
      if (cmd === "record_play") Object.assign(player, { playing: false }), push(); // the take plays over the paused track
      if (cmd === "record_pause") return mockRecord(cmd, a).then(() => holdTrack(a.paused));
      if (/^player_(load|unload|play|pause|toggle|seek)/.test(cmd)) held = false;
      // A paused recording ending: the original held for it won't go on (as if paused there).
      if (/^record_(begin|cancel|finish)$/.test(cmd) && recordingPaused) [held, recordingPaused, player.stop] = [false, false, null];
      if (cmd.startsWith("record_")) return mockRecord(cmd, a);
      if (/^(plugins_|import_|rescan_folder$)/.test(cmd)) return mockPlugins(cmd, a, snapshot.folder);
      switch (cmd) {
        case "get_snapshot":
          return snapshot;
        case "set_ui_language":
          return a.language || snapshot.uiLang;
        case "player_load":
          Object.assign(player, { path: a.path, time: a.startAt, duration: durationOf(a.path), playing: a.autoplay, a: null, b: null, repeats: 0 });
          return status();
        case "player_play":
        case "player_pause":
        case "player_toggle":
          player.playing = cmd === "player_toggle" ? !player.playing : cmd === "player_play";
          // Like the engine: playing after the end starts over; pausing ends a range; playing stops a take.
          if (player.playing && player.time >= player.duration) player.time = 0;
          if (!player.playing) player.stop = null;
          if (cmd !== "player_pause") stopClip();
          return status();
        case "player_seek":
          Object.assign(player, { time: a.time, stop: null });
          return status();
        case "player_play_range":
          Object.assign(player, { time: a.a, stop: a.b, playing: true });
          return status();
        case "player_end_range":
          player.stop = null;
          return;
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
        case "transcript_proofread":
          return mockProofread(a.path);
        case "sentence_explain":
          return mockExplain(a.path, a.index, a.text);
        case "sentence_explanations":
          return [...(keptExplanations.get(a.path) ?? [])];
        case "transcript_proofread_cancel":
          proofreading++;
          return;
        case "transcript_edit": {
          const t = transcripts.get(a.path);
          if (!t) throw "这个音频没有字幕";
          const sentences = [...t.sentences];
          // Character times aren't moved with the text here (timing.rs does that): the sentence is lit whole.
          for (const e of a.edits as SentenceEdit[]) {
            sentences[e.index] = { ...sentences[e.index], text: e.text.trim(), unsure: e.unsure?.length ? e.unsure : undefined, times: undefined };
          }
          const edited: Transcript = { ...t, sentences, edited: true, source: t.source === "sidecar" ? "imported" : t.source };
          transcripts.set(a.path, edited);
          return edited;
        }
        case "transcript_split":
        case "transcript_merge":
        case "transcript_restore":
          return mockReshape(cmd, a, transcripts, keptExplanations);
        case "transcript_sections": {
          const t = transcripts.get(a.path);
          if (!t) throw "这个音频没有字幕";
          const sections = (a.sections as Section[]).filter((x) => x.start < t.sentences.length).sort((x, y) => x.start - y.start);
          const saved: Transcript = { ...t, sections, source: t.source === "sidecar" ? "imported" : t.source };
          transcripts.set(a.path, saved);
          return saved;
        }
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
          return mockTranscribe(a.path, a.language, a.keep);
        case "sample_track":
          return samples[a.language === "ja" ? "ja" : "en"];
        case "guide_save":
          snapshot.guide = a.guide;
          return;
        case "choose_folder":
          return { root, name: "日本語ポッドキャスト", tracks };
        case "transcribe_cancel":
          if (job) job.cancelled = true;
          return;
        case "transcribe_running":
          return job?.path ?? null;
        case "practice_log":
          return practiceLog.filter((s) => s.end >= (a.since ?? 0) && (!a.audio || s.audio === a.audio));
        case "practice_ping":
        case "now_playing":
          return null;
        case "smoke_mode":
          return false;
        case "plugin:app|version":
          return "0.3.0";
        // A newer version is always out; installing downloads for a few seconds, then can't relaunch a browser tab.
        case "update_check":
          return { version: "0.4.0", current: "0.3.0", notes: "### 新增\n- 应用内更新：打开时检查，菜单和设置里也能手动检查。\n- 学习记录：今天、最近 7 天练了多久。\n\n### 修复\n- 第三条\n- 第四条\n- 第五条" };
        case "update_install":
          return (async () => {
            const total = 11_000_000;
            for (let done = 0; done <= total; done += 1_100_000) {
              void emit("update:progress", { done, total });
              await new Promise((r) => setTimeout(r, 250));
            }
            throw "更新失败：浏览器里没法重新打开应用（mock）";
          })();
        default:
          return null; // save_progress, save_settings, set_last_track, choose_folder…
      }
    },
    { shouldMockEvents: true },
  );
}
