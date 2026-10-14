// Browser-only fake of 跟读录音 (src-tauri/src/record) for UI work: a pretend
// voice that starts after your turn begins and stops ~a sentence later, takes
// with made-up waveforms, and clip playback that only moves the playhead.
import { emit } from "@tauri-apps/api/event";
import type { ClipPart, Playing, RecordMeta, Take, TakePart } from "../lib/api";

const takes = new Map<string, Take[]>();
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Syllable-ish bumps: `secs` of loudness outline at 50 a second, `lead` of silence first. */
function voice(secs: number, lead: number, loud = 1): number[] {
  const out = Array<number>(Math.round(lead * 50)).fill(0);
  let phase = 0;
  for (let i = 0; i < secs * 50; i++) {
    phase += 0.35 + rand() * 0.25;
    const syllable = Math.max(0, Math.sin(phase)) ** 0.7;
    const breath = i / 50 > secs * 0.55 && i / 50 < secs * 0.6 ? 0.1 : 1;
    out.push(Math.round(255 * loud * syllable * breath * (0.45 + rand() * 0.35)));
  }
  return out;
}

function makeTake(meta: RecordMeta, created: number, slower = 1.1): Take {
  const o = (meta.end - meta.start) / meta.rate;
  const m = o * slower;
  if (meta.mode === "listen") {
    const mineAt = 0.1 + o + 0.7;
    return {
      id: String(created), created, start: meta.start, end: meta.end, text: meta.text, mode: "listen", rate: meta.rate,
      duration: mineAt + m + 0.5,
      original: [0.1, 0.1 + o],
      mine: [mineAt - 0.15, mineAt + m + 0.3],
      lagMs: null,
      peaks: { original: voice(o, 0.1, 0.9), mine: [...Array<number>(Math.round(mineAt * 50)).fill(0), ...voice(m, 0, 0.8)] },
    };
  }
  const lag = 0.38 + rand() * 0.1;
  return {
    id: String(created), created, start: meta.start, end: meta.end, text: meta.text, mode: "shadow", rate: meta.rate,
    duration: 0.2 + o + lag + 0.5,
    original: [0.1, 0.1 + o],
    mine: [0.1 + lag - 0.15, 0.1 + lag + o + 0.3],
    lagMs: Math.round(lag * 1000),
    peaks: { original: voice(o, 0.1, 0.9), mine: voice(o, 0.1 + lag, 0.75) },
  };
}

/** One take already there, so the card shows history: the third sentence of 02. */
export function seedTakes(audio: string, sentence: { start: number; end: number; text: string }) {
  const meta = { audio, ...sentence, mode: "listen" as const, rate: 0.85 };
  takes.set(audio, [makeTake(meta, Date.now() - 26 * 60 * 60_000, 1.35), makeTake(meta, Date.now() - 2 * 60 * 60_000, 1.12)]);
}

let session: { meta: RecordMeta; timer: number; turnAt: number | null; t: number } | null = null;

function begin(meta: RecordMeta) {
  stop();
  session = {
    meta,
    turnAt: null,
    t: 0,
    timer: window.setInterval(() => {
      const s = session!;
      s.t += 0.033;
      const said = (s.meta.end - s.meta.start) / s.meta.rate;
      const since = s.turnAt === null ? -1 : s.t - s.turnAt;
      // Listen: you start 0.6 s into your turn and talk a little longer than the original.
      // Shadow: you start 0.4 s after the original and finish 0.45 s after it.
      const [talking, quietFor] =
        meta.mode === "listen"
          ? [since > 0.6 && since < 0.6 + said * 1.1, since - 0.6 - said * 1.1]
          : [s.t > 0.4 && (since < 0 || since < 0.45), since < 0 ? -1 : since - 0.45];
      const level = talking ? 0.55 + rand() * 0.4 : 0.08 + rand() * 0.05;
      void emit("recorder:level", { level, speaking: talking, secs: Math.max(0, since) });
      if (since > 0 && quietFor > 0.8) {
        window.clearInterval(s.timer);
        void emit("recorder:auto", "pause");
      }
    }, 33),
  };
}

function stop() {
  if (session) window.clearInterval(session.timer);
  const meta = session?.meta;
  session = null;
  return meta;
}

function parts(take: Take, what: TakePart): ClipPart[] {
  const [o, m] = [take.original, take.mine];
  switch (what) {
    case "original":
      return [{ lane: "original", from: o[0], to: o[1], clipAt: 0 }];
    case "mine":
      return [{ lane: "mine", from: m[0], to: m[1], clipAt: 0 }];
    case "compare":
      return [
        { lane: "original", from: o[0], to: o[1], clipAt: 0 },
        { lane: "mine", from: m[0], to: m[1], clipAt: o[1] - o[0] + 0.4 },
      ];
    case "together":
      return [{ lane: "both", from: Math.min(o[0], m[0]), to: Math.max(o[1], m[1]), clipAt: 0 }];
  }
}

let clip = 0;
let clipTimer = 0;
function play(audio: string, id: string, what: TakePart): Playing {
  const take = takes.get(audio)?.find((t) => t.id === id);
  if (!take) throw "这条录音不见了";
  window.clearInterval(clipTimer);
  const p = parts(take, what);
  const last = p[p.length - 1];
  const duration = last.clipAt + last.to - last.from;
  const id_ = ++clip;
  const started = performance.now();
  clipTimer = window.setInterval(() => {
    const secs = (performance.now() - started) / 1000;
    const playing = secs < duration;
    void emit("recorder:clip", { clip: id_, secs, playing });
    if (!playing) window.clearInterval(clipTimer);
  }, 33);
  return { clip: id_, parts: p, duration };
}

/** Handles the record_* commands; undefined for anything else. */
export async function mockRecord(cmd: string, a: Record<string, never>): Promise<unknown> {
  switch (cmd) {
    case "record_begin":
      await new Promise((r) => setTimeout(r, 350));
      begin(a.meta);
      return "MacBook Pro Microphone";
    case "record_turn":
      if (session && session.turnAt === null) session.turnAt = session.t;
      return null;
    case "record_cancel":
      stop();
      return null;
    case "record_finish": {
      const meta = stop();
      if (!meta) return null;
      await new Promise((r) => setTimeout(r, meta.mode === "shadow" ? 700 : 300));
      const take = makeTake(meta, Date.now(), 0.95 + rand() * 0.3);
      takes.set(meta.audio, [...(takes.get(meta.audio) ?? []), take]);
      return take;
    }
    case "record_takes":
      return takes.get(a.audio) ?? [];
    case "record_delete":
      takes.set(a.audio, (takes.get(a.audio) ?? []).filter((t) => t.id !== a.id));
      return null;
    case "record_play":
      return play(a.audio, a.id, a.what);
    case "record_stop":
      window.clearInterval(clipTimer);
      void emit("recorder:clip", { clip, secs: 0, playing: false });
      return null;
  }
  return undefined;
}
