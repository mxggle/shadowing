import { Cloud, Laptop, LoaderCircle, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type AiConfig, type Feature, type Preset } from "../../lib/api";
import { useApp } from "../../store";
import { serviceReady } from "../../lib/aiReady";
import { Button } from "../ui";
import { Label, ModelPicker, TestResult, UrlField } from "./fields";
import { KeyField } from "./KeyField";
import { ChatGPTAccount } from "./ChatGPTAccount";
import { LocalModels } from "./LocalModels";
import { OpenRouterSignIn } from "./OpenRouterSignIn";

const save = (config: AiConfig) => useApp.getState().setAiConfig(config);

/**
 * Pick a service for one feature, then fill in what it needs and check it answers.
 * The setup wizard narrows the list (`only`) and hides "不使用".
 */
export function ProviderSetup({ feature, only, allowNone = true }: {
  feature: Feature;
  only?: (p: Preset) => boolean;
  allowNone?: boolean;
}) {
  const ai = useApp((s) => s.ai)!;
  const choice = ai.config[feature];
  const presets = ai.presets.filter((p) => p.features.includes(feature) && (!only || only(p)));
  const preset = presets.find((p) => p.id === choice.provider) ?? null;
  // Which local servers (Ollama, LM Studio) are running, so the choice is obvious.
  const [running, setRunning] = useState<Record<string, number>>({});
  useEffect(() => {
    if (feature !== "chat") return;
    void api.ai.detectLocal().then((list) => setRunning(Object.fromEntries(list.map((r) => [r.id, r.models]))));
  }, [feature]);

  async function pick(id: string | null) {
    if (id === choice.provider) return;
    const p = presets.find((x) => x.id === id);
    const model = (feature === "transcribe" ? p?.transcribeModel : p?.chatModel) ?? "";
    save(await api.ai.choose(feature, id, model));
  }

  return (
    <div className="mt-3">
      <div role="radiogroup" aria-label="服务" className="flex flex-wrap gap-1.5">
        {allowNone && (
          <Chip selected={!preset} onClick={() => void pick(null)}>
            不使用
          </Chip>
        )}
        {presets.map((p) => (
          <Chip key={p.id} selected={p.id === preset?.id} onClick={() => void pick(p.id)}>
            {p.name}
            {p.local && p.api !== "builtin" && <span className="rounded border border-current/30 px-1 text-[11px] opacity-75">本机</span>}
            {p.api === "responses" && <span className="rounded border border-current/30 px-1 text-[11px] opacity-75">预览</span>}
            {running[p.id] !== undefined && (
              <span title={`正在运行，有 ${running[p.id]} 个模型`} className="size-1.5 rounded-full bg-ok" />
            )}
          </Chip>
        ))}
      </div>
      {preset?.api === "builtin" && <LocalModels />}
      {preset && preset.api !== "builtin" && <Details key={preset.id} feature={feature} preset={preset} config={ai.config} />}
    </div>
  );
}

function Chip({ selected, children, onClick }: { selected: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] transition-[background-color,color,scale] duration-150 ease-snappy active:scale-[0.96] ${
        selected ? "bg-ink font-medium text-on-ink" : "bg-hover text-fg hover:bg-press"
      }`}
    >
      {children}
    </button>
  );
}

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok" | "warn" | "error"; text: string; sample?: string | null; reply?: string | null };

function Details({ feature, preset, config }: { feature: Feature; preset: Preset; config: AiConfig }) {
  const model = config[feature].model;
  const baseUrl = config.baseUrls[preset.id] ?? preset.baseUrl;
  const hint = config.keyHints[preset.id];
  const ready = serviceReady(preset, config);
  const [models, setModels] = useState<string[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  const chooseModel = useCallback(
    async (m: string) => {
      if (m !== model) save(await api.ai.choose(feature, preset.id, m));
      setTest({ kind: "idle" });
    },
    [feature, preset.id, model],
  );

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.ai.models(preset.id, feature);
      setModels(list);
      setListError(null);
      // A local server's installed models are all fair choices; pick one so it just works.
      if (!model && preset.local && list[0]) void chooseModel(list[0]);
    } catch (e) {
      setModels(null);
      setListError(String(e));
    } finally {
      setLoading(false);
    }
  }, [preset, feature, model, chooseModel]);

  // Fetch the list as soon as the service is reachable in principle (and again when key or address change).
  useEffect(() => {
    setTest({ kind: "idle" });
    if (ready) void fetchModels();
    else setModels(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hint, baseUrl]);

  async function runTest() {
    if (!model) return setTest({ kind: "warn", text: "请先选择一个模型" });
    setTest({ kind: "running" });
    try {
      const r = await api.ai.test(feature);
      if (!r.modelFound) setTest({ kind: "warn", text: `连接成功，但没有找到模型“${model}”，请确认名称` });
      else
        setTest({
          kind: "ok",
          text: r.reply ? `连接成功，${model} 用了 ${(r.millis / 1000).toFixed(1)} 秒回答` : `连接成功，可以使用 ${model}`,
          sample: r.sample,
          reply: r.reply,
        });
    } catch (e) {
      setTest({ kind: "error", text: String(e) });
    }
  }

  const sends = feature === "transcribe" ? "转写时音频会上传到" : "要解释的句子会发送到";
  return (
    <div className="mt-3 grid animate-fade-in grid-cols-[64px_1fr] items-start gap-x-3 gap-y-3 border-t border-line pt-3">
      <p className="col-span-2 flex flex-col gap-1 text-[12px] text-muted">
        <span>{preset.note}</span>
        <span className="flex items-center gap-1.5 text-faint">
          {preset.local ? <Laptop size={13} /> : <Cloud size={13} />}
          {preset.local ? "在这台 Mac 上运行，内容不会离开本机" : `${sends}${preset.baseUrl ? ` ${preset.name}` : "你填写的地址"}`}
        </span>
      </p>

      {(preset.local || !preset.baseUrl) && (
        <>
          <Label>地址</Label>
          <UrlField preset={preset} value={baseUrl} onSaved={save} />
        </>
      )}

      {preset.key === "account" && (
        <>
          <Label>账号</Label>
          <ChatGPTAccount email={hint} onSaved={save} />
        </>
      )}

      {(preset.key === "required" || preset.key === "optional") && (
        <>
          <Label>API Key</Label>
          <div className="flex min-w-0 flex-col gap-2">
            {preset.id === "openrouter" && !hint && <OpenRouterSignIn onSaved={save} />}
            <KeyField preset={preset} hint={hint} onSaved={save} />
          </div>
        </>
      )}

      <Label>模型</Label>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex gap-2">
          <ModelPicker value={model} models={models} onChange={(m) => void chooseModel(m)} />
          <Button title="重新获取模型列表" disabled={!ready || loading} onClick={() => void fetchModels()} className="w-8 px-0">
            <RotateCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
        {listError && <p className="text-[12px] break-words text-danger">{listError}</p>}
      </div>

      <span />
      <div className="flex min-w-0 items-start gap-3">
        <Button disabled={!ready || test.kind === "running"} onClick={() => void runTest()}>
          {test.kind === "running" && <LoaderCircle size={14} className="animate-spin" />}
          测试连接
        </Button>
        {(test.kind === "ok" || test.kind === "warn" || test.kind === "error") && <TestResult kind={test.kind} text={test.text} />}
      </div>
      {test.kind === "ok" && test.reply && (
        <figure className="col-span-2 animate-fade-in rounded-lg border border-line bg-elevated px-3 py-2 text-[12px] leading-relaxed">
          <figcaption className="text-faint">示例：{test.sample}</figcaption>
          <p className="mt-1 whitespace-pre-wrap">{test.reply}</p>
        </figure>
      )}
    </div>
  );
}
