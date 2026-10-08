import { AlertCircle, Cloud, FileText, FileUp, Laptop, LoaderCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import type { TranscribeStatus } from "../lib/api";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { Button, fieldClass } from "./ui";

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
 * Under the practice panel while a track has no transcript: transcribe it with
 * AI or import a subtitle file. Also shows a running or failed transcription.
 */
export function TranscribeCard() {
  const current = useApp((s) => s.current);
  const job = useApp((s) => s.job);
  const [open, setOpen] = useState(false);
  if (!current) return null;

  const mine = job?.path === current.path ? job : null;
  if (mine?.state === "running") return <Progress job={mine} />;
  if (mine?.state === "failed") return <Failed message={mine.message} />;
  const elsewhere = job?.state === "running";

  return (
    <div className="animate-fade-in rounded-2xl border border-dashed border-line">
      <div className="flex items-center gap-3 px-4 py-3">
        <FileText size={18} className="shrink-0 text-faint" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">还没有字幕</p>
          <p className="text-[12px] text-faint">
            {elsewhere ? "另一个音频正在转写，完成后才能开始新的" : "用 AI 转写成句子，或导入 SRT / VTT 字幕"}
          </p>
        </div>
        <Button onClick={() => void useApp.getState().importTranscript()}>
          <FileUp size={15} />
          导入
        </Button>
        <Button primary={!open} disabled={elsewhere} onClick={() => setOpen(!open)}>
          <Sparkles size={15} />
          AI 转写
        </Button>
      </div>
      {open && !elsewhere && <TranscribeForm onClose={() => setOpen(false)} />}
    </div>
  );
}

function TranscribeForm({ onClose }: { onClose: () => void }) {
  const ai = useApp((s) => s.ai);
  const local = useApp((s) => s.local);
  const duration = useApp((s) => s.duration);
  const saved = useApp((s) => s.settings.transcribeLanguage);
  const { startTranscribe, setSettingsOpen } = useApp.getState();
  const [language, setLanguage] = useState(saved);

  const choice = ai?.config.transcribe;
  const preset = ai?.presets.find((p) => p.id === choice?.provider);
  const builtin = preset?.api === "builtin";
  const ready =
    !!preset &&
    !!choice?.model &&
    (builtin
      ? !!local?.models.find((m) => m.id === choice.model)?.downloaded
      : preset.key !== "required" || !!ai?.config.keyHints[preset.id]);

  if (!ready) {
    return (
      <div className="flex animate-fade-in items-center gap-3 border-t border-line px-4 py-3">
        <p className="min-w-0 flex-1 text-[12px] text-muted">
          {builtin
            ? "本机转写的模型还没有下载完。可以在设置里查看下载进度。"
            : local?.supported
              ? "还没有设置转写服务。可以在这台 Mac 上转写（免费，需要下载一个模型），或用 Groq、OpenAI 等云端服务。"
              : "还没有设置转写服务。可以用 Groq（约 $0.11 / 小时音频）或 OpenAI，需要一个 API Key。"}
        </p>
        <Button primary onClick={() => setSettingsOpen(true)}>
          去设置
        </Button>
      </div>
    );
  }

  const price = preset.transcribePrices.find(([m]) => m === choice!.model)?.[1];
  const cost = price && duration > 0 ? price * (duration / 3600) : null;
  const destination = preset.local ? null : preset.baseUrl ? preset.name : "你填写的地址";

  return (
    <div className="flex animate-fade-in flex-col gap-3 border-t border-line px-4 py-3">
      <div className="grid grid-cols-[48px_1fr] items-center gap-x-3 gap-y-2.5">
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
          <button onClick={() => setSettingsOpen(true)} className="shrink-0 text-[12px] text-accent-text hover:underline">
            更改
          </button>
        </p>
      </div>
      <p className="flex items-start gap-1.5 text-[12px] text-faint">
        {destination ? <Cloud size={13} className="mt-0.5 shrink-0" /> : <Laptop size={13} className="mt-0.5 shrink-0" />}
        {destination ? `音频会上传到 ${destination}。` : "在这台 Mac 上处理。"}
        转写时可以继续听，完成后字幕会自动出现。
      </p>
      <div className="flex justify-end gap-2">
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
  return (
    <div className="animate-fade-in rounded-2xl border border-line bg-panel px-4 py-3">
      <div className="flex items-center gap-3">
        <LoaderCircle size={18} className="shrink-0 animate-spin text-accent-text" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">正在转写…</p>
          <p className="tabular truncate text-[12px] text-faint">
            {job.done > 0 ? `${formatTime(job.done)} / ${formatTime(job.total)}` : "正在准备音频"} · 可以继续听，完成后字幕会自动出现
          </p>
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
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-track">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
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
    <div className="animate-fade-in rounded-2xl border border-danger/25 bg-danger-soft px-4 py-3">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-danger">
        <AlertCircle size={15} />
        转写没有完成
      </p>
      <p className="mt-1 text-[12px] break-words text-danger">{message}</p>
      <div className="mt-2.5 flex justify-end gap-2">
        <Button onClick={dismissJob}>关闭</Button>
        <Button onClick={() => setSettingsOpen(true)}>检查设置</Button>
        <Button primary onClick={() => void startTranscribe(language)}>
          重试
        </Button>
      </div>
    </div>
  );
}
