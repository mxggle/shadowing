import { ArrowRight, LoaderCircle, Sparkles, SpellCheck, X } from "lucide-react";
import type { Suggestion } from "../lib/api";
import { featureReady } from "../lib/aiReady";
import { useApp } from "../store";
import { Button, IconButton, TextLink } from "./ui";

/** Header button: opens the proofread bar, which asks before sending anything. */
export function ProofreadButton() {
  const open = useApp((s) => !!s.proofread);
  const { openProofread, closeProofread } = useApp.getState();
  return (
    <IconButton title="AI 校对：找出可能听错的字" active={open} onClick={() => (open ? closeProofread() : openProofread())}>
      <SpellCheck />
    </IconButton>
  );
}

const bar = "mx-auto flex w-full max-w-[760px] animate-fade items-center gap-2 pr-8 pb-2.5 pl-10 text-[12px] text-muted";
const small = "h-7 px-2.5 text-[12px]";

/** Under the list header: what will be sent where, then progress, then what was found. */
export function ProofreadBar() {
  const proofread = useApp((s) => s.proofread);
  const count = useApp((s) => s.transcript?.sentences.length ?? 0);
  const ai = useApp((s) => s.ai);
  const ready = useApp((s) => featureReady("chat", s.ai, s.local));
  const { startProofread, cancelProofread, closeProofread, acceptAll, setSettingsOpen } = useApp.getState();
  if (!proofread) return null;
  const choice = ai?.config.chat;
  const preset = ai?.presets.find((p) => p.id === choice?.provider);
  const service = preset && choice ? { label: `${preset.name} · ${choice.model}`, local: preset.local } : null;
  const close = (
    <IconButton title="关闭" onClick={closeProofread} className="ml-auto">
      <X />
    </IconButton>
  );

  if (proofread.state === "ready" && (!ready || !service)) {
    return (
      <div className={bar}>
        <span>AI 校对用「句子解释」的服务，还没有设置好。</span>
        <Button className={small} onClick={() => setSettingsOpen(true)}>
          去设置
        </Button>
        {close}
      </div>
    );
  }
  if (proofread.state === "ready") {
    return (
      <div className={bar}>
        <Sparkles size={13} className="shrink-0" />
        <span className="min-w-0">
          把这 <span className="tabular font-mono">{count}</span> 句文字{service!.local ? "交给本机的" : "发给"} {service!.label}
          ，找出可能听错的字。只给建议，改不改由你决定。
        </span>
        <Button primary className={small} onClick={() => void startProofread()}>
          开始校对
        </Button>
        {close}
      </div>
    );
  }
  if (proofread.state === "running") {
    return (
      <div className={bar}>
        <LoaderCircle size={13} className="shrink-0 animate-spin" />
        <span>
          正在校对…
          {proofread.total > 1 && (
            <span className="tabular font-mono">
              {" "}
              {proofread.done + 1} / {proofread.total}
            </span>
          )}
        </span>
        <TextLink className="text-[12px]" onClick={cancelProofread}>
          取消
        </TextLink>
      </div>
    );
  }
  if (proofread.state === "failed") {
    return (
      <div className={bar}>
        <span className="min-w-0 text-danger">{proofread.message}</span>
        <Button className={small} onClick={() => void startProofread()}>
          重试
        </Button>
        {close}
      </div>
    );
  }
  if (!proofread.suggestions.length) {
    return (
      <div className={bar}>
        <Sparkles size={13} className="shrink-0" />
        <span>AI 没有发现明显听错的字。</span>
        {close}
      </div>
    );
  }
  return (
    <div className={bar}>
      <Sparkles size={13} className="shrink-0" />
      <button title="播放下一处" onClick={playNext} className="transition-colors hover:text-fg">
        AI 找到 <span className="tabular font-mono">{proofread.suggestions.length}</span> 处可能听错，写在句子下面
      </button>
      <Button className={`${small} ml-auto`} onClick={() => void acceptAll()}>
        全部改正
      </Button>
      <TextLink className="text-[12px]" onClick={closeProofread}>
        全部忽略
      </TextLink>
    </div>
  );
}

/** Plays the next sentence with a suggestion, so it can be checked by ear. */
function playNext() {
  const { proofread, transcript, time, playSentence } = useApp.getState();
  if (proofread?.state !== "done" || !transcript) return;
  const rows = [...new Set(proofread.suggestions.map((s) => s.index))].sort((a, b) => a - b);
  const next = rows.find((i) => transcript.sentences[i].start > time + 0.5) ?? rows[0];
  if (next !== undefined) playSentence(next);
}

/** Under a sentence: the AI's fix, its reason, and accept / ignore. */
export function SuggestionNote({ suggestion }: { suggestion: Suggestion }) {
  const { acceptSuggestion, ignoreSuggestion } = useApp.getState();
  return (
    <div className="mt-0.5 mb-1.5 flex animate-fade flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted">
      <span className="flex items-center gap-1.5 font-script text-[15px] text-fg">
        <Sparkles size={12} className="shrink-0 text-muted" aria-label="AI 建议" />
        <span className="line-through decoration-faint">{suggestion.from}</span>
        <ArrowRight size={12} className="shrink-0 text-faint" />
        <span>{suggestion.to}</span>
      </span>
      {suggestion.reason && <span className="min-w-0">{suggestion.reason}</span>}
      <span className="flex items-center gap-2">
        <Button className="h-6 px-2 text-[12px]" onClick={() => void acceptSuggestion(suggestion)}>
          改正
        </Button>
        <TextLink className="text-[12px]" onClick={() => ignoreSuggestion(suggestion)}>
          忽略
        </TextLink>
      </span>
    </div>
  );
}
