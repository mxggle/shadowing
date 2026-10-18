// Debug-only scripted check that runs inside the real app.
// Started by `npm run smoke -- <folder>` (see src-tauri/src/smoke.rs).
// Prints PASS/FAIL lines; precise numbers come from Rust's player_status.
import { listen } from "@tauri-apps/api/event";
import { api, devLog, type ImportStatus } from "../lib/api";
import { debugEngine, useApp } from "../store";
import { aiScenario } from "./smokeAi";

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
  check("scan finds 6 audio files, skips .txt", tracks.length === 6);

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
    await sleep(100); // let the last status event land
    const counted = app().repeats;
    app().clearLoop();
    app().setRate(1);
    const len = ((loop.b ?? 0) - (loop.a ?? 0)) / rate;
    const steady = cycles.slice(1);
    const worst = steady.length ? Math.max(...steady.map((c) => Math.abs(c - len))) : NaN;
    // Real passes only: setting B seeks to A, which can show up as a near-zero "cycle".
    // Rust may be one wrap ahead of what has been heard.
    const passes = cycles.filter((c) => c > len / 2).length;
    check(
      `loop ${label}`,
      steady.length >= 2 && worst < 0.06 && maxPastB < 0.05 && counted >= passes && counted <= passes + 1,
      `len ${len.toFixed(2)}s, ${counted} repeats counted, cycles [${cycles.map((c) => c.toFixed(2)).join(", ")}] worst deviation ${(worst * 1000).toFixed(0)}ms, max past B ${(maxPastB * 1000).toFixed(0)}ms`,
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
  // Practice time comes from the player in Rust, so the minimized loop above counts too.
  const practice = (await api.practice.log()).filter((s) => s.audio === long.path);
  const played = practice.reduce((sum, s) => sum + s.played, 0);
  check(
    "practice time recorded from playback",
    played >= 8000 && practice.every((s) => s.played <= s.end - s.start),
    `${practice.length} sessions, played ${(played / 1000).toFixed(1)}s`,
  );
  // The daily goal is saved (settings settle after 400 ms) and today's total reaches the top bar.
  app().setDailyGoal(20);
  await app().refreshToday();
  await sleep(600);
  const goals = (await api.getSnapshot()).settings.dailyGoals;
  check(
    "daily goal saved, today's and this audio's practice loaded",
    goals.at(-1)?.minutes === 20 && (app().todayMs ?? 0) >= played && app().trackMs >= played,
    `goals ${JSON.stringify(goals)}, today ${((app().todayMs ?? 0) / 1000).toFixed(1)}s, audio ${(app().trackMs / 1000).toFixed(1)}s`,
  );
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

  // 7b. Repeat one: the same track starts over and keeps playing.
  app().setPlayMode("one");
  await waitFor(() => engine.duration > 0, 3000);
  app().seek(engine.duration - 0.5);
  const restarted = await waitFor(() => engine.time > 0.2 && engine.time < 3 && !engine.paused, 4000);
  check("repeat one starts the track over", restarted && app().current?.path === tracks[1].path, `now ${app().current?.name} t=${engine.time.toFixed(2)}`);
  app().setPlayMode("next");

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
    await waitFor(() => app().repeats >= 1, 1000);
    check("repeat counter counts the pass", app().repeats >= 1, `repeats ${app().repeats}`);
    app().stepSentence(-1);
    check("moving the loop resets the count", app().repeats === 0, `repeats ${app().repeats}`);
    check("[ moves the loop to sentence 1", app().loopSentence === 0 && app().loop.a === 0, `A ${app().loop.a}`);
    app().clearLoop();

    // Corrections are saved as the app's own copy (the .srt stays as it is) and can be undone.
    const first = transcript.sentences[0].text;
    app().editSentence(0);
    app().setDraft(first.replace("brown", "red"));
    await app().saveEdit();
    let saved = await api.getTranscript(english.path);
    check(
      "corrected sentence saved in the app",
      saved?.source === "imported" && !!saved.edited && saved.sentences[0].text.includes("quick red fox"),
      saved?.sentences[0].text,
    );
    app().openReplace("you");
    app().setReplace({ with: "we" });
    await app().replaceAll();
    saved = await api.getTranscript(english.path);
    check("replace all changes every match", saved?.sentences[1].text.match(/\bwe\b/g)?.length === 2, saved?.sentences[1].text);
    await app().undoEdit();
    await app().undoEdit();
    saved = await api.getTranscript(english.path);
    check("undo puts both changes back", saved?.sentences[0].text === first && saved.sentences[1].text === transcript.sentences[1].text, saved?.sentences[0].text);
    app().closeReplace();

    // Sections: a new one from sentence 2 is saved, loops on its own, can be named and merged back.
    app().splitSection(1);
    const split = await waitFor(async () => (await api.getTranscript(english.path))?.sections?.length === 2, 2000);
    app().toggleSectionLoop(1);
    check(
      "new section saved and loops by itself",
      split && app().loopSection === 1 && Math.abs((app().loop.a ?? 0) - Math.max(0, transcript.sentences[1].start - 0.1)) < 0.01,
      `sections ${JSON.stringify(app().transcript?.sections)} A ${app().loop.a?.toFixed(2)}`,
    );
    app().renameSection(1, "  後半 ");
    const named = await waitFor(async () => (await api.getTranscript(english.path))?.sections?.[1]?.title === "後半", 2000);
    check("section name saved, loop kept", named && app().loopSection === 1, JSON.stringify(app().transcript?.sections));
    app().clearLoop();
    app().mergeSection(1);
    const merged = await waitFor(async () => (await api.getTranscript(english.path))?.sections?.length === 1, 2000);
    check("merged back into one section", merged, JSON.stringify(app().transcript?.sections));

    // Cutting a sentence at the cursor: the time lands on the pause `say` leaves after the comma; joining and ⌘Z put it back.
    const whole = transcript.sentences[1];
    app().editSentence(1);
    await app().splitDraft(whole.text.indexOf(",") + 1);
    saved = await api.getTranscript(english.path);
    const [part1, part2] = saved?.sentences.slice(1) ?? [];
    check(
      "cut at the cursor lands on the pause heard there",
      saved?.sentences.length === 3 && part1.text.endsWith("hear,") && part2.text.startsWith("right") && part2.start - part1.end > 0.05,
      `${part1?.text} | ${part2?.text} · ${part1?.end.toFixed(2)}–${part2?.start.toFixed(2)}`,
    );
    check("correcting goes on in the second part", app().editing?.index === 2 && app().editing?.caret === 0);
    app().cancelEdit();
    await app().mergeSentence(1);
    saved = await api.getTranscript(english.path);
    check("joined back into one sentence", saved?.sentences.length === 2 && saved.sentences[1].text === whole.text, saved?.sentences[1].text);
    await app().undoEdit();
    await app().undoEdit();
    saved = await api.getTranscript(english.path);
    const back = saved?.sentences[1];
    check("undo puts the cut sentence back", saved?.sentences.length === 2 && back?.start === whole.start && back.end === whole.end && back.text === whole.text, JSON.stringify(back));
  }

  // 9–11. AI settings, transcription and proofreading against the fake server (smokeAi.ts).
  await aiScenario({ check, waitFor, tracks });

  // 12. The bundled practice clip plays from inside the app with its subtitles; a trial run isn't saved.
  const sample = await api.sampleTrack("ja");
  app().open(sample, true);
  const samplePlays = await waitFor(async () => (await rust()) > 0.3 || !!app().error, 5000);
  check("bundled sample plays", samplePlays && !app().error, app().error ?? sample.path);
  await waitFor(() => !!app().transcript, 2000);
  const sampleText = app().transcript;
  check("sample brings its 4 sentences", sampleText?.source === "sidecar" && sampleText.sentences.length === 4, sampleText?.origin ?? "none");
  engine.pause();
  await api.transcribe.start(sample.path, "ja", false);
  await waitFor(() => app().job?.path === sample.path && app().job?.state !== "running", 20000);
  const trial = app().job;
  check("trial transcription of the sample", trial?.state === "done" && !trial.saved, trial?.state === "failed" ? trial.message : trial?.state);
  const kept = await api.getTranscript(sample.path);
  check("trial result is not saved", kept?.source === "sidecar" && app().transcript?.source === "sidecar", kept?.source);

  // 11. 从链接导入 through a fake plugin (a shell script, see smoke.rs): the link resolves,
  // the plugin "downloads" into staging, the app moves the audio into the folder and
  // keeps the subtitles as a transcript that can be removed. A second link queued
  // meanwhile waits its turn; both show as rows in their folder's group until done.
  const outcomes: ImportStatus[] = [];
  const unlisten = await listen<ImportStatus>("import:status", ({ payload }) => {
    if (payload.state !== "resolving" && payload.state !== "downloading") outcomes.push(payload);
  });
  await app().loadPlugins();
  check("fake plugin is listed", app().plugins.some((p) => p.id === "smoke-import" && !p.problem), JSON.stringify(app().plugins));
  await app().openImport("https://smoke.example/watch?v=1");
  const resolved = app().linkImport?.resolved;
  check("link resolves through the plugin", resolved?.title === "Smoke import" && resolved.via === "Smoke", app().linkImport?.error ?? "");
  app().startImport("en", "smoke-import");
  await app().openImport("https://smoke.example/watch?v=2");
  app().startImport(null, "smoke-import");
  // Rust takes one download at a time: had the queue not waited, the second would fail.
  await waitFor(() => app().downloads.length === 0, 15000);
  const done = outcomes.filter((o) => o.state === "done");
  const paths = done.map((o) => (o.state === "done" ? o.path.split("/").slice(-2).join("/") : ""));
  check(
    "both imports land in the folder, the second not overwriting the first",
    done.length === 2 && paths[0] === "smoke-import/Smoke import.mp3" && paths[1] === "smoke-import/Smoke import (2).mp3" && done[0].state === "done" && done[0].subtitles,
    JSON.stringify(outcomes),
  );
  unlisten();
  const imported = app().folder?.tracks.find((t) => t.relDir === "smoke-import" && t.name === "Smoke import");
  check("the rows gave way to the tracks", !!imported && app().folder?.tracks.filter((t) => t.relDir === "smoke-import").length === 2, app().folder?.tracks.map((t) => t.name).join(" | "));
  if (imported) {
    const t = await api.getTranscript(imported.path);
    check(
      "its subtitles are a removable imported transcript",
      t?.source === "imported" && t.origin === "Smoke 字幕 · en" && t.sentences.length === 2,
      JSON.stringify(t && { source: t.source, origin: t.origin, sentences: t.sentences.length }),
    );
    app().open(imported, true);
    const plays = await waitFor(async () => (await rust()) > 0.4 || !!app().error, 5000);
    check("imported track plays", plays && !app().error, app().error ?? "");
  }
  await app().resolveImport("https://elsewhere.example/x");
  check("a link no plugin takes says so", app().linkImport?.error === "没有能导入这个链接的插件", app().linkImport?.error ?? "");
  app().closeImport();

  // 12. Local whisper.cpp on a real model, if one has been downloaded (see smoke.sh).
  const local = await api.local.models();
  const small = local.models.find((m) => m.id === "small-q5_1");
  if (!local.supported || !small?.downloaded) {
    devLog("SKIP local transcription — download the Small model in Settings first");
    return;
  }
  app().setAiConfig(await api.ai.choose("transcribe", "local", "small-q5_1"));
  const japanese = tracks.find((t) => t.name === "01 日本語 天気")!;
  app().open(japanese, false);
  await waitFor(() => engine.duration > 0, 3000);
  await app().startTranscribe("ja");
  await waitFor(() => app().job?.state !== "running", 60000);
  const localJob = app().job;
  check("local transcription finishes", localJob?.state === "done", localJob?.state === "failed" ? localJob.message : localJob?.state);
  const ja = app().transcript;
  check(
    "local transcript has the Japanese sentences",
    ja?.origin === "本机 · small-q5_1" && ja.sentences.length === 3 && ja.sentences[0].text.includes("天気"),
    ja ? ja.sentences.map((x) => `${x.text}@${x.start.toFixed(2)}–${x.end.toFixed(2)}`).join(" ") : "none",
  );

  // 13. Two voices taking turns: each turn is labelled with its speaker.
  const dialogue = tracks.find((t) => t.name === "05 会話 二人")!;
  app().open(dialogue, false);
  await waitFor(() => engine.duration > 0, 3000);
  await app().startTranscribe("ja");
  await waitFor(() => app().job?.state !== "running", 90000);
  const talk = app().transcript?.sentences ?? [];
  const who = (word: string) => talk.find((x) => x.text.includes(word))?.speaker;
  check(
    "dialogue turns alternate between two speakers",
    who("週末") === 0 && who("決め") === 1 && who("一緒") === 0 && who("駅") === 1,
    talk.map((x) => `${x.speaker ?? "-"}:${x.text}`).join(" "),
  );
}
