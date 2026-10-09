import { Check, FolderOpen, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp, type AppState } from "../../store";
import { Button, IconButton, Kbd, TextLink } from "../ui";

type TaskId = "play" | "slow" | "loop" | "shadow";
const SHADOW_REPEATS = 3;

const TASKS: { id: TaskId; title: string; how: React.ReactNode }[] = [
  {
    id: "play",
    title: "播放",
    how: (
      <>
        按 <Kbd>空格</Kbd>，或把鼠标移到一句的时间上，点出现的播放按钮。
      </>
    ),
  },
  {
    id: "slow",
    title: "放慢",
    how: (
      <>
        在底部把速度调到 0.75，或按 <Kbd>−</Kbd>。
      </>
    ),
  },
  {
    id: "loop",
    title: "循环一句",
    how: (
      <>
        鼠标移到一句上，点最右边的循环按钮，或按 <Kbd>S</Kbd>。
      </>
    ),
  },
  { id: "shadow", title: "跟读", how: `跟着循环小声说出来，听满 ${SHADOW_REPEATS} 遍。` },
];

/**
 * Checklist above the sample's sentences: a row of four steps and how to do
 * the next one. Each step ticks itself when the learner actually does it.
 */
export function PracticeCoach() {
  const repeats = useApp((s) => (s.loopSentence !== null ? s.repeats : 0));
  const done = useDoneTasks();
  const { endPractice } = useApp.getState();
  const next = TASKS.find((t) => !done.has(t.id));

  return (
    <section aria-label="示例练习" className="mx-auto w-full max-w-[760px] shrink-0 px-8 pt-3 pb-1">
      <div className="animate-fade-in rounded-[14px] px-4 pt-3 pb-3.5 shadow-[inset_0_0_0_1px_var(--line-strong)]">
        {next ? (
          <>
            <header className="flex items-center gap-3">
              <h2 className="text-[13px] font-semibold">示例练习</h2>
              <ol className="flex min-w-0 items-center gap-1" aria-label={`完成 ${done.size} / ${TASKS.length}`}>
                {TASKS.map((t) => (
                  <li
                    key={t.id}
                    title={t.title}
                    className={`h-[3px] w-5 rounded-full transition-colors duration-300 ${
                      done.has(t.id) ? "bg-ink" : t === next ? "bg-fg/30" : "bg-track"
                    }`}
                  />
                ))}
              </ol>
              <span className="tabular font-mono text-[11px] text-faint">
                {done.size}/{TASKS.length}
              </span>
              <TextLink className="ml-auto text-[12px]" onClick={endPractice}>
                跳过
              </TextLink>
            </header>
            <div key={next.id} className="mt-2.5 flex animate-fade-in items-start gap-3">
              <span className="tabular mt-px grid size-[22px] shrink-0 place-items-center rounded-full bg-ink font-mono text-[11px] font-medium text-on-ink">
                {TASKS.indexOf(next) + 1}
              </span>
              <div className="min-w-0">
                <p className="flex items-baseline gap-2 text-[14px] font-medium">
                  {next.title}
                  {next.id === "shadow" && repeats > 0 && (
                    <span className="tabular font-mono text-[12px] font-normal text-loop-text">
                      {repeats}/{SHADOW_REPEATS}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{next.how}</p>
              </div>
            </div>
          </>
        ) : (
          <Finished />
        )}
      </div>
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
      <header className="flex items-start gap-3">
        <span className="mt-px grid size-[22px] shrink-0 place-items-center rounded-full bg-ok text-white">
          <Check size={12} strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-medium">完成了</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
            以后就这样练：选一句，放慢，循环着跟读。忘了快捷键就按 <Kbd>?</Kbd>。
          </p>
        </div>
        <IconButton title="关闭" onClick={endPractice}>
          <X />
        </IconButton>
      </header>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-[34px]">
        {hasFolder ? (
          <Button primary onClick={endPractice}>
            回到我的音频
          </Button>
        ) : (
          <Button primary onClick={() => void openFolder()}>
            <FolderOpen size={14} strokeWidth={1.9} />
            打开我的音频文件夹
          </Button>
        )}
        <Button onClick={() => setWizardOpen(true)} title="没有字幕的音频，可以用 AI 转写成一句一句的字幕">
          <Sparkles size={14} strokeWidth={1.9} />
          设置 AI 转写（可选）
        </Button>
      </div>
    </div>
  );
}
