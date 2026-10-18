import { LoaderCircle, Sparkles, X } from "lucide-react";
import type { AiOverview, Explanation } from "../lib/api";
import type { Explain } from "../explainSlice";
import { useApp } from "../store";
import { Button, IconButton } from "./ui";

/** "ChatGPT · gpt-5-mini", and whether it runs on this Mac. */
function serviceOf(ai: AiOverview | null) {
  const choice = ai?.config.chat;
  const preset = ai?.presets.find((p) => p.id === choice?.provider);
  return preset && choice ? { label: `${preset.name} · ${choice.model}`, local: preset.local } : null;
}

/** Under a sentence: what the model says about it (or that it is being asked, or why not). */
export function ExplainNote({ index, entry }: { index: number; entry: Explain }) {
  const ai = useApp((s) => s.ai);
  const { toggleExplain, retryExplain, setSettingsOpen } = useApp.getState();
  const service = serviceOf(ai);
  const line = "flex flex-wrap items-center gap-x-2.5 gap-y-1";
  return (
    <div className="relative mt-1 mb-2 animate-fade rounded-[10px] border border-line py-2 pr-1.5 pl-3 text-[13px] text-muted">
      {entry.state === "unset" && (
        <div className={line}>
          <span className="min-w-0">解释用「句子解释」的服务，还没有设置好。</span>
          <Button className="h-6 px-2 text-[12px]" onClick={() => setSettingsOpen(true)}>
            去设置
          </Button>
        </div>
      )}
      {entry.state === "running" && (
        <div className={line}>
          <LoaderCircle size={13} className="shrink-0 animate-spin" />
          <span>
            正在请 {service?.label ?? "AI"} 解释这一句…
          </span>
        </div>
      )}
      {entry.state === "failed" && (
        <div className={line}>
          <span className="min-w-0 text-danger">{entry.message}</span>
          <Button className="h-6 px-2 text-[12px]" onClick={() => retryExplain(index)}>
            重试
          </Button>
        </div>
      )}
      {entry.state === "done" && <Answer value={entry.value} />}
      <IconButton title="收起 (I)" onClick={() => toggleExplain(index)} className="absolute top-1.5 right-1.5 !h-6 !min-w-6">
        <X />
      </IconButton>
    </div>
  );
}

function Answer({ value }: { value: Explanation }) {
  return (
    <div className="flex flex-col gap-2 pr-7">
      <div>
        <p className="text-[14px] leading-[22px] text-fg">{value.translation}</p>
        {value.tone && <p className="text-[12px] text-faint">语气：{value.tone}</p>}
      </div>
      {value.parts.length > 0 && (
        <dl className="grid grid-cols-[fit-content(45%)_1fr] items-baseline gap-x-3 gap-y-1">
          {value.parts.map((p, i) => (
            <div key={i} className="contents">
              {/* A long reading goes under the piece whole, not broken mid-word. */}
              <dt className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-script text-[15px] text-fg">{p.text}</span>
                {p.reading && p.reading !== p.text && <span className="text-[12px] whitespace-nowrap text-faint">{p.reading}</span>}
              </dt>
              <dd>
                {p.meaning}
                {p.meaning && p.note && <span className="mx-1.5 text-faint">·</span>}
                {p.note}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {value.source && (
        <p className="flex items-center gap-1 text-[11px] text-faint">
          <Sparkles size={11} className="shrink-0" />
          {value.source} 的解释，可能有误
        </p>
      )}
    </div>
  );
}
