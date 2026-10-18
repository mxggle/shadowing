import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { featureReady, firstOpenStep } from "../../lib/aiReady";
import { t, tk } from "../../lib/i18n";
import { useApp } from "../../store";
import { Button, IconButton } from "../ui";
import { TrialStep } from "./TrialStep";
import { ChatStep, TranscribeStep } from "./WizardSteps";

const STEPS = [tk("转写"), tk("句子解释"), tk("试一试")] as const;

/**
 * Step-by-step AI setup: transcription → explanations → a real test on the
 * sample clip. Everything is optional and saved as you go, so closing it
 * halfway is fine; it reopens at the first step that isn't done.
 */
export function AiWizard() {
  const open = useApp((s) => s.wizardOpen && !!s.ai);
  return open ? <WizardDialog /> : null;
}

function WizardDialog() {
  const close = () => useApp.getState().setWizardOpen(false);
  const [step, setStep] = useState(() => firstOpenStep(useApp.getState().ai, useApp.getState().local));
  const feature = step === 0 ? "transcribe" : "chat";
  const ready = useApp((s) => featureReady(feature, s.ai, s.local));
  const downloading = useApp((s) => step === 0 && s.download?.state === "running");

  useEffect(() => {
    // Capture phase: Esc closes the wizard instead of also clearing the loop.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div
      className="fixed inset-0 z-30 flex animate-fade justify-center bg-black/25 px-6 pt-[6vh] pb-6 dark:bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        className="flex max-h-full w-full max-w-[660px] animate-pop-in flex-col self-start overflow-hidden rounded-[16px] bg-raised shadow-lift"
      >
        <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line pr-2.5 pl-6">
          <h2 id="wizard-title" className="text-[14px] font-semibold">
            {t("设置 AI")} <span className="ml-1 font-normal text-faint">{t("可选")}</span>
          </h2>
          <ol className="flex items-center gap-1 text-[12px]">
            {STEPS.map((label, i) => (
              <li key={label} className="flex items-center gap-1">
                {i > 0 && <span className="h-px w-3 bg-line-strong" />}
                <button
                  onClick={() => setStep(i as 0 | 1 | 2)}
                  aria-current={i === step ? "step" : undefined}
                  className={`flex h-6 items-center gap-1.5 rounded-[6px] px-1.5 transition-colors ${
                    i === step ? "font-medium text-fg" : "text-faint hover:text-muted"
                  }`}
                >
                  <span
                    className={`tabular grid size-[18px] place-items-center rounded-full font-mono text-[11px] transition-colors ${
                      i === step ? "bg-ink text-on-ink" : "tint"
                    }`}
                  >
                    {i + 1}
                  </span>
                  {t(label)}
                </button>
              </li>
            ))}
          </ol>
          <IconButton className="ml-auto" title={t("以后再说 (Esc)")} onClick={close}>
            <X />
          </IconButton>
        </header>

        <div className="scrollbar-none min-h-[320px] overflow-y-auto px-6 pt-5 pb-6">
          {step === 0 && <TranscribeStep />}
          {step === 1 && <ChatStep />}
          {step === 2 && <TrialStep />}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-deck px-6 py-3">
          {step > 0 && <Button onClick={() => setStep((step - 1) as 0 | 1)}>{t("上一步")}</Button>}
          <p className="min-w-0 flex-1 text-right text-[12px] text-faint">
            {downloading ? t("模型会在后台继续下载") : step < 2 && !ready ? t("可以先跳过，之后在设置（⌘,）里补上") : ""}
          </p>
          {step < 2 ? (
            <Button primary={ready || downloading} onClick={() => setStep((step + 1) as 1 | 2)}>
              {ready || downloading ? t("下一步") : t("跳过")}
            </Button>
          ) : (
            <Button primary onClick={close}>
              {t("完成")}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
