// Browser-only fake backend for UI work: `npm run dev` then open localhost:1420.
// Simulates the Rust commands and player:* events; no real audio.
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Snapshot, Track, Transcript } from "../lib/api";

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
        case "smoke_mode":
          return false;
        default:
          return null; // save_progress, save_settings, set_last_track, choose_folder…
      }
    },
    { shouldMockEvents: true },
  );
}
