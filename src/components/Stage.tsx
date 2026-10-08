import { AlertCircle } from "lucide-react";
import { useApp } from "../store";
import { LoopPanel, LoopStrip } from "./Loop";
import { TranscribeCard } from "./TranscribeCard";
import { SentenceList } from "./Transcript";

/**
 * Main area above the player bar: what you're practising. With a transcript
 * that's the sentence list; without one it's the A–B loop.
 */
export function Stage() {
  const hasTrack = useApp((s) => !!s.current);
  const hasTranscript = useApp((s) => !!s.transcript?.sentences.length);

  if (!hasTrack) {
    return (
      <div className="flex min-h-0 flex-1 animate-fade-in flex-col justify-center px-10">
        <h1 className="text-[28px] font-semibold tracking-tight text-muted">选择一个音频开始练习</h1>
        <p className="mt-2 text-[14px] text-faint">从左侧列表点选，或按空格播放第一首。</p>
      </div>
    );
  }

  if (hasTranscript) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TrackTitle />
        <SentenceList />
        <LoopStrip />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <TrackTitle />
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-10 px-10 pt-8 pb-10">
        <LoopPanel />
        <TranscribeCard />
      </div>
    </div>
  );
}

function TrackTitle() {
  const current = useApp((s) => s.current)!;
  const error = useApp((s) => s.error);
  return (
    <div key={current.path} className="mx-auto w-full max-w-[760px] shrink-0 animate-fade-in px-10 pt-2">
      <h1 className="line-clamp-2 text-[28px] leading-tight font-semibold tracking-tight break-words" title={current.name}>
        {current.name}
      </h1>
      {error && (
        <p className="mt-3 flex w-fit max-w-full items-start gap-1.5 rounded-lg bg-danger-soft px-3 py-1.5 text-[13px] text-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </p>
      )}
    </div>
  );
}
