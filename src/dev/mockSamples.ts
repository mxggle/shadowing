// The bundled sample clips as the browser mock sees them (src-tauri/samples).
import type { Track, Transcript } from "../lib/api";

// Bundled practice clips; `?fresh` in the URL starts like a first launch (no folder, welcome screen).
export const fresh = new URLSearchParams(location.search).has("fresh");
export const samples: Record<string, Track> = {
  ja: { path: "/App/samples/ja/ごんぎつね.mp3", name: "ごんぎつね", relDir: "", size: 262313, kind: "audio" },
  en: { path: "/App/samples/en/The Tale of Peter Rabbit.mp3", name: "The Tale of Peter Rabbit", relDir: "", size: 219890, kind: "audio" },
};
const sampleLines: Record<string, [number, number, string][]> = {
  ja: [
    [0.25, 6.25, "これは、私が小さいときに、村の茂平というおじいさんからきいたお話です。"],
    [7.5, 17, "むかしは、私たちの村のちかくの、中山というところに小さなお城があって、中山さまというおとのさまが、おられたそうです。"],
    [18.25, 24.6, "その中山から、少しはなれた山の中に、「ごん狐」という狐がいました。"],
    [25.45, 32.45, "ごんは、一人ぼっちの小狐で、しだの一ぱいしげった森の中に穴をほって住んでいました。"],
  ],
  en: [
    [0.2, 6.1, "Once upon a time there were four little Rabbits, and their names were Flopsy, Mopsy, Cotton-tail, and Peter."],
    [6.8, 11.05, "They lived with their Mother in a sand-bank, underneath the root of a very big fir-tree."],
    [12.15, 19.3, "‘Now my dears,’ said old Mrs. Rabbit one morning, ‘you may go into the fields or down the lane, but don’t go into Mr. McGregor’s garden:"],
    [19.35, 23.25, "your Father had an accident there; he was put in a pie by Mrs. McGregor.’"],
  ],
};
export const sampleTranscripts: [string, Transcript][] = Object.entries(samples).map(([lang, track]) => [
  track.path,
  { source: "sidecar", origin: `${track.name}.srt`, sentences: sampleLines[lang].map(([start, end, text]) => ({ start, end, text })) },
]);
