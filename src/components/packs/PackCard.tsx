import { Download, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { PackInfo } from "../../lib/api";
import { formatSize, packFacts, packStage } from "../../lib/packs";
import { useApp } from "../../store";
import { Button, TextLink } from "../ui";

const LANGUAGE: Record<string, string> = { ja: "日语", en: "英语" };

/** One pack: what's in it, and download → progress → 开始练习 (plus update / delete once it's here). */
export function PackCard({ pack }: { pack: PackInfo }) {
  const download = useApp((s) => s.packDownload);
  const busyElsewhere = useApp((s) => s.packDownload?.state === "running" && s.packDownload.id !== pack.id);
  const { downloadPack, cancelPack, openPack, removePack } = useApp.getState();
  const [confirm, setConfirm] = useState(false);
  const stage = packStage(pack, download);

  return (
    <article className="flex flex-col gap-2.5 rounded-[14px] p-4 shadow-[inset_0_0_0_1px_var(--line-strong)]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="font-heading text-[17px] font-semibold tracking-[-0.005em]">{pack.title}</h3>
        <Tag>{LANGUAGE[pack.language] ?? pack.language}</Tag>
        {pack.level && <Tag>{pack.level}</Tag>}
        {pack.voice === "ai" && <Tag title="声音由语音合成生成；对话是为这个应用原创的">AI 配音</Tag>}
        <span className="tabular ml-auto font-mono text-[11px] text-faint">{packFacts(pack)}</span>
      </div>
      {pack.description && <p className="text-[13px] leading-relaxed text-muted">{pack.description}</p>}
      {stage.kind === "failed" && <p className="text-[12px] break-words text-danger">{stage.message}</p>}

      <div className="mt-1 flex min-h-8 items-center gap-3">
        {stage.kind === "get" && (
          <>
            <Button primary disabled={busyElsewhere || !pack.available} onClick={() => void downloadPack(pack.id)}>
              <Download size={14} /> 下载
            </Button>
            <span className="text-[12px] text-faint">不用登录，下载完就能练</span>
          </>
        )}
        {stage.kind === "running" && (
          <>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={Math.round((stage.done / stage.total) * 100)}>
              <div className="h-full rounded-full bg-played transition-[width] duration-200" style={{ width: `${Math.max(2, (stage.done / stage.total) * 100)}%` }} />
            </div>
            <span className="tabular shrink-0 font-mono text-[11px] text-faint">
              {formatSize(stage.done)} / {formatSize(stage.total)}
            </span>
            <Button className="h-7" onClick={cancelPack}>
              取消
            </Button>
          </>
        )}
        {stage.kind === "failed" && !stage.installed && (
          <Button primary disabled={busyElsewhere} onClick={() => void downloadPack(pack.id)}>
            <RefreshCw size={14} /> 重新下载
          </Button>
        )}
        {(stage.kind === "ready" || (stage.kind === "failed" && stage.installed)) && (
          <>
            <Button primary onClick={() => void openPack(pack.id)}>
              <Play size={13} fill="currentColor" strokeWidth={0} /> 开始练习
            </Button>
            {((stage.kind === "ready" && stage.update) || stage.kind === "failed") && (
              <Button disabled={busyElsewhere} onClick={() => void downloadPack(pack.id)}>
                <Download size={14} /> {stage.kind === "failed" ? "重新更新" : "更新到新版"}
              </Button>
            )}
            <span className="ml-auto flex items-center gap-3">
              {confirm ? (
                <>
                  <span className="text-[12px] text-muted">删除后要重新下载，你的录音会保留</span>
                  <Button className="h-7 text-danger" onClick={() => void removePack(pack.id).then(() => setConfirm(false))}>
                    确定删除
                  </Button>
                  <TextLink className="text-[12px]" onClick={() => setConfirm(false)}>
                    取消
                  </TextLink>
                </>
              ) : (
                <TextLink className="text-[12px]" onClick={() => setConfirm(true)}>
                  删除
                </TextLink>
              )}
            </span>
          </>
        )}
      </div>
    </article>
  );
}

function Tag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="rounded-[4px] px-1 text-[11px] leading-4 font-medium text-muted shadow-[inset_0_0_0_1px_currentColor]">
      {children}
    </span>
  );
}
