import { AlertCircle, Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { featureReady } from "../../lib/aiReady";
import { api, type TestReport, type Track } from "../../lib/api";
import { count, t } from "../../lib/i18n";
import { formatTime } from "../../lib/time";
import { useApp } from "../../store";
import { Button } from "../ui";

type Run<T> = { kind: "idle" } | { kind: "running" } | { kind: "done"; value: T } | { kind: "failed"; message: string };

/**
 * Step 3: transcribe the ~30 s sample for real (not saved) and ask the
 * explanation model about a sample sentence, so the learner sees it works.
 */
export function TrialStep() {
  const canTranscribe = useApp((s) => featureReady("transcribe", s.ai, s.local));
  const canExplain = useApp((s) => featureReady("chat", s.ai, s.local));
  const cloudTranscribe = useApp((s) => !s.ai?.presets.find((p) => p.id === s.ai?.config.transcribe.provider)?.local);
  const [sample, setSample] = useState<Track | null>(null);
  const job = useApp((s) => (sample && s.job?.path === sample.path ? s.job : null));
  const startedAt = useRef(0);
  const [seconds, setSeconds] = useState(0);
  const [explain, setExplain] = useState<Run<TestReport>>({ kind: "idle" });

  useEffect(() => {
    if (job && job.state !== "running") setSeconds((Date.now() - startedAt.current) / 1000);
  }, [job]);
  // Leave no finished trial behind for the transcribe card to show.
  useEffect(() => () => useApp.getState().dismissJob(), []);

  async function run() {
    if (canTranscribe) void transcribe();
    if (canExplain) {
      setExplain({ kind: "running" });
      api.ai.test("chat").then(
        (value) => setExplain({ kind: "done", value }),
        (e) => setExplain({ kind: "failed", message: String(e) }),
      );
    }
  }

  async function transcribe() {
    const language = useApp.getState().guide.language === "ja" ? "ja" : "en";
    let path = "";
    try {
      const track = await api.sampleTrack(language);
      path = track.path;
      setSample(track);
      startedAt.current = Date.now();
      useApp.setState({ job: { state: "running", path, step: "transcribe", done: 0, total: 0 } });
      await api.transcribe.start(path, language, false);
    } catch (e) {
      // Shown through the same job state as a failure reported by Rust.
      if (!path) setSample({ path, name: "", relDir: "", size: 0 });
      useApp.setState({ job: { state: "failed", path, message: String(e) } });
    }
  }

  const busy = job?.state === "running" || explain.kind === "running";
  const tried = !!job || explain.kind !== "idle";
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-muted">
        {t("用一段约 30 秒的示例音频试一次转写，再请模型解释一个例句。", "Try transcription on a sample of about 30 seconds, then ask the model to explain a sample sentence.")}
        {canTranscribe &&
          cloudTranscribe &&
          t(" 示例音频会上传到你选的转写服务，费用不到 1 美分。", " The sample is uploaded to the transcription service you chose, for less than 1 cent.")}
      </p>

      <Row title={t("转写", "Transcription")} status={!canTranscribe ? "off" : !job ? "idle" : job.state === "running" ? "running" : job.state === "done" ? "ok" : "error"}>
        {!canTranscribe && t("还没有设置。随时可以在设置（⌘,）里补上。", "Not set up yet. You can finish it any time in Settings (⌘,).")}
        {canTranscribe && !job && t("转写示例音频，看看句子分得怎么样。", "Transcribe the sample to see how the sentences are split.")}
        {job?.state === "running" &&
          (job.done > 0
            ? t(
                `正在转写… ${formatTime(job.done)} / ${formatTime(job.total)}`,
                `Transcribing… ${formatTime(job.done)} / ${formatTime(job.total)}`,
              )
            : t("正在准备音频…", "Preparing audio…"))}
        {job?.state === "failed" && <span className="break-words text-danger">{job.message}</span>}
        {job?.state === "cancelled" && t("已取消", "Cancelled")}
        {job?.state === "done" && (
          <>
            {t(
              `用了 ${seconds.toFixed(1)} 秒，识别出 ${job.transcript.sentences.length} 句：`,
              `Took ${seconds.toFixed(1)} seconds and recognized ${count(job.transcript.sentences.length, "句", "sentence")}:`,
            )}
            <ol className="tint mt-2 flex flex-col gap-1.5 rounded-[10px] px-3 py-2.5">
              {job.transcript.sentences.slice(0, 4).map((s, i) => (
                <li key={i} className="flex gap-2 text-[12px]">
                  <span className="tabular shrink-0 font-mono text-faint">{formatTime(s.start)}</span>
                  <span className="font-script text-[13px] text-fg">{s.text}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </Row>

      <Row title={t("句子解释", "Sentence explanations")} status={!canExplain ? "off" : explain.kind === "idle" ? "idle" : explain.kind === "running" ? "running" : explain.kind === "done" ? "ok" : "error"}>
        {!canExplain && t("还没有设置。随时可以在设置（⌘,）里补上。", "Not set up yet. You can finish it any time in Settings (⌘,).")}
        {canExplain && explain.kind === "idle" && t("请模型翻译并讲解一个例句。", "Ask the model to translate and explain a sample sentence.")}
        {explain.kind === "running" && t("正在等模型回答…", "Waiting for the model…")}
        {explain.kind === "failed" && <span className="break-words text-danger">{explain.message}</span>}
        {explain.kind === "done" && (
          <>
            {explain.value.modelFound
              ? t(
                  `用了 ${(explain.value.millis / 1000).toFixed(1)} 秒回答：`,
                  `Answered in ${(explain.value.millis / 1000).toFixed(1)} seconds:`,
                )
              : t(
                  "连接成功，但没有找到选中的模型，请回到上一步确认名称。",
                  "Connected, but the selected model wasn’t found. Check the name in the previous step.",
                )}
            {explain.value.reply && (
              <figure className="tint mt-2 rounded-[10px] px-3 py-2.5 text-[12px] leading-relaxed">
                <figcaption className="text-faint">{t("例句：", "Sample sentence: ")}{explain.value.sample}</figcaption>
                <p className="mt-1 whitespace-pre-wrap text-fg">{explain.value.reply}</p>
              </figure>
            )}
          </>
        )}
      </Row>

      {(canTranscribe || canExplain) && (
        <div>
          <Button primary={!tried} disabled={busy} onClick={() => void run()}>
            {busy && <LoaderCircle size={14} className="animate-spin" />}
            {tried ? t("再试一次", "Try Again") : t("开始测试", "Start Test")}
          </Button>
        </div>
      )}
      {!canTranscribe && !canExplain && (
        <p className="text-[13px] text-muted">
          {t("两项都没有设置也没关系：播放、循环和导入字幕都不需要 AI。", "Skipping both is fine: playing, looping and importing subtitles don’t need AI.")}
        </p>
      )}
    </div>
  );
}

function Row({ title, status, children }: { title: string; status: "off" | "idle" | "running" | "ok" | "error"; children: React.ReactNode }) {
  const icon = {
    off: <span className="size-2 rounded-full bg-track" />,
    idle: <span className="size-2 rounded-full bg-faint/60" />,
    running: <LoaderCircle size={15} className="animate-spin text-muted" />,
    ok: <Check size={15} strokeWidth={2.5} className="text-ok" />,
    error: <AlertCircle size={15} className="text-danger" />,
  }[status];
  return (
    <section className={`grid items-start gap-x-2 ${t("grid-cols-[20px_72px_1fr]", "grid-cols-[20px_96px_1fr]")}`}>
      <span className="grid h-5 place-items-center">{icon}</span>
      <h3 className="text-[13px] leading-5 font-medium">{title}</h3>
      <div className="min-w-0 text-[13px] leading-5 text-muted">{children}</div>
    </section>
  );
}
