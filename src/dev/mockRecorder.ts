// Browser-only fake of 跟读录音 (src-tauri/src/record) for UI work: a pretend
// voice that starts after your turn begins and stops ~a sentence later, takes
// with made-up waveforms, and clip playback that only moves the playhead.
import { emit } from "@tauri-apps/api/event";
import type { ClipPart, Finished, Playing, Reading, ReadingPlaying, ReadingWhat, RecordMeta, Take, TakePart } from "../lib/api";

const takes = new Map<string, Take[]>();
const readings = new Map<string, Reading[]>();
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

/**
 * `from`: when this time through began (record_round starts another); `done`: it has stopped by itself.
 * Said again and again (连续录), the pretend learner talks the first `QUIET_FROM - 1` times, then
 * says nothing, which stops it: `round` counts them, `voiced` says whether this one had a voice,
 * `kept` whether one before did (put aside, as Rust does).
 */
let session: { meta: RecordMeta; timer: number; turnAt: number | null; t: number; from: number; done: boolean; round: number; voiced: boolean; kept: boolean } | null = null;
const QUIET_FROM = 4;

/** A paragraph: 自己读 moves the highlight a sentence at a time, then finishes; 跟着原文读 finishes once the original has. */
function beginReading(meta: RecordMeta) {
  const list = meta.sentences!;
  let i = 0;
  let next = (list[0].end - list[0].start) * 1.15 + 0.6;
  session = {
    meta,
    turnAt: null,
    t: 0,
    from: 0,
    done: false,
    round: 1,
    voiced: true,
    kept: false,
    timer: window.setInterval(() => {
      const s = session!;
      s.t += 0.033;
      const talking = Math.sin(s.t * 9) > -0.3;
      void emit("recorder:level", { level: talking ? 0.5 + rand() * 0.4 : 0.08, speaking: talking, secs: s.t });
      if (meta.mode === "read" && s.t > next) {
        if (++i >= list.length) {
          window.clearInterval(s.timer);
          void emit("recorder:auto", "pause");
          return;
        }
        void emit("recorder:sentence", i);
        next += (list[i].end - list[i].start) * 1.15 + 0.5;
      }
      if (meta.mode === "shadow" && s.turnAt !== null && s.t - s.turnAt > 1.2) {
        window.clearInterval(s.timer);
        void emit("recorder:auto", "pause");
      }
    }, 33),
  };
}

function makeReading(meta: RecordMeta, created: number): Finished {
  const id = String(created);
  const list = meta.sentences!;
  const lag = meta.mode === "shadow" ? 0.42 : 0;
  let at = 0.25;
  const parts = list.map((x, i) => {
    const len = ((x.end - x.start) / (meta.mode === "read" ? 1 : meta.rate)) * (meta.mode === "read" ? 1.1 + rand() * 0.1 : 1);
    const mine: [number, number] = [at + lag, at + lag + len];
    at += len + (meta.mode === "read" ? 0.45 : (list[i + 1]?.start ?? x.end) - x.end);
    const skipped = meta.mode === "read" && i === 3; // one sentence left out, to see how it shows
    return { start: x.start, end: x.end, mine, take: skipped ? null : `${id}-${i}` };
  });
  const sentenceTakes: Take[] = parts
    .map((p, i): Take | null => (p.take ? { ...makeTake({ ...meta, start: p.start, end: p.end, text: list[i].text, mode: meta.mode === "read" ? "listen" : "shadow" }, created), id: p.take, mode: meta.mode, group: id } : null))
    .filter((t): t is Take => !!t);
  const duration = at + lag + 0.4;
  const peaks: number[] = Array(Math.round(duration * 50)).fill(0);
  for (const p of parts) if (p.take) voice(p.mine[1] - p.mine[0], 0, 0.8).forEach((v, k) => (peaks[Math.round(p.mine[0] * 50) + k] = v));
  const reading: Reading = {
    id, created, start: list[0].start, end: list[list.length - 1].end, mode: meta.mode === "read" ? "read" : "shadow", rate: meta.mode === "read" ? 1 : meta.rate, duration, parts,
    originalSecs: list.reduce((a, x) => a + x.end - x.start, 0) / (meta.mode === "read" ? 1 : meta.rate),
    mineSecs: parts[parts.length - 1].mine[1] - parts[0].mine[0],
    lagMs: meta.mode === "shadow" ? 420 : null,
    peaks,
  };
  takes.set(meta.audio, [...(takes.get(meta.audio) ?? []), ...sentenceTakes]);
  readings.set(meta.audio, [...(readings.get(meta.audio) ?? []), reading]);
  return { takes: sentenceTakes, reading };
}

function playReading(audio: string, id: string, what: ReadingWhat): ReadingPlaying {
  const r = readings.get(audio)?.find((x) => x.id === id);
  if (!r) throw "这次朗读不见了";
  const stretches: ReadingPlaying["stretches"] = [];
  if (what === "turns") {
    let at = 0;
    r.parts.forEach((p, part) => {
      if (!p.take) return;
      const o = p.end - p.start;
      stretches.push({ clipAt: at, len: o, part, lane: "original" });
      at += o + 0.3;
      const m = p.mine[1] - p.mine[0];
      stretches.push({ clipAt: at, len: m, part, lane: "mine" });
      at += m + 0.7;
    });
  } else r.parts.forEach((p, part) => p.take && stretches.push({ clipAt: p.mine[0], len: p.mine[1] - p.mine[0], part, lane: what === "mine" ? "mine" : "both" }));
  const last = stretches[stretches.length - 1];
  const duration = last ? last.clipAt + last.len : 0;
  return { ...startClip(duration), stretches };
}

function begin(meta: RecordMeta) {
  stop();
  if (meta.sentences?.length) return beginReading(meta);
  session = {
    meta,
    turnAt: null,
    t: 0,
    from: 0,
    done: false,
    round: 1,
    voiced: false,
    kept: false,
    timer: window.setInterval(() => {
      const s = session!;
      s.t += 0.033;
      const said = (s.meta.end - s.meta.start) / s.meta.rate;
      const since = s.turnAt === null ? -1 : s.t - s.turnAt;
      // Listen: you start 0.6 s into your turn and talk a little longer than the original.
      // Shadow: you start 0.4 s after the original and finish 0.45 s after it.
      const [voice, quietFor] =
        meta.mode === "listen"
          ? [since > 0.6 && since < 0.6 + said * 1.1, since - 0.6 - said * 1.1]
          : [s.t - s.from > 0.4 && (since < 0 || since < 0.45), since < 0 ? -1 : since - 0.45];
      const talking = voice && s.round < QUIET_FROM;
      s.voiced ||= talking;
      const level = talking ? 0.55 + rand() * 0.4 : 0.08 + rand() * 0.05;
      void emit("recorder:level", { level, speaking: talking, secs: Math.max(0, since) });
      // Like the mic, it stays open after stopping by itself: another time through may follow.
      // Nothing said after the original (听完再说) waits a while, as Rust does (shorter here).
      const nothing = meta.mode === "listen" && !s.voiced && since > 3;
      const pause = meta.mode === "shadow" ? 0.6 : 0.8;
      if (since > 0 && (nothing || (s.voiced || meta.mode === "shadow") && quietFor > pause) && !s.done) {
        s.done = true;
        void emit("recorder:auto", nothing ? "nothing" : "pause");
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
/** Pretend two tracks' audio has gone missing, to see the clean-up in the settings. */
let space = { bytes: 86_400_000, missingTracks: 2, missingBytes: 12_300_000 };
function play(audio: string, id: string, what: TakePart): Playing {
  const take = takes.get(audio)?.find((t) => t.id === id);
  if (!take) throw "这条录音不见了";
  window.clearInterval(clipTimer);
  const p = parts(take, what);
  const last = p[p.length - 1];
  return { ...startClip(last.clipAt + last.to - last.from), parts: p };
}

function startClip(duration: number) {
  window.clearInterval(clipTimer);
  const id = ++clip;
  const started = performance.now();
  // Its own timer: the end can start the next clip (listening on) before this one stops.
  const timer = window.setInterval(() => {
    const secs = (performance.now() - started) / 1000;
    const playing = secs < duration;
    if (!playing) {
      window.clearInterval(timer);
      if (clipTimer === timer) clipTimer = 0;
    }
    void emit("recorder:clip", { clip: id, secs, playing, ended: !playing });
  }, 33);
  clipTimer = timer;
  return { clip: id, duration };
}

/** Like the engine: stopping a clip (record_stop, or playing the track) isn't its end. */
export function stopClip() {
  if (!clipTimer) return;
  window.clearInterval(clipTimer);
  clipTimer = 0;
  void emit("recorder:clip", { clip, secs: 0, playing: false, ended: false });
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
    case "record_round": {
      if (!session) throw "录音已经停了，再录一次吧";
      await new Promise((r) => setTimeout(r, 150)); // removing the echo
      const voiced = session.voiced;
      Object.assign(session, { from: session.t, turnAt: null, done: false, round: session.round + 1, voiced: false, kept: session.kept || voiced });
      return voiced;
    }
    case "record_cancel":
      stop();
      return null;
    case "record_finish": {
      const [voiced, kept] = [session?.voiced, session?.kept];
      const meta = stop();
      if (!meta) return { takes: [], reading: null };
      if (!meta.sentences?.length && !voiced && !kept) throw meta.mode === "shadow" ? "没听到你的声音：原句一放就跟着说，再试一次？" : "没听到你的声音，再试一次？";
      await new Promise((r) => setTimeout(r, meta.mode === "shadow" ? 700 : 300));
      if (meta.sentences?.length) return makeReading(meta, Date.now());
      const take = makeTake(meta, Date.now(), 0.95 + rand() * 0.3);
      takes.set(meta.audio, [...(takes.get(meta.audio) ?? []), take]);
      return { takes: [take], reading: null };
    }
    case "record_step":
      return null;
    case "record_readings":
      return readings.get(a.audio) ?? [];
    case "record_delete_reading":
      readings.set(a.audio, (readings.get(a.audio) ?? []).filter((r) => r.id !== a.id));
      takes.set(a.audio, (takes.get(a.audio) ?? []).filter((t) => t.group !== a.id));
      return null;
    case "record_play_reading":
      return playReading(a.audio, a.id, a.what);
    case "record_takes":
      return takes.get(a.audio) ?? [];
    case "record_delete":
      takes.set(a.audio, (takes.get(a.audio) ?? []).filter((t) => t.id !== a.id));
      return null;
    case "record_play":
      return play(a.audio, a.id, a.what);
    case "record_stop":
      stopClip();
      return null;
    case "record_space":
      return space;
    case "record_clear_missing":
      space = { bytes: space.bytes - space.missingBytes, missingTracks: 0, missingBytes: 0 };
      return space;
  }
  return undefined;
}
