import { Check, Cpu, Download, KeyRound, LoaderCircle, LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { featureReady } from "../../lib/aiReady";
import { api, LOCAL_PROVIDER, type AiConfig } from "../../lib/api";
import { useApp } from "../../store";
import { formatBytes } from "../settings/LocalModels";
import { ProviderSetup } from "../settings/ProviderSetup";
import { Button, TextLink } from "../ui";
import { TranscribeStep } from "./WizardSteps";

const setConfig = (c: AiConfig) => useApp.getState().setAiConfig(c);

/**
 * The Whisper model that suits this Mac (chip, memory, free disk), one click
 * to download it in the background. Intel Macs get the cloud services instead.
 */
export function ModelStep() {
  const local = useApp((s) => s.local);
  const provider = useApp((s) => s.ai?.config.transcribe.provider ?? null);
  const [more, setMore] = useState(false);
  const model = local?.models.find((m) => m.id === local.recommended);
  const download = useApp((s) => (model && s.download?.id === model.id ? s.download : null));
  const inUse = useApp((s) => {
    const c = s.ai?.config.transcribe;
    return c?.provider === LOCAL_PROVIDER ? s.local?.models.find((m) => m.id === c.model && m.downloaded) : undefined;
  });
  const busyElsewhere = useApp((s) => s.download?.state === "running" && s.download.id !== model?.id);

  // A model already on disk (from an earlier install) is used straight away.
  useEffect(() => {
    const have = local?.models.find((m) => m.downloaded);
    if (!provider && have) void api.ai.choose("transcribe", LOCAL_PROVIDER, have.id).then(setConfig);
  }, [local, provider]);

  if (!local?.supported || !model) return <TranscribeStep />;

  async function start() {
    if (!model) return;
    setConfig(await api.ai.choose("transcribe", LOCAL_PROVIDER, model.id));
    try {
      await api.local.download(model.id);
      useApp.setState({ download: { state: "running", id: model.id, done: model.partial, total: model.size } });
    } catch (e) {
      useApp.setState({ download: { state: "failed", id: model.id, message: String(e) } });
    }
  }

  const running = download?.state === "running";
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-muted">
        转写把没有字幕的音频变成一句一句、带时间的字幕。用 Whisper 在本机转写：免费、可离线，音频不会离开这台 Mac。
      </p>
      <p className="flex items-center gap-2 text-[12px] text-muted">
        <Cpu size={14} strokeWidth={1.8} className="text-faint" />
        {local.chip} · {Math.round(local.ramGb)} GB 内存{local.freeBytes !== null && ` · 可用空间 ${formatBytes(local.freeBytes)}`}
      </p>

      <div className="flex flex-col gap-3 rounded-[14px] p-4 shadow-[inset_0_0_0_1px_var(--line-strong)]">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold">{model.name}</span>
          <span className="rounded-[4px] px-1 text-[11px] leading-4 font-medium text-ok shadow-[inset_0_0_0_1px_currentColor]">推荐</span>
          <span className="tabular ml-auto text-[12px] text-faint">{formatBytes(model.size)}</span>
        </div>
        <p className="text-[13px] text-muted">{model.note}</p>
        <p className="text-[12px] text-faint">为什么是它：{local.reason}</p>
        <div className="flex items-center gap-3">
          {model.downloaded ? (
            <span className="flex items-center gap-1.5 text-[13px] text-ok">
              <Check size={15} strokeWidth={2.5} /> 已下载，可以用了
            </span>
          ) : running ? (
            <>
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-track">
                <div
                  className="h-full rounded-full bg-played transition-[width] duration-300"
                  style={{ width: `${Math.max(2, (download.done / (download.total || model.size)) * 100)}%` }}
                />
              </div>
              <span className="tabular shrink-0 font-mono text-[11px] text-faint">
                {formatBytes(download.done)} / {formatBytes(download.total || model.size)}
              </span>
              <Button className="h-7" onClick={() => void api.local.cancel()}>
                取消
              </Button>
            </>
          ) : (
            <Button primary disabled={busyElsewhere} onClick={() => void start()}>
              <Download size={14} />
              {model.partial > 0 ? `继续下载（${Math.round((model.partial / model.size) * 100)}%）` : "下载并使用"}
            </Button>
          )}
        </div>
        {download?.state === "failed" && <p className="text-[12px] break-words text-danger">{download.message}</p>}
      </div>

      {inUse && inUse.id !== model.id && !running && (
        <p className="text-[12px] text-muted">现在用的是已下载的 {inUse.name}，可以直接下一步；下载推荐的模型后会换成它。</p>
      )}
      <TextLink className="text-[12px]" onClick={() => setMore(!more)}>
        {more ? "收起其他模型" : "选其他模型，或改用云端服务"}
      </TextLink>
      {more && <TranscribeStep />}
    </div>
  );
}

type SignIn = "chatgpt" | "openrouter";

/**
 * Explanations and proofreading need a language model: sign in with a plan the
 * learner already pays for, or paste an API key.
 */
export function AccountStep() {
  const ai = useApp((s) => s.ai)!;
  const ready = useApp((s) => featureReady("chat", s.ai, s.local));
  const [busy, setBusy] = useState<SignIn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState(false);
  const chosen = ai.presets.find((p) => p.id === ai.config.chat.provider);

  async function signIn(id: SignIn) {
    setBusy(id);
    setError(null);
    try {
      setConfig(id === "chatgpt" ? await api.ai.signInChatGPT() : await api.ai.signInOpenRouter());
      let model = ai.presets.find((p) => p.id === id)?.chatModel ?? "";
      if (!model) model = (await api.ai.models(id, "chat").catch(() => []))[0] ?? "";
      setConfig(await api.ai.choose("chat", id, model));
    } catch (e) {
      if (!String(e).includes("已取消")) setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const signedIn = (id: string) => !!ai.config.keyHints[id];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-muted">
        句子解释和字幕校对要用大语言模型。用你已有的订阅登录，或者填一个 API Key。Key 和登录信息只存在 macOS 钥匙串里。
      </p>
      {ready && chosen && (
        <p className="flex items-center gap-2 text-[13px]">
          <Check size={15} strokeWidth={2.5} className="text-ok" />
          句子解释会用 {chosen.name}
          <span className="text-faint">（{ai.config.chat.model}）</span>
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Option
          title="ChatGPT 账号"
          recommended
          text="用 Plus / Pro 套餐的额度，不需要 API Key（OpenAI 的预览功能）"
          done={signedIn("chatgpt") && chosen?.id === "chatgpt"}
          busy={busy === "chatgpt"}
          disabled={busy !== null}
          onClick={() => void signIn("chatgpt")}
        />
        <Option
          title="OpenRouter"
          text="一个账号用 Claude、Gemini、DeepSeek 等多家模型，按用量付费"
          done={signedIn("openrouter") && chosen?.id === "openrouter"}
          busy={busy === "openrouter"}
          disabled={busy !== null}
          onClick={() => void signIn("openrouter")}
        />
        {busy && (
          <p className="flex items-center gap-2 text-[12px] text-muted">
            请在浏览器里完成授权…
            <TextLink className="text-[12px]" onClick={() => void api.ai.cancelSignIn()}>
              取消
            </TextLink>
          </p>
        )}
        {error && <p className="text-[12px] break-words text-danger">{error}</p>}
      </div>

      <TextLink className="flex items-center gap-1.5 text-[12px]" onClick={() => setKeys(!keys)}>
        <KeyRound size={13} />
        {keys ? "收起" : "填写 API Key（OpenAI、Anthropic、Gemini、DeepSeek…），或用本机模型"}
      </TextLink>
      {keys && <ProviderSetup feature="chat" allowNone={false} />}
    </div>
  );
}

function Option({ title, text, recommended, done, busy, disabled, onClick }: {
  title: string;
  text: string;
  recommended?: boolean;
  done: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] px-4 py-3 shadow-[inset_0_0_0_1px_var(--line-strong)]">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[14px] font-semibold">
          {title}
          {recommended && <span className="rounded-[4px] px-1 text-[11px] leading-4 font-medium text-ok shadow-[inset_0_0_0_1px_currentColor]">推荐</span>}
        </p>
        <p className="mt-0.5 text-[12px] text-muted">{text}</p>
      </div>
      {done ? (
        <span className="flex items-center gap-1.5 text-[13px] text-ok">
          <Check size={15} strokeWidth={2.5} /> 已登录
        </span>
      ) : (
        <Button primary={recommended} disabled={disabled} onClick={onClick}>
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : <LogIn size={14} />}
          登录
        </Button>
      )}
    </div>
  );
}
