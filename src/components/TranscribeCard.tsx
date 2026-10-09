import { AlertCircle, Cloud, FileUp, Laptop, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TranscribeStatus } from "../lib/api";
import { featureReady } from "../lib/aiReady";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { Button, fieldClass, TextLink } from "./ui";

const LANGUAGES: [string, string][] = [
  ["", "自动识别"],
  ["ja", "日语"],
  ["en", "英语"],
  ["zh", "中文"],
  ["ko", "韩语"],
  ["fr", "法语"],
  ["de", "德语"],
  ["es", "西班牙语"],
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
    <section aria-label="字幕" className="mt-12 animate-fade-in border-t border-line pt-6">
      <h2 className="text-[13px] font-semibold">字幕</h2>
      {mine?.state === "running" ? (
        <Progress job={mine} />
      ) : mine?.state === "failed" ? (
        <Failed message={mine.message} />
      ) : (
        <>
          <p className="mt-1.5 max-w-[34em] text-[13px] leading-relaxed text-muted">
            {elsewhere
              ? "另一个音频正在转写，完成后才能开始新的。"
              : "有了字幕，每一句都能点着听、单独循环。可以用 AI 转写，或导入现成的 SRT / VTT 文件。"}
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
                AI 转写
              </Button>
              <Button onClick={() => void useApp.getState().importTranscript()}>
                <FileUp size={14} strokeWidth={1.9} />
                导入字幕文件
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
  const destination = preset.local ? null : preset.baseUrl ? preset.name : "你填写的地址";

  return (
    <div ref={box} className="mt-4 flex max-w-[560px] scroll-mb-6 animate-fade-in flex-col gap-3.5 rounded-[14px] bg-raised p-4 shadow-cap">
      <div className="grid grid-cols-[48px_1fr] items-center gap-x-3 gap-y-3">
        <span className="text-[12px] font-medium text-muted">语言</span>
        <div className="flex items-center gap-2">
          <span className="w-32 shrink-0">
            <select className={fieldClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </span>
          {!language && <span className="text-[12px] text-faint">指定语言通常更准确</span>}
        </div>
        <span className="text-[12px] font-medium text-muted">服务</span>
        <p className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="truncate">
            {builtin ? `本机 · ${local?.models.find((m) => m.id === choice!.model)?.name}` : `${preset.name} · ${choice!.model}`}
          </span>
          {builtin && <span className="shrink-0 text-faint">免费</span>}
          {cost !== null && (
            <span className="shrink-0 text-faint">{cost < 0.01 ? "不到 $0.01" : `约 $${cost.toFixed(2)}`}</span>
          )}
          <TextLink onClick={() => setSettingsOpen(true)} className="shrink-0 text-[12px]">
            更改
          </TextLink>
        </p>
      </div>
      <p className="flex items-start gap-1.5 text-[12px] text-faint">
        {destination ? <Cloud size={13} className="mt-0.5 shrink-0" /> : <Laptop size={13} className="mt-0.5 shrink-0" />}
        {destination ? `音频会上传到 ${destination}。` : "在这台 Mac 上处理。"}
        转写时可以继续听，完成后字幕会自动出现。
      </p>
      <div className="flex justify-end gap-2 border-t border-line pt-3.5">
        <Button onClick={onClose}>取消</Button>
        <Button
          primary
          onClick={() => {
            void startTranscribe(language);
            onClose();
          }}
        >
          开始转写
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
            <span className="font-medium">{speakers ? "正在区分说话人…" : "正在转写…"}</span>
            {job.done > 0 && (
              <span className="tabular font-mono text-[11px] text-faint">
                {formatTime(job.done)} / {formatTime(job.total)}
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-faint">可以继续听，完成后字幕会自动出现。</p>
        </div>
        <Button
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            useApp.getState().cancelTranscribe();
          }}
        >
          {stopping ? "正在取消…" : "取消"}
        </Button>
      </div>
      <div className="well mt-3 h-[5px] overflow-hidden rounded-full">
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
        转写没有完成
      </p>
      <p className="mt-1 text-[12px] leading-relaxed break-words text-danger">{message}</p>
      <div className="mt-3 flex gap-2">
        <Button primary onClick={() => void startTranscribe(language)}>
          重试
        </Button>
        <Button onClick={() => setSettingsOpen(true)}>检查设置</Button>
        <Button onClick={dismissJob}>关闭</Button>
      </div>
    </div>
  );
}
