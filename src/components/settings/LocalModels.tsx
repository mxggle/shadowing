import { Check, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { api, LOCAL_PROVIDER, type LocalModel } from "../../lib/api";
import { useApp } from "../../store";
import { Button } from "../ui";

export function formatBytes(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

const FIT_LABEL = { good: null, tight: "内存偏紧", tooBig: "内存不够" } as const;

/** "本机" transcription: pick a Whisper model, download it (in the background), delete it. */
export function LocalModels() {
  const local = useApp((s) => s.local);
  const chosen = useApp((s) => s.ai?.config.transcribe.model ?? "");
  const choose = async (id: string) => useApp.getState().setAiConfig(await api.ai.choose("transcribe", LOCAL_PROVIDER, id));

  // Picking "本机" without a model yet: use one already downloaded, else the one that suits this Mac.
  useEffect(() => {
    if (!local || local.models.some((m) => m.id === chosen)) return;
    const ready = local.models.filter((m) => m.downloaded);
    void choose((ready.find((m) => m.id === local.recommended) ?? ready[0])?.id ?? local.recommended);
  }, [local, chosen]);

  if (!local) return null;
  const chosenModel = local.models.find((m) => m.id === chosen);
  return (
    <div className="mt-4 flex animate-fade-in flex-col gap-2 border-t border-line pt-4">
      <p className="text-[12px] text-muted">
        在这台 Mac 上用 Whisper 转写：免费、可离线，音频不会离开本机。
        <span className="text-faint">
          {" "}
          这台 Mac：{Math.round(local.ramGb)} GB 内存{local.freeBytes !== null && ` · 可用空间 ${formatBytes(local.freeBytes)}`}
        </span>
      </p>
      <div role="radiogroup" aria-label="模型" className="flex flex-col gap-1">
        {local.models.map((m) => (
          <Row key={m.id} model={m} selected={m.id === chosen} recommended={m.id === local.recommended} onSelect={() => void choose(m.id)} />
        ))}
      </div>
      {chosenModel && !chosenModel.downloaded && (
        <p className="text-[12px] text-warn">选中的模型还没有下载，下载完成后就能转写。下载时可以关闭设置继续使用。</p>
      )}
    </div>
  );
}

function Row({ model, selected, recommended, onSelect }: {
  model: LocalModel;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  const download = useApp((s) => (s.download?.id === model.id ? s.download : null));
  const busyElsewhere = useApp((s) => s.download?.state === "running" && s.download.id !== model.id);
  const running = download?.state === "running";
  const fit = FIT_LABEL[model.fit];
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={-1}
      onClick={onSelect}
      className={`flex flex-col gap-1.5 rounded-[10px] px-3 py-2.5 transition-[background-color,box-shadow] duration-150 ${
        selected ? "bg-hover" : "hover:bg-hover/60"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`grid size-4 shrink-0 place-items-center rounded-full ${selected ? "bg-ink" : "border-[1.5px] border-line-strong"}`}>
          {selected && <span className="size-1.5 rounded-full bg-on-ink" />}
        </span>
        <span className={`text-[13px] ${selected ? "font-medium" : ""}`}>{model.name}</span>
        {recommended && <Badge tone="ok">推荐</Badge>}
        {fit && <Badge tone={model.fit === "tooBig" ? "danger" : "warn"}>{fit}</Badge>}
        <span className="tabular ml-auto shrink-0 text-[12px] text-faint">{formatBytes(model.size)}</span>
        <Action model={model} running={running} disabled={busyElsewhere} />
      </div>
      <p className="pl-6 text-[12px] text-muted">{model.note}</p>
      {running && <Progress done={download.done} total={download.total || model.size} />}
      {download?.state === "failed" && <p className="pl-6 text-[12px] break-words text-danger">{download.message}</p>}
    </div>
  );
}

function Action({ model, running, disabled }: { model: LocalModel; running: boolean; disabled: boolean }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirm]);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (running) {
    return (
      <Button onClick={(e) => (stop(e), void api.local.cancel())} className="h-7">
        取消
      </Button>
    );
  }
  if (model.downloaded) {
    return (
      <span className="flex items-center gap-1.5" onClick={stop}>
        <Check size={14} className="text-ok" aria-label="已下载" />
        <Button
          className={`h-7 ${confirm ? "text-danger" : ""}`}
          onClick={async () => {
            if (!confirm) return setConfirm(true);
            useApp.getState().setLocal(await api.local.remove(model.id));
          }}
        >
          {confirm ? "确认删除" : "删除"}
        </Button>
      </span>
    );
  }
  return (
    <Button
      className="h-7"
      disabled={disabled}
      title={disabled ? "另一个模型正在下载" : undefined}
      onClick={async (e) => {
        stop(e);
        try {
          await api.local.download(model.id);
          useApp.setState({ download: { state: "running", id: model.id, done: model.partial, total: model.size } });
        } catch (err) {
          useApp.setState({ download: { state: "failed", id: model.id, message: String(err) } });
        }
      }}
    >
      <Download size={13} />
      {model.partial > 0 ? `继续下载（${Math.round((model.partial / model.size) * 100)}%）` : "下载"}
    </Button>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-2 pl-6">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full bg-played transition-[width] duration-300" style={{ width: `${Math.max(2, (done / total) * 100)}%` }} />
      </div>
      <span className="tabular shrink-0 font-mono text-[11px] text-faint">
        {formatBytes(done)} / {formatBytes(total)}
      </span>
    </div>
  );
}

function Badge({ tone, children }: { tone: "ok" | "warn" | "danger"; children: React.ReactNode }) {
  const color = { ok: "text-ok", warn: "text-warn", danger: "text-danger" }[tone];
  return <span className={`shrink-0 rounded-[4px] px-1 text-[11px] leading-4 font-medium shadow-[inset_0_0_0_1px_currentColor] ${color}`}>{children}</span>;
}
