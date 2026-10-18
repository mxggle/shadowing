import { Captions, Check, Play, Repeat, Sparkles, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { featureReady } from "../../lib/aiReady";
import { t, tk } from "../../lib/i18n";
import { useApp } from "../../store";
import { Button, TextLink } from "../ui";
import { AccountStep, ModelStep } from "./OnboardingSteps";
import { BigButton, Preview } from "./Welcome";

const LANGUAGES: [string, string][] = [
  ["ja", tk("日语")],
  ["en", tk("英语")],
  ["other", tk("其他语言")],
];

const FEATURES: [LucideIcon, string, string][] = [
  [Repeat, tk("一句一句跟读"), tk("点一句就循环，随时放慢，用你自己的音频。")],
  [Captions, tk("没有字幕也能练"), tk("Whisper 把音频转写成带时间的句子，可以在这台 Mac 上免费运行。")],
  [Sparkles, tk("看懂每一句"), tk("AI 翻译句子、讲解生词和语法，还能校对听错的字。")],
];

const STEPS = [tk("介绍"), tk("本机转写"), tk("登录 AI"), tk("开始")] as const;

/**
 * First launch: what the app does and which language, then the two optional
 * AI pieces (a Whisper model for this Mac, a sign-in for explanations), then
 * the sample practice or the learner's own folder. Every choice is saved as
 * it is made, so quitting halfway loses nothing.
 */
export function Onboarding() {
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  return (
    <div data-tauri-drag-region className="scrollbar-none h-full overflow-y-auto bg-paper px-10">
      {/* my-auto centres short steps and leaves room above and below when a step is taller than the window. */}
      <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col pt-10 pb-16">
        <Steps step={step} onPick={setStep} />
        <div key={step} className="my-auto flex animate-fade-in flex-col pt-12">
          {step === 0 && <Intro onNext={next} />}
          {step === 1 && (
            <Page title={t("在这台 Mac 上转写")} onBack={() => setStep(0)} onNext={next} feature="transcribe">
              <ModelStep />
            </Page>
          )}
          {step === 2 && (
            <Page title={t("登录 AI 服务")} onBack={() => setStep(1)} onNext={next} feature="chat">
              <AccountStep />
            </Page>
          )}
          {step === 3 && <Start onBack={() => setStep(2)} />}
        </div>
      </div>
    </div>
  );
}

function Steps({ step, onPick }: { step: number; onPick: (i: number) => void }) {
  const language = useApp((s) => s.guide.language);
  return (
    <ol className="flex items-center gap-1 self-center text-[12px]" aria-label={t("引导步骤")}>
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-1">
          {i > 0 && <span className="h-px w-4 bg-line-strong" />}
          <button
            disabled={!language && i > 0}
            onClick={() => onPick(i)}
            aria-current={i === step ? "step" : undefined}
            className={`flex h-6 items-center gap-1.5 rounded-[6px] px-1.5 transition-colors disabled:pointer-events-none ${
              i === step ? "font-medium text-fg" : "text-faint hover:text-muted"
            }`}
          >
            <span
              className={`tabular grid size-[18px] place-items-center rounded-full font-mono text-[11px] transition-colors ${
                i === step ? "bg-ink text-on-ink" : i < step ? "bg-fg/15 text-fg" : "tint"
              }`}
            >
              {i < step ? <Check size={10} strokeWidth={3} /> : i + 1}
            </span>
            {t(label)}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Intro({ onNext }: { onNext: () => void }) {
  const guide = useApp((s) => s.guide);
  const missing = useApp((s) => s.missingFolder);
  const { chooseFolder, saveGuide, setTranscribeLanguage } = useApp.getState();

  function pickLanguage(language: string) {
    saveGuide({ language });
    // Also the default for transcribing (until one is picked there).
    if (!useApp.getState().settings.transcribeLanguage && language !== "other") setTranscribeLanguage(language);
  }

  return (
    <div className="grid w-full items-center gap-14 min-[880px]:grid-cols-[1fr_360px]">
      <div className="flex flex-col items-start">
        <p className="text-[13px] font-semibold tracking-[0.01em] text-muted">Shadowing</p>
        <h1 className="mt-3 font-heading text-[34px] leading-[1.25] font-semibold tracking-[-0.015em] text-balance">
          {t("反复听、放慢，")}
          <br />
          {t("一句一句跟读。")}
        </h1>
        {missing && (
          <p className="mt-4 rounded-[8px] bg-danger-soft px-3 py-1.5 text-[12px] break-all text-danger">{t("上次的文件夹无法打开：{folder}", { folder: missing })}</p>
        )}
        <ul className="mt-7 flex flex-col gap-3.5">
          {FEATURES.map(([Icon, title, text]) => (
            <li key={title} className="flex gap-3">
              <Icon size={17} strokeWidth={1.8} className="mt-0.5 shrink-0 text-muted" />
              <div>
                <p className="text-[14px] font-medium">{t(title)}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{t(text)}</p>
              </div>
            </li>
          ))}
        </ul>

        <h2 className="mt-8 text-[13px] font-medium text-muted">{t("你在学哪种语言？")}</h2>
        <div role="radiogroup" aria-label={t("学习语言")} className="tint mt-2.5 flex gap-1 rounded-[11px] p-1">
          {LANGUAGES.map(([code, label]) => {
            const on = guide.language === code;
            return (
              <button
                key={code}
                role="radio"
                aria-checked={on}
                onClick={() => pickLanguage(code)}
                className={`h-8 rounded-[8px] px-4 text-[13px] transition-[background-color,color,box-shadow] duration-150 ${
                  on ? "bg-raised font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
                }`}
              >
                {t(label)}
              </button>
            );
          })}
        </div>
        <BigButton disabled={!guide.language} onClick={onNext}>
          {t("下一步")}
        </BigButton>
        <TextLink className="mt-6" onClick={() => void chooseFolder()}>
          {t("跳过引导，直接打开我的音频文件夹")}
        </TextLink>
      </div>
      <Preview language={guide.language === "en" ? "en" : "ja"} />
    </div>
  );
}

/** A setup step: title, body, and back / next (next says 跳过 until the feature works). */
function Page({ title, feature, onBack, onNext, children }: {
  title: string;
  feature: "transcribe" | "chat";
  onBack: () => void;
  onNext: () => void;
  children: React.ReactNode;
}) {
  const ready = useApp((s) => featureReady(feature, s.ai, s.local));
  const downloading = useApp((s) => feature === "transcribe" && s.download?.state === "running");
  const go = ready || downloading;
  return (
    <section className="mx-auto flex w-full max-w-[600px] flex-col">
      <h1 className="font-heading text-[26px] leading-[1.3] font-semibold tracking-[-0.01em]">{title}</h1>
      <div className="mt-5">{children}</div>
      <footer className="mt-8 flex items-center gap-2 border-t border-line pt-4">
        <Button onClick={onBack}>{t("上一步")}</Button>
        <p className="min-w-0 flex-1 text-right text-[12px] text-faint">
          {downloading ? t("模型会在后台继续下载") : go ? "" : t("可以先跳过，之后在设置（⌘,）里补上")}
        </p>
        <Button primary={go} onClick={onNext}>
          {go ? t("下一步") : t("跳过")}
        </Button>
      </footer>
    </section>
  );
}

function Start({ onBack }: { onBack: () => void }) {
  const transcribe = useApp((s) => (featureReady("transcribe", s.ai, s.local) ? "ok" : s.download?.state === "running" ? "pending" : "off"));
  const chat = useApp((s) => (featureReady("chat", s.ai, s.local) ? "ok" : "off"));
  // Opening the sample can fail (say, a broken install); nothing else on this screen would show it.
  const error = useApp((s) => s.error);
  const { startPractice, chooseFolder } = useApp.getState();

  return (
    <section className="mx-auto flex w-full max-w-[600px] flex-col items-start">
      <h1 className="font-heading text-[26px] leading-[1.3] font-semibold tracking-[-0.01em]">{t("准备好了")}</h1>
      <ul className="mt-5 flex flex-col gap-2 text-[13px]">
        <Status state={transcribe} label={t("转写")} text={{ ok: t("可以用了"), pending: t("模型正在后台下载，下载完就能用"), off: t("还没有设置") }} />
        <Status state={chat} label={t("句子解释")} text={{ ok: t("可以用了"), pending: "", off: t("还没有设置") }} />
      </ul>
      {(transcribe === "off" || chat === "off") && (
        <p className="mt-3 text-[12px] text-faint">{t("没设置也能练：播放、循环和导入字幕都不需要 AI。随时可以在设置（⌘,）里补上。")}</p>
      )}
      <BigButton onClick={() => void startPractice()}>
        <Play size={15} fill="currentColor" strokeWidth={0} /> {t("用示例练一下")}
      </BigButton>
      <p className="mt-2.5 text-[12px] text-faint">{t("约 1 分钟：播放、放慢、循环一句、跟读。")}</p>
      {error && <p className="mt-3 rounded-[8px] bg-danger-soft px-3 py-1.5 text-[12px] break-all text-danger">{error}</p>}
      <div className="mt-7 flex items-center gap-5">
        <TextLink onClick={() => void chooseFolder()}>{t("直接打开我的音频文件夹")}</TextLink>
        <TextLink onClick={onBack}>{t("上一步")}</TextLink>
      </div>
    </section>
  );
}

function Status({ state, label, text }: { state: "ok" | "pending" | "off"; label: string; text: Record<"ok" | "pending" | "off", string> }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="grid size-4 place-items-center">
        {state === "ok" ? (
          <Check size={15} strokeWidth={2.5} className="text-ok" />
        ) : (
          <span className={`size-2 rounded-full ${state === "pending" ? "bg-faint" : "bg-track"}`} />
        )}
      </span>
      <span className="w-16 font-medium [&:lang(en)]:w-24">{label}</span>
      <span className="text-muted">{text[state]}</span>
    </li>
  );
}
