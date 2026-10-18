import { AlertCircle, Cloud, FileUp, Laptop, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TranscribeStatus } from "../lib/api";
import { featureReady } from "../lib/aiReady";
import { t } from "../lib/i18n";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { Button, fieldClass, TextLink } from "./ui";

/** A function, not a constant: the wording follows the language (lib/i18n.ts). */
const languages = (): [string, string][] => [
  ["", t("自动识别", "Auto-detect")],
  ["ja", t("日语", "Japanese")],
  ["en", t("英语", "English")],
  ["zh", t("中文", "Chinese")],
  ["ko", t("韩语", "Korean")],
  ["fr", t("法语", "French")],
  ["de", t("德语", "German")],
  ["es", t("西班牙语", "Spanish")],
];

/**
 * Under the loop panel while a track has no transcript: transcribe it with AI
 * or import a subtitle file. Also shows a running or failed transcription.
 */
export function TranscribeCard() {
  const current = useApp((s) => s.current);
  const job = useApp((s) => s.job);
  const ready = useApp((s) => featureReady("transcribe", s.ai, s.local));
  const [open, setOpen] = useState(false);
  if (!current) return null;

  const mine = job?.path === current.path ? job : null;
  const elsewhere = job?.state === "running";

  return (
    <section aria-label={t("字幕", "Subtitles")} className="mt-12 animate-fade-in border-t border-line pt-6">
      <h2 className="text-[13px] font-semibold">{t("字幕", "Subtitles")}</h2>
      {mine?.state === "running" ? (
        <Progress job={mine} />
      ) : mine?.state === "failed" ? (
        <Failed message={mine.message} />
      ) : (
        <>
          <p className="mt-1.5 max-w-[34em] text-[13px] leading-relaxed text-muted">
            {elsewhere
              ? t("另一个音频正在转写，完成后才能开始新的。", "Another track is being transcribed. A new one can start when it’s done.")
              : t(
                  "有了字幕，每一句都能点着听、单独循环。可以用 AI 转写，或导入现成的 SRT / VTT 文件。",
                  "With subtitles, you can click any sentence to play it or loop it on its own. Transcribe with AI, or import an SRT / VTT file.",
                )}
          </p>
          {!open && (
            <div className="mt-4 flex items-center gap-2">
              <Button
                primary
                disabled={elsewhere}
                // Nothing set up yet: the setup wizard explains the choices first.
                onClick={() => (ready ? setOpen(true) : useApp.getState().setWizardOpen(true))}
              >
                <Sparkles size={14} strokeWidth={1.9} />
                {t("AI 转写", "AI Transcribe")}
              </Button>
              <Button onClick={() => void useApp.getState().importTranscript()}>
                <FileUp size={14} strokeWidth={1.9} />
                {t("导入字幕文件", "Import Subtitle File")}
              </Button>
            </div>
          )}
          {open && ready && !elsewhere && <TranscribeForm onClose={() => setOpen(false)} />}
        </>
      )}
    </section>
  );
}

function TranscribeForm({ onClose }: { onClose: () => void }) {
  const ai = useApp((s) => s.ai);
  const local = useApp((s) => s.local);
  const duration = useApp((s) => s.duration);
  const saved = useApp((s) => s.settings.transcribeLanguage);
  const { startTranscribe, setSettingsOpen } = useApp.getState();
  const [language, setLanguage] = useState(saved);
  const box = useRef<HTMLDivElement>(null);
  // It opens below the fold on a short window; bring the whole form into view.
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const choice = ai?.config.transcribe;
  const preset = ai?.presets.find((p) => p.id === choice?.provider);
  const builtin = preset?.api === "builtin";
  if (!preset || !choice) return null;

  const price = preset.transcribePrices.find(([m]) => m === choice!.model)?.[1];
  const cost = price && duration > 0 ? price * (duration / 3600) : null;
  const destination = preset.local ? null : preset.baseUrl ? preset.name : t("你填写的地址", "the address you entered");

  return (
    <div ref={box} className="mt-4 flex max-w-[560px] scroll-mb-6 animate-fade-in flex-col gap-3.5 rounded-[14px] p-4 shadow-[inset_0_0_0_1px_var(--line-strong)]">
      <div className="grid grid-cols-[48px_1fr] items-center gap-x-3 gap-y-3">
        <span className="text-[12px] font-medium text-muted">{t("语言", "Language")}</span>
        <div className="flex items-center gap-2">
          <span className="w-32 shrink-0">
            <select className={fieldClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
              {languages().map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </span>
          {!language && <span className="text-[12px] text-faint">{t("指定语言通常更准确", "Choosing a language is usually more accurate.")}</span>}
        </div>
        <span className="text-[12px] font-medium text-muted">{t("服务", "Service")}</span>
        <p className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="truncate">
            {builtin ? `${t("本机", "On this Mac")} · ${local?.models.find((m) => m.id === choice!.model)?.name}` : `${preset.name} · ${choice!.model}`}
          </span>
          {builtin && <span className="shrink-0 text-faint">{t("免费", "Free")}</span>}
          {cost !== null && (
            <span className="shrink-0 text-faint">{cost < 0.01 ? t("不到 $0.01", "Under $0.01") : t(`约 $${cost.toFixed(2)}`, `About $${cost.toFixed(2)}`)}</span>
          )}
          <TextLink onClick={() => setSettingsOpen(true)} className="shrink-0 text-[12px]">
            {t("更改", "Change")}
          </TextLink>
        </p>
      </div>
      <p className="flex items-start gap-1.5 text-[12px] text-faint">
        {destination ? <Cloud size={13} className="mt-0.5 shrink-0" /> : <Laptop size={13} className="mt-0.5 shrink-0" />}
        {t(
          <>{destination ? `音频会上传到 ${destination}。` : "在这台 Mac 上处理。"}转写时可以继续听，完成后字幕会自动出现。</>,
          <>{destination ? `Audio is uploaded to ${destination}.` : "Processed on this Mac."} You can keep listening. Subtitles appear when it’s done.</>,
        )}
      </p>
      <div className="flex justify-end gap-2 border-t border-line pt-3.5">
        <Button onClick={onClose}>{t("取消", "Cancel")}</Button>
        <Button
          primary
          onClick={() => {
            void startTranscribe(language);
            onClose();
          }}
        >
          {t("开始转写", "Start Transcribing")}
        </Button>
      </div>
    </div>
  );
}

function Progress({ job }: { job: Extract<TranscribeStatus, { state: "running" }> }) {
  // Local transcription can take a couple of seconds to stop; show it was heard.
  const [stopping, setStopping] = useState(false);
  const share = job.total > 0 ? job.done / job.total : 0;
  const speakers = job.step === "speakers";
  return (
    <div className="mt-3 max-w-[560px] animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2 text-[13px]">
            <span className="font-medium">{speakers ? t("正在区分说话人…", "Telling speakers apart…") : t("正在转写…", "Transcribing…")}</span>
            {job.done > 0 && (
              <span className="tabular font-mono text-[11px] text-faint">
                {formatTime(job.done)} / {formatTime(job.total)}
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-faint">{t("可以继续听，完成后字幕会自动出现。", "You can keep listening. Subtitles appear when it’s done.")}</p>
        </div>
        <Button
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            useApp.getState().cancelTranscribe();
          }}
        >
          {/* The transcript is done by then: stopping keeps it, without speakers. */}
          {speakers ? (stopping ? t("正在跳过…", "Skipping…") : t("跳过", "Skip")) : stopping ? t("正在取消…", "Canceling…") : t("取消", "Cancel")}
        </Button>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-track">
        <div
          className="h-full rounded-full bg-played transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(3, share * 100)}%` }}
        />
      </div>
    </div>
  );
}

function Failed({ message }: { message: string }) {
  const { dismissJob, setSettingsOpen, startTranscribe } = useApp.getState();
  const language = useApp((s) => s.settings.transcribeLanguage);
  return (
    <div className="mt-3 max-w-[560px] animate-fade-in">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-danger">
        <AlertCircle size={15} />
        {t("转写没有完成", "Transcription didn’t finish")}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed break-words text-danger">{message}</p>
      <div className="mt-3 flex gap-2">
        <Button primary onClick={() => void startTranscribe(language)}>
          {t("重试", "Try Again")}
        </Button>
        <Button onClick={() => setSettingsOpen(true)}>{t("检查设置", "Check Settings")}</Button>
        <Button onClick={dismissJob}>{t("关闭", "Close")}</Button>
      </div>
    </div>
  );
}
