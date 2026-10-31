import { Check, Cpu, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { api, LOCAL_PROVIDER, type AiConfig } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useApp } from "../../store";
import { formatBytes, LocalModels } from "../settings/LocalModels";
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
  const [cloud, setCloud] = useState(false);
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
        {t("转写把没有字幕的音频变成一句一句、带时间的字幕。用 Whisper 在本机转写：免费、可离线，音频不会离开这台 Mac。")}
      </p>
      <p className="flex items-center gap-2 text-[12px] text-muted">
        <Cpu size={14} strokeWidth={1.8} className="text-faint" />
        {local.chip} · {t("{ram} GB 内存", { ram: Math.round(local.ramGb) })}
        {local.freeBytes !== null && ` · ${t("可用空间 {size}", { size: formatBytes(local.freeBytes) })}`}
      </p>

      <div className="flex flex-col gap-3 rounded-[14px] p-4 shadow-[inset_0_0_0_1px_var(--line-strong)]">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold">{model.name}</span>
          <span className="rounded-[4px] px-1 text-[11px] leading-4 font-medium text-ok shadow-[inset_0_0_0_1px_currentColor]">{t("推荐")}</span>
          <span className="tabular ml-auto text-[12px] text-faint">{formatBytes(model.size)}</span>
        </div>
        <p className="text-[13px] text-muted">{model.note}</p>
        <p className="text-[12px] text-faint">{t("为什么是它：{reason}", { reason: local.reason })}</p>
        <div className="flex items-center gap-3">
          {model.downloaded ? (
            <span className="flex items-center gap-1.5 text-[13px] text-ok">
              <Check size={15} strokeWidth={2.5} /> {t("已下载，可以用了")}
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
                {t("取消")}
              </Button>
            </>
          ) : (
            <Button primary disabled={busyElsewhere} onClick={() => void start()}>
              <Download size={14} />
              {model.partial > 0 ? t("继续下载（{percent}%）", { percent: Math.round((model.partial / model.size) * 100) }) : t("下载并使用")}
            </Button>
          )}
        </div>
        {download?.state === "failed" && <p className="text-[12px] break-words text-danger">{download.message}</p>}
      </div>

      {inUse && inUse.id !== model.id && !running && (
        <p className="text-[12px] text-muted">
          {t("现在用的是已下载的 {name}，可以直接下一步；下载推荐的模型后会换成它。", { name: inUse.name })}
        </p>
      )}
      <div className="flex items-center gap-5">
        <TextLink className="text-[12px]" onClick={() => setMore(!more)}>
          {more ? t("收起其他模型") : t("选其他模型")}
        </TextLink>
        <TextLink className="text-[12px]" onClick={() => setCloud(!cloud)}>
          {cloud ? t("收起云端服务") : t("改用云端服务（Groq、OpenAI）")}
        </TextLink>
      </div>
      {more && <LocalModels intro={false} />}
      {cloud && <ProviderSetup feature="transcribe" only={(p) => !p.local} allowNone={false} />}
    </div>
  );
}
