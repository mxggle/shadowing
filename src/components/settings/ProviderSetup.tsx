import { AlertTriangle, Check, Cloud, Laptop, LoaderCircle, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type AiConfig, type Feature, type Preset } from "../../lib/api";
import { useApp } from "../../store";
import { Button, fieldClass } from "../ui";
import { KeyField } from "./KeyField";

const save = (config: AiConfig) => useApp.getState().setAiConfig(config);

/** Pick a service for one feature, then fill in what it needs and check it answers. */
export function ProviderSetup({ feature }: { feature: Feature }) {
  const ai = useApp((s) => s.ai)!;
  const choice = ai.config[feature];
  const presets = ai.presets.filter((p) => p.features.includes(feature));
  const preset = presets.find((p) => p.id === choice.provider) ?? null;

  async function pick(id: string | null) {
    if (id === choice.provider) return;
    const p = presets.find((x) => x.id === id);
    const model = (feature === "transcribe" ? p?.transcribeModel : p?.chatModel) ?? "";
    save(await api.ai.choose(feature, id, model));
  }

  return (
    <div className="mt-3">
      <div role="radiogroup" aria-label="服务" className="flex flex-wrap gap-1.5">
        <Chip selected={!preset} onClick={() => void pick(null)}>
          不使用
        </Chip>
        {presets.map((p) => (
          <Chip key={p.id} selected={p.id === preset?.id} onClick={() => void pick(p.id)}>
            {p.name}
            {p.local && <span className="rounded bg-hover px-1 text-[10px] text-muted">本机</span>}
          </Chip>
        ))}
      </div>
      {preset && <Details key={preset.id} feature={feature} preset={preset} config={ai.config} />}
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
        selected ? "bg-accent-soft font-medium text-accent-text ring-1 ring-accent/40 ring-inset" : "bg-hover text-fg hover:bg-press"
      }`}
    >
      {children}
    </button>
  );
}

type TestState = { kind: "idle" } | { kind: "running" } | { kind: "ok" | "warn" | "error"; text: string };

function Details({ feature, preset, config }: { feature: Feature; preset: Preset; config: AiConfig }) {
  const model = config[feature].model;
  const baseUrl = config.baseUrls[preset.id] ?? preset.baseUrl;
  const hint = config.keyHints[preset.id];
  const ready = !!baseUrl && (preset.key !== "required" || !!hint);
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
    setTest({ kind: "running" });
    try {
      const r = await api.ai.test(feature);
      if (!model) setTest({ kind: "warn", text: `连接成功（${r.models} 个可用模型），请选择一个模型` });
      else if (!r.modelFound) setTest({ kind: "warn", text: `连接成功，但没有找到模型“${model}”，请确认名称` });
      else setTest({ kind: "ok", text: `连接成功，可以使用 ${model}` });
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
          <UrlField preset={preset} value={baseUrl} />
        </>
      )}

      {preset.key !== "none" && (
        <>
          <Label>API Key</Label>
          <KeyField preset={preset} hint={hint} onSaved={save} />
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
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="pt-[7px] text-[12px] font-medium text-muted">{children}</span>;
}

function TestResult({ kind, text }: { kind: "ok" | "warn" | "error"; text: string }) {
  const [Icon, color] = { ok: [Check, "text-accent-text"], warn: [AlertTriangle, "text-warn"], error: [X, "text-danger"] }[kind] as [
    typeof Check,
    string,
  ];
  return (
    <p className={`flex min-w-0 animate-fade-in items-start gap-1.5 pt-1.5 text-[12px] ${color}`}>
      <Icon size={14} className="mt-px shrink-0" />
      <span className="break-words">{text}</span>
    </p>
  );
}

/** Saved on blur or Enter; an empty field goes back to the default address. */
function UrlField({ preset, value }: { preset: Preset; value: string }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  async function commit() {
    if (draft.trim() === value) return;
    try {
      save(await api.ai.setBaseUrl(preset.id, draft));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <input
        className={fieldClass}
        value={draft}
        spellCheck={false}
        placeholder={preset.baseUrl || "https://example.com/v1"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

const MANUAL = "\u0000manual";

/** A list when the service gave one; typing by hand is always possible. */
function ModelPicker({ value, models, onChange }: { value: string; models: string[] | null; onChange: (m: string) => void }) {
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const listed = !!models?.length && !manual && (!value || models.includes(value));

  if (listed) {
    return (
      <select
        className={fieldClass}
        value={value}
        onChange={(e) => (e.target.value === MANUAL ? setManual(true) : onChange(e.target.value))}
      >
        {!value && <option value="">请选择模型</option>}
        {models!.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value={MANUAL}>手动输入…</option>
      </select>
    );
  }
  return (
    <input
      className={fieldClass}
      value={draft}
      autoFocus={manual}
      spellCheck={false}
      placeholder="模型名称"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setManual(false);
        onChange(draft.trim());
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
