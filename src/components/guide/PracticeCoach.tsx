import { Check, FolderOpen, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp, type AppState } from "../../store";
import { Button, IconButton } from "../ui";

type TaskId = "play" | "slow" | "loop" | "shadow";
const SHADOW_REPEATS = 3;

const TASKS: { id: TaskId; title: string; how: string }[] = [
  { id: "play", title: "播放", how: "按空格，或点任意一句，从那里开始听。" },
  { id: "slow", title: "放慢", how: "在底部把速度调慢一点，比如 0.75（或按 −）。" },
  { id: "loop", title: "循环一句", how: "鼠标移到句子上，点右边的循环按钮（或按 S）。" },
  { id: "shadow", title: "跟读", how: `跟着循环小声说出来，听满 ${SHADOW_REPEATS} 遍。` },
];

/**
 * Checklist above the sample's sentences. Each task ticks itself when the
 * learner actually does it; no slides to read.
 */
export function PracticeCoach() {
  const repeats = useApp((s) => (s.loopSentence !== null ? s.repeats : 0));
  const done = useDoneTasks();
  const { endPractice } = useApp.getState();
  const next = TASKS.find((t) => !done.has(t.id));

  return (
    <section
      aria-label="示例练习"
      className="mx-auto mt-3 w-[calc(100%-5rem)] max-w-[680px] shrink-0 animate-fade-in rounded-2xl border border-line bg-panel px-4 py-3"
    >
      {next ? (
        <>
          <header className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold">示例练习</h2>
            <span className="tabular font-mono text-[12px] text-faint">
              {done.size}/{TASKS.length}
            </span>
            <Button className="ml-auto h-7" onClick={endPractice}>
              跳过
            </Button>
          </header>
          <ol className="mt-2 flex flex-col gap-1">
            {TASKS.map((t, i) => {
              const ok = done.has(t.id);
              const current = t === next;
              return (
                <li key={t.id} className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${current ? "bg-hover" : ""}`}>
                  <span
                    className={`mt-px grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium ${
                      ok ? "bg-ok text-white" : current ? "bg-ink text-on-ink" : "bg-hover text-faint"
                    }`}
                  >
                    {ok ? <Check size={12} strokeWidth={3} /> : i + 1}
                  </span>
                  <p className={`min-w-0 text-[13px] ${ok ? "text-faint" : current ? "text-fg" : "text-muted"}`}>
                    <span className="font-medium">{t.title}</span>
                    {!ok && <span className={current ? "text-muted" : "text-faint"}>：{t.how}</span>}
                    {t.id === "shadow" && !ok && repeats > 0 && (
                      <span className="tabular ml-1.5 font-mono text-[12px] text-loop-text">
                        {repeats}/{SHADOW_REPEATS}
                      </span>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <Finished />
      )}
    </section>
  );
}

/** Watches the store; a task stays ticked once done. */
function useDoneTasks() {
  const [done, setDone] = useState<Set<TaskId>>(new Set());
  const startRate = useRef(useApp.getState().settings.rate);

  useEffect(() => {
    const check = (s: AppState) => {
      const hits: TaskId[] = [];
      if (s.playing) hits.push("play");
      // Any slower speed counts; someone already at the minimum has nothing to do.
      if (s.settings.rate < startRate.current - 0.001 || startRate.current <= 0.5) hits.push("slow");
      if (s.loopSentence !== null) hits.push("loop");
      if (s.loopSentence !== null && s.repeats >= SHADOW_REPEATS) hits.push("shadow");
      setDone((prev) => (hits.every((h) => prev.has(h)) ? prev : new Set([...prev, ...hits])));
    };
    check(useApp.getState());
    return useApp.subscribe(check);
  }, []);
  return done;
}

function Finished() {
  const hasFolder = useApp((s) => !!s.folder);
  const { endPractice, chooseFolder, setWizardOpen, saveGuide } = useApp.getState();

  async function openFolder() {
    const before = useApp.getState().folder;
    await chooseFolder();
    if (useApp.getState().folder !== before) saveGuide({ practiced: true });
  }

  return (
    <div className="animate-fade-in">
      <header className="flex items-start gap-2">
        <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-ok text-white">
          <Check size={12} strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold">完成了！</h2>
          <p className="mt-0.5 text-[13px] text-muted">以后就这样练：选一句，放慢，循环着跟读。快捷键随时按 ? 查看。</p>
        </div>
        <IconButton title="关闭" onClick={endPractice}>
          <X size={15} />
        </IconButton>
      </header>
      <div className="mt-3 flex flex-col gap-2 pl-7">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[12px] text-muted">
            {hasFolder ? "回到你的音频继续练习。" : "打开一个存放音频的文件夹（mp3、m4a、wav…）。"}
          </p>
          {hasFolder ? (
            <Button primary onClick={endPractice}>
              回到我的音频
            </Button>
          ) : (
            <Button primary onClick={() => void openFolder()}>
              <FolderOpen size={15} />
              打开文件夹
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[12px] text-muted">没有字幕的音频，可以用 AI 转写成一句一句的字幕（可选）。</p>
          <Button onClick={() => setWizardOpen(true)}>
            <Sparkles size={15} />
            设置 AI
          </Button>
        </div>
      </div>
    </div>
  );
}
