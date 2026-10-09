// Smoke-test part for the AI features, run against scripts/fake-whisper.py
// (started by smoke.sh on port 18765): settings, transcription, proofreading.
import { api, type Track } from "../lib/api";
import { debugEngine, useApp } from "../store";

interface Kit {
  check: (name: string, ok: boolean, detail?: string) => void;
  waitFor: (pred: () => boolean | Promise<boolean>, timeoutMs: number) => Promise<boolean>;
  tracks: Track[];
}

export async function aiScenario({ check, waitFor, tracks }: Kit) {
  const app = useApp.getState;
  const engine = debugEngine!;

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

  // 10. Transcription end to end against scripts/fake-whisper.py (started by smoke.sh).
  await api.ai.setBaseUrl("custom-transcribe", "http://127.0.0.1:18765/v1");
  app().setAiConfig(await api.ai.choose("transcribe", "custom-transcribe", "fake-whisper"));
  const untranscribed = tracks.find((t) => t.name === "10 English CBR")!;
  app().open(untranscribed, false);
  await waitFor(() => engine.duration > 0, 3000);
  check("track starts without transcript", !app().transcript);
  await app().startTranscribe("en");
  await waitFor(() => app().job?.state !== "running", 20000);
  const job = app().job;
  check("transcription finishes", job?.state === "done", job?.state === "failed" ? job.message : job?.state);
  const made = app().transcript;
  check(
    "transcript appears with timed sentences",
    made?.source === "transcribed" && made.sentences.map((x) => x.text).join(" | ") === "Fake sentence one. | Fake two.",
    made ? `${made.origin}: ${made.sentences.map((x) => `${x.text}@${x.start.toFixed(2)}–${x.end.toFixed(2)}`).join(" ")}` : "none",
  );
  const unsure = made?.sentences[0]?.unsure;
  check("an unsure word is underlined", JSON.stringify(unsure) === "[[5,13]]", JSON.stringify(unsure));
  const stored = await api.getTranscript(untranscribed.path);
  check("transcript saved for next time", stored?.source === "transcribed");


  // 11. Proofreading with the explanation model (the fake server's chat answer): one
  // fix, sent only if the unsure word was marked; accepting it is an ordinary edit.
  await api.ai.setBaseUrl("custom-chat", "http://127.0.0.1:18765/v1");
  app().setAiConfig(await api.ai.choose("chat", "custom-chat", "fake-chat"));
  app().openProofread();
  await app().startProofread();
  const proofread = app().proofread;
  const found = proofread?.state === "done" ? proofread.suggestions : [];
  check(
    "proofreading suggests one fix",
    found.length === 1 && found[0].from === "sentence" && found[0].to === "sentinel",
    JSON.stringify(proofread),
  );
  if (found[0]) await app().acceptSuggestion(found[0]);
  const fixed = (await api.getTranscript(untranscribed.path))?.sentences[0];
  check("accepted fix saved, its underline gone", fixed?.text === "Fake sentinel one." && !fixed.unsure?.length, JSON.stringify(fixed));

  // 12. Explaining a sentence: the note shows the model's answer, and sentence 1
  // is sent with a line either side of it.
  app().toggleExplain(1);
  await waitFor(() => Object.values(app().explain).some((e) => e.state !== "running"), 10000);
  const note = Object.values(app().explain)[0];
  check(
    "a sentence is explained",
    note?.open && note.state === "done" && note.value.translation === "测试译文" && note.value.words[0]?.word === "two",
    JSON.stringify(app().explain),
  );
  app().toggleExplain(1);
  check("closing keeps the answer for later", Object.values(app().explain).every((e) => !e.open && e.state === "done"));

  // 13. The answer is kept on disk: forget it on screen, and it comes back (closed) with its source.
  const path = untranscribed.path;
  useApp.setState({ explain: {} });
  await app().loadExplanations(path);
  const back = Object.values(app().explain)[0];
  check(
    "a kept answer comes back after a restart",
    Object.keys(app().explain).length === 1 && back?.state === "done" && !back.open && back.value.translation === "测试译文" && back.value.source.endsWith("fake-chat"),
    JSON.stringify(app().explain),
  );
}
