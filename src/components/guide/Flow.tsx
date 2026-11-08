import { Check, ChevronRight, X } from "lucide-react";
import { Fragment, useEffect } from "react";
import { flowAuto, flowDone, flowNext, flowShown, FLOW_STEPS, heardThrough, type FlowStep } from "../../lib/flow";
import { t, tk } from "../../lib/i18n";
import { clampRounds } from "../../lib/rounds";
import { useApp } from "../../store";
import { IconButton } from "../ui";

// Labels are keys (t() where shown).
const LABELS: Record<FlowStep, string> = {
  listen: tk("完整听一遍"),
  drill: tk("逐句跟读"),
  read: tk("整段录音"),
};

function how(step: FlowStep, rounds: number) {
  if (step === "listen") return t("从头放一遍，先听懂在说什么");
  if (step === "drill") return t("一句一句跟着说，每句 {rounds} 遍，录完自动到下一句", { rounds, n: rounds });
  return t("整段读下来，读完逐句和原文对比");
}

/**
 * 推荐练法: one line under the list header — hear it through, then sentence by
 * sentence, then a whole paragraph — each step a button that does it, ticked
 * once done on this track. Comes up by itself once ever (× and it's gone;
 * 整段录音's menu brings it back), and steps aside while recording.
 */
export function FlowLine() {
  const path = useApp((s) => s.current?.path ?? null);
  const open = useApp((s) => !!s.flow && s.flow.path === s.current?.path);
  const heard = useApp((s) => !!s.flow?.heard && s.flow.path === s.current?.path);
  const heardNow = useApp((s) => open && heardThrough(s.time, s.transcript?.sentences ?? []));
  const auto = useApp((s) => flowAuto({ tips: s.guide.tips, sentences: s.transcript?.sentences.length ?? 0, practicing: s.practicing }));
  const busy = useApp((s) => !!s.rec || !!s.live || !!s.drill);
  const practicing = useApp((s) => s.practicing);
  const takes = useApp((s) => s.takes);
  const readings = useApp((s) => s.readings.length);
  const rounds = useApp((s) => clampRounds(s.settings.drillRounds));
  const { openFlow, closeFlow, flowHeard } = useApp.getState();

  useEffect(() => {
    if (auto && path) openFlow(true);
  }, [auto, path, openFlow]);
  useEffect(() => {
    if (heardNow) flowHeard();
  }, [heardNow, flowHeard]);

  if (!flowShown({ open, busy, practicing })) return null;
  const done = flowDone({ heard, takes, readings });
  const next = flowNext(done);
  const all = done.size === FLOW_STEPS.length;

  return (
    <section aria-label={t("推荐练法")} className="mx-auto w-full max-w-[760px] animate-fade-in pr-8 pb-2 pl-10">
      <div className="flex items-center gap-2 rounded-[10px] py-1 pr-1 pl-3 shadow-[inset_0_0_0_1px_var(--line)]">
        <span className="shrink-0 text-[12px] text-muted">{t("推荐练法")}</span>
        <ol className="flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-0.5">
          {FLOW_STEPS.map((step, i) => (
            <Fragment key={step}>
              {i > 0 && (
                <li aria-hidden className="text-faint">
                  <ChevronRight size={12} strokeWidth={2} />
                </li>
              )}
              <li>
                <StepButton step={step} index={i} done={done.has(step)} next={step === next} title={how(step, rounds)} />
              </li>
            </Fragment>
          ))}
        </ol>
        {all && <span className="shrink-0 text-[12px] text-muted">· {t("都做完了")}</span>}
        <IconButton title={t("关闭推荐练法")} aria-label={t("关闭推荐练法")} onClick={closeFlow} className="ml-auto !h-6 !min-w-6 shrink-0">
          <X />
        </IconButton>
      </div>
    </section>
  );
}

function StepButton({ step, index, done, next, title }: { step: FlowStep; index: number; done: boolean; next: boolean; title: string }) {
  return (
    <button
      title={title}
      onClick={() => run(step)}
      className={`flex h-6 items-center gap-1.5 rounded-[6px] px-1.5 text-[12px] whitespace-nowrap transition-[background-color,color,scale] duration-150 hover:bg-hover active:scale-[0.96] ${
        next ? "font-medium text-fg" : "text-muted hover:text-fg"
      }`}
    >
      <span
        aria-hidden
        className={`tabular grid size-4 shrink-0 place-items-center rounded-full font-mono text-[11px] leading-none ${
          next ? "bg-ink text-on-ink" : done ? "text-ok" : "shadow-[inset_0_0_0_1px_var(--line-strong)]"
        }`}
      >
        {done ? <Check size={12} strokeWidth={2.6} /> : index + 1}
      </span>
      {t(LABELS[step])}
      {done && <span className="sr-only">{t("（已做过）")}</span>}
    </button>
  );
}

function run(step: FlowStep) {
  const s = useApp.getState();
  if (step === "listen") {
    s.clearLoop();
    return s.playSentence(0);
  }
  // The section you're in (the whole text when there are no sections).
  if (step === "drill") return s.startDrill();
  s.setReadingMenu(true);
}
