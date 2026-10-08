// Debug-only scripted check that runs inside the real app.
// Started by `npm run smoke -- <folder>` (see src-tauri/src/smoke.rs).
// Prints PASS/FAIL lines; precise numbers come from Rust's player_status.
import { api, devLog } from "../lib/api";
import { debugEngine, useApp } from "../store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    if (await pred()) return true;
    await sleep(20);
  }
  return pred();
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  devLog(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

export async function runSmoke() {
  try {
    await scenario();
  } catch (err) {
    devLog(`FAIL smoke crashed — ${err}`);
    failures++;
  }
  devLog(`smoke done: ${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  await api.smokeFinish(failures === 0 ? 0 : 1);
}

async function scenario() {
  const app = useApp.getState;
  const engine = debugEngine!;
  const rust = async () => (await engine.statusNow()).time;
  engine.setVolume(0.05);
  const tracks = app().folder?.tracks ?? [];
  devLog(`smoke: ${tracks.length} tracks: ${tracks.map((t) => `${t.relDir}/${t.name}`).join(" | ")}`);
  check("scan finds 5 audio files, skips .txt", tracks.length === 5);

  // 1. Every format loads and plays.
  for (const t of tracks) {
    app().open(t, true);
    const started = await waitFor(async () => (await rust()) > 0.4 || !!app().error, 5000);
    check(`plays ${t.name}`, started && !app().error, app().error ?? `t=${(await rust()).toFixed(2)} d=${engine.duration.toFixed(1)}`);
  }

  const long = tracks.find((t) => t.name.includes("Long"))!;
  app().open(long, true);
  await waitFor(async () => (await rust()) > 0.2, 5000);

  // 2. Seek accuracy and how fast playback resumes after a jump.
  for (const target of [300, 120, 50]) {
    app().seek(target);
    const w0 = performance.now();
    await waitFor(async () => (await rust()) > target + 0.02, 3000);
    const resumed = performance.now() - w0;
    check(`seek ${target}s resumes < 150ms`, resumed < 150, `${resumed.toFixed(0)}ms`);
  }

  // 3. Speed: Rust-reported media time vs wall clock.
  for (const rate of [0.75, 1.5]) {
    app().setRate(rate);
    await sleep(500);
    const t0 = await rust();
    const w0 = performance.now();
    await sleep(3000);
    const ratio = ((await rust()) - t0) / ((performance.now() - w0) / 1000);
    check(`rate ${rate}`, Math.abs(ratio - rate) < 0.03, `measured ${ratio.toFixed(3)}`);
  }
  app().setRate(1);

  // 4. A–B loop: wall-clock cycle length must equal (B − A) / rate — no gap.
  const loopCase = async (label: string, a: number, b: number, seconds: number, rate = 1) => {
    app().setRate(rate);
    app().seek(a);
    await sleep(300);
    app().cycleLoop();
    app().seek(b);
    await sleep(30);
    app().cycleLoop();
    const loop = app().loop;
    const cycles: number[] = [];
    let maxPastB = 0;
    let prev = await rust();
    let lastWrap = performance.now();
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      const t = await rust();
      if (t < prev - 0.3) {
        const now = performance.now();
        cycles.push((now - lastWrap) / 1000);
        lastWrap = now;
      }
      if (loop.b !== null) maxPastB = Math.max(maxPastB, t - loop.b);
      prev = t;
      await sleep(5);
    }
    app().clearLoop();
    app().setRate(1);
    const len = ((loop.b ?? 0) - (loop.a ?? 0)) / rate;
    const steady = cycles.slice(1);
    const worst = steady.length ? Math.max(...steady.map((c) => Math.abs(c - len))) : NaN;
    check(
      `loop ${label}`,
      steady.length >= 2 && worst < 0.06 && maxPastB < 0.05,
      `len ${len.toFixed(2)}s cycles [${cycles.map((c) => c.toFixed(2)).join(", ")}] worst deviation ${(worst * 1000).toFixed(0)}ms, max past B ${(maxPastB * 1000).toFixed(0)}ms`,
    );
  };

  await loopCase("VBR mp3 (long)", 100, 102.5, 10);
  await loopCase("VBR mp3 at 0.75×", 100, 102.5, 10, 0.75);
  for (const t of tracks.filter((t) => !t.name.includes("Long"))) {
    app().open(t, true);
    await waitFor(async () => (await rust()) > 0.2, 5000);
    await loopCase(t.name, 1, 3, 7);
  }

  // 5. Loop keeps working while the window is minimized.
  app().open(long, true);
  await waitFor(async () => (await rust()) > 0.2, 5000);
  await api.smokeWindow(true);
  await sleep(1000);
  await loopCase("while minimized", 100, 102.5, 10);
  await api.smokeWindow(false);

  // 6. Progress is persisted and resume rewinds 2s.
  app().seek(200);
  await sleep(500);
  app().toggle(); // pause → forced save
  await waitFor(() => !app().playing, 2000);
  await sleep(300);
  const snap = await api.getSnapshot();
  const saved = snap.progress[long.path];
  check("progress saved on pause", !!saved && Math.abs(saved.position - 200.5) < 1.5, `saved=${saved?.position.toFixed(2)}`);
  check("last track remembered", snap.lastTrack === long.path);
  app().open(tracks[0], false);
  await sleep(500);
  app().open(long, false);
  await waitFor(() => engine.duration > 0, 3000);
  await sleep(300);
  const resumed = await rust();
  check("resume ≈ saved − 2s", Math.abs(resumed - (saved!.position - 2)) < 0.5, `t=${resumed.toFixed(2)}`);

  // 7. Natural end advances to the next track when auto-advance is on.
  app().open(tracks[0], true);
  await waitFor(() => engine.duration > 0, 3000);
  app().seek(engine.duration - 0.5);
  const advanced = await waitFor(() => app().current?.path === tracks[1].path, 4000);
  check("auto-advance to next track at end", advanced, `now ${app().current?.name}`);

  // 8. A subtitle file next to the audio becomes its transcript; a sentence loop repeats it.
  const english = tracks.find((t) => t.name === "02 English VBR")!;
  app().open(english, true);
  await waitFor(() => !!app().transcript && engine.duration > 0, 3000);
  const transcript = app().transcript;
  check(
    "sidecar .srt loads as transcript",
    transcript?.source === "sidecar" && transcript.sentences.length === 2,
    `${transcript?.origin} · ${transcript?.sentences.length} sentences`,
  );
  if (transcript) {
    app().toggleSentenceLoop(1);
    const { a, b } = app().loop;
    let wrapped = false;
    let prev = await rust();
    const until = performance.now() + ((b ?? 0) - (a ?? 0) + 1.5) * 1000;
    while (!wrapped && performance.now() < until) {
      const t = await rust();
      wrapped = t < prev - 0.3;
      prev = t;
      await sleep(10);
    }
    check("sentence loop repeats sentence 2", wrapped && app().loopSentence === 1, `A ${a?.toFixed(2)} B ${b?.toFixed(2)}`);
    app().stepSentence(-1);
    check("[ moves the loop to sentence 1", app().loopSentence === 0 && app().loop.a === 0, `A ${app().loop.a}`);
    app().clearLoop();
  }

  // 9. AI settings round-trip through Rust (smoke runs use an in-memory key store, no network).
  let config = await api.ai.setKey("groq", "gsk_smoke_0123456789abcd");
  check("API key saved, only a hint comes back", config.keyHints.groq === "gsk…abcd" && !JSON.stringify(config).includes("0123456789"));
  config = await api.ai.choose("transcribe", "groq", "whisper-large-v3");
  const reread = await api.ai.get();
  check("feature choice persisted", reread.config.transcribe.provider === "groq" && reread.config.transcribe.model === "whisper-large-v3");
  const refused = await api.ai.choose("transcribe", "anthropic", "x").then(() => "", String);
  check("provider without transcription refused", refused.includes("不支持"), refused);
  const noKey = await api.ai.models("openai", "chat").then(() => "", String);
  check("missing key reported before any request", noKey.includes("API Key"), noKey);
  config = await api.ai.setKey("groq", "");
  check("API key deleted", !config.keyHints.groq);
}
