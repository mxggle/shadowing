// Debug-only scripted check that runs inside the real WKWebView.
// Started by `npm run smoke` (see src-tauri/src/smoke.rs). Prints PASS/FAIL lines.
import { api, devLog, mediaUrl } from "../lib/api";
import { debugEngine, useApp } from "../store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    if (pred()) return true;
    await sleep(25);
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
  engine.setVolume(0.05);
  const tracks = app().folder?.tracks ?? [];
  devLog(`smoke: ${tracks.length} tracks: ${tracks.map((t) => `${t.relDir}/${t.name}`).join(" | ")}`);
  check("scan finds 5 audio files, skips .txt", tracks.length === 5);

  // 1. Every format loads and plays.
  for (const t of tracks) {
    app().open(t, true);
    const started = await waitFor(() => engine.time > 0.4 || !!app().error, 5000);
    check(`plays ${t.name}`, started && !app().error, app().error ?? `t=${engine.time.toFixed(2)} d=${engine.duration.toFixed(1)}`);
  }

  const long = tracks.find((t) => t.name.includes("Long"))!;
  app().open(long, true);
  await waitFor(() => engine.time > 0.2, 5000);

  // 2. Seeking deep into a VBR mp3.
  app().seek(300);
  await sleep(600);
  check("seek to 300s on VBR mp3", Math.abs(engine.time - 300) < 1, `t=${engine.time.toFixed(3)}`);

  // 3. Speed: media time vs wall clock, measured after playback settles.
  for (const rate of [0.75, 1.5]) {
    app().setRate(rate);
    await sleep(1000);
    const t0 = engine.time;
    const w0 = performance.now();
    await sleep(3000);
    const ratio = (engine.time - t0) / ((performance.now() - w0) / 1000);
    check(`rate ${rate}`, Math.abs(ratio - rate) < 0.05, `measured ${ratio.toFixed(3)}`);
  }
  app().setRate(1);

  // 4. Seek → resume latency (how long audio is silent after a jump).
  for (const target of [120, 400, 50]) {
    app().seek(target);
    const w0 = performance.now();
    await waitFor(() => engine.time > target + 0.03, 3000);
    devLog(`seek ${target}s resumed after ${(performance.now() - w0).toFixed(0)}ms`);
  }

  // 5. A–B loop on each format: cycle length should equal B − A (no gap).
  const loopCase = async (label: string, a: number, b: number, seconds: number) => {
    app().seek(a);
    await sleep(300);
    app().cycleLoop();
    app().seek(b);
    await sleep(30);
    app().cycleLoop();
    const loop = app().loop;
    const cycles: number[] = [];
    let maxPastB = 0;
    let prev = engine.time;
    let lastWrap = performance.now();
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      const t = engine.time;
      if (t < prev - 0.5) {
        const now = performance.now();
        cycles.push((now - lastWrap) / 1000);
        lastWrap = now;
      }
      if (loop.b !== null) maxPastB = Math.max(maxPastB, t - loop.b);
      prev = t;
      await sleep(5);
    }
    app().clearLoop();
    const len = (loop.b ?? 0) - (loop.a ?? 0);
    const steady = cycles.slice(1);
    const worstGap = steady.length ? Math.max(...steady.map((c) => c - len)) : NaN;
    check(
      `loop ${label}`,
      steady.length >= 2 && worstGap < 0.15 && maxPastB < 0.08,
      `len ${len.toFixed(2)}s cycles [${cycles.map((c) => c.toFixed(2)).join(", ")}] worst gap ${(worstGap * 1000).toFixed(0)}ms, max past B ${(maxPastB * 1000).toFixed(0)}ms`,
    );
  };

  await loopCase("VBR mp3 (long)", 100, 102.5, 10);
  for (const t of tracks.filter((t) => !t.name.includes("Long"))) {
    app().open(t, true);
    await waitFor(() => engine.time > 0.2, 5000);
    await loopCase(t.name, 1, 3, 9);
  }

  // Experiment: same loops with the file loaded into memory (Blob URL).
  for (const t of [long, ...tracks.filter((t) => t.name.includes("wav"))]) {
    const blob = await (await fetch(mediaUrl(t.path))).blob();
    const url = URL.createObjectURL(blob);
    app().open(t, false);
    engine.load(url, 0, true);
    await waitFor(() => engine.time > 0.2, 5000);
    for (const target of [120, 50]) {
      if (target > engine.duration) continue;
      app().seek(target);
      const w0 = performance.now();
      await waitFor(() => engine.time > target + 0.03, 3000);
      devLog(`[blob] seek ${target}s resumed after ${(performance.now() - w0).toFixed(0)}ms`);
    }
    const [a, b] = t === long ? [100, 102.5] : [1, 3];
    await loopCase(`[blob] ${t.name}`, a, b, 9);
  }

  // 6. Loop keeps working while the window is minimized.
  app().open(long, true);
  await waitFor(() => engine.time > 0.2, 5000);
  await api.smokeWindow(true);
  await sleep(1000);
  await loopCase("while minimized", 100, 102.5, 10);
  await api.smokeWindow(false);

  // 7. Progress is persisted and resume rewinds 2s.
  app().seek(200);
  await sleep(500);
  app().toggle(); // pause → forced save
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
  check("resume ≈ saved − 2s", Math.abs(engine.time - (saved!.position - 2)) < 0.5, `t=${engine.time.toFixed(2)}`);
}
