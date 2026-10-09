import { Check, Cloud, Laptop, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api, LOCAL_PROVIDER, type Feature, type Preset } from "../../lib/api";
import { useApp } from "../../store";
import { formatBytes, LocalModels } from "../settings/LocalModels";
import { ProviderSetup } from "../settings/ProviderSetup";

const isLocal = (p: Preset) => p.local;
const isCloud = (p: Preset) => !p.local;

async function choose(feature: Feature, provider: string, model: string) {
  useApp.getState().setAiConfig(await api.ai.choose(feature, provider, model));
}

/** Step 1: transcribe on this Mac (free, private, a download) or with a cloud service (a key, a small fee). */
export function TranscribeStep() {
  const ai = useApp((s) => s.ai)!;
  const local = useApp((s) => s.local);
  const provider = ai.config.transcribe.provider;
  const mode = provider === LOCAL_PROVIDER ? "local" : provider ? "cloud" : null;
  const supported = !!local?.supported;
  const recommended = local?.models.find((m) => m.id === local.recommended);
  const downloaded = local?.models.find((m) => m.downloaded);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-muted">
        转写把没有字幕的音频变成一句一句、带时间的字幕，这样就能点句播放、循环跟读。
      </p>
      <div className={`grid gap-2.5 ${supported ? "grid-cols-2" : "grid-cols-1"}`}>
        {supported && (
          <ChoiceCard
            icon={Laptop}
            title="在这台 Mac 上"
            recommended
            selected={mode === "local"}
            onClick={() => mode !== "local" && void choose("transcribe", LOCAL_PROVIDER, (downloaded ?? recommended)?.id ?? "")}
            points={[
              "免费，可以离线使用",
              "音频不会离开这台 Mac",
              downloaded
                ? `已经下载了 ${downloaded.name}`
                : `需要下载一个模型（按 ${Math.round(local!.ramGb)} GB 内存推荐 ${recommended?.name}，${formatBytes(recommended?.size ?? 0)}）`,
            ]}
          />
        )}
        <ChoiceCard
          icon={Cloud}
          title="云端服务"
          selected={mode === "cloud"}
          onClick={() => mode !== "cloud" && void choose("transcribe", "groq", ai.presets.find((p) => p.id === "groq")?.transcribeModel ?? "")}
          points={["Groq、OpenAI 等，速度很快", "Groq 约 $0.11 / 小时音频", "需要注册并填写 API Key，音频会上传"]}
        />
      </div>
      {!supported && <p className="text-[12px] text-faint">这台 Mac 不是 Apple 芯片，本机转写会非常慢，所以只提供云端服务。</p>}
      {mode === "local" && <LocalModels />}
      {mode === "cloud" && <ProviderSetup feature="transcribe" only={isCloud} allowNone={false} />}
    </div>
  );
}

/** Step 2: a model for explanations, on this Mac (Ollama / LM Studio) or in the cloud. */
export function ChatStep() {
  const ai = useApp((s) => s.ai)!;
  const provider = ai.presets.find((p) => p.id === ai.config.chat.provider);
  const mode = provider ? (provider.local ? "local" : "cloud") : null;
  const [running, setRunning] = useState<{ id: string; models: number }[] | null>(null);
  useEffect(() => void api.ai.detectLocal().then(setRunning, () => setRunning([])), []);
  const server = running?.[0] && ai.presets.find((p) => p.id === running[0].id);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-muted">
        句子解释用大语言模型翻译句子、讲解语法、查词。这个功能在下一个版本启用，现在设置好，到时就能直接用。
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        <ChoiceCard
          icon={Laptop}
          title="本机模型"
          recommended={!!server}
          selected={mode === "local"}
          onClick={() => mode !== "local" && void choose("chat", server?.id ?? "ollama", "")}
          points={[
            "免费，句子不会离开这台 Mac",
            server ? `检测到 ${server.name} 正在运行` : "需要先安装 Ollama 或 LM Studio，再下载一个模型",
            "效果取决于模型大小和内存，建议 Qwen 系列",
          ]}
        />
        <ChoiceCard
          icon={Cloud}
          title="云端服务"
          recommended={running !== null && !server}
          selected={mode === "cloud"}
          onClick={() => mode !== "cloud" && void choose("chat", "openrouter", "")}
          points={["用 OpenRouter 或 ChatGPT 账号登录，不用复制 Key", "也可以填 OpenAI、Anthropic、Gemini、DeepSeek 的 Key", "按用量付费（ChatGPT 账号用套餐额度）"]}
        />
      </div>
      {mode === "local" && <ProviderSetup feature="chat" only={isLocal} allowNone={false} />}
      {mode === "cloud" && <ProviderSetup feature="chat" only={isCloud} allowNone={false} />}
    </div>
  );
}

function ChoiceCard({ icon: Icon, title, points, selected, recommended, onClick }: {
  icon: LucideIcon;
  title: string;
  points: string[];
  selected: boolean;
  recommended?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex flex-col items-start gap-2.5 rounded-[14px] p-4 text-left transition-[background-color,box-shadow,scale] duration-150 ease-snappy active:scale-[0.985] ${
        selected ? "shadow-[inset_0_0_0_1.5px_var(--ink)]" : "shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-hover"
      }`}
    >
      <span className="flex w-full items-center gap-2">
        <Icon size={16} strokeWidth={1.8} className="text-muted" />
        <span className="text-[14px] font-semibold">{title}</span>
        {recommended && <span className="rounded-[4px] px-1 text-[11px] leading-4 font-medium text-ok shadow-[inset_0_0_0_1px_currentColor]">推荐</span>}
        <span className={`ml-auto grid size-[18px] place-items-center rounded-full ${selected ? "bg-ink text-on-ink" : "border-[1.5px] border-line-strong"}`}>
          {selected && <Check size={11} strokeWidth={3} />}
        </span>
      </span>
      <ul className="flex flex-col gap-1 text-[12px] leading-relaxed text-muted">
        {points.map((p) => (
          <li key={p} className="flex gap-1.5">
            <span className="text-faint">·</span>
            {p}
          </li>
        ))}
      </ul>
    </button>
  );
}
