import { AlertCircle, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward } from "lucide-react";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { PracticePanel } from "./PracticePanel";
import { Scrubber } from "./Scrubber";
import { TranscribeCard } from "./TranscribeCard";
import { SentenceList } from "./Transcript";
import { RoundButton } from "./ui";

/**
 * Main column: what's playing, where you are in it, and the controls to practise with.
 * With a transcript, the sentence list takes the free space and the controls sit below it.
 */
export function Stage() {
  const hasTranscript = useApp((s) => !!s.transcript?.sentences.length);

  if (hasTranscript) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-8 pb-6">
        <div className="mx-auto flex min-h-0 w-full max-w-[680px] flex-1 flex-col gap-4">
          <TrackTitle />
          <SentenceList />
          <div className="shrink-0">
            <Scrubber />
            <Times />
            <Transport />
          </div>
          <div className="shrink-0">
            <PracticePanel />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pb-8">
      {/* my-auto centres the content but still lets it scroll when the window is short. */}
      <div className="mx-auto my-auto flex w-full max-w-[560px] flex-col gap-7">
        <TrackTitle />
        <div>
          <Scrubber />
          <Times />
          <Transport />
        </div>
        <PracticePanel />
        <TranscribeCard />
      </div>
    </div>
  );
}

function TrackTitle() {
  const current = useApp((s) => s.current);
  const folderName = useApp((s) => s.folder?.name);
  const error = useApp((s) => s.error);

  if (!current) {
    return (
      <div className="animate-fade-in text-center">
        <h1 className="text-[22px] font-semibold tracking-tight text-muted">选择一个音频开始练习</h1>
        <p className="mt-1.5 text-[13px] text-faint">从左侧列表点选，或按空格播放第一首</p>
      </div>
    );
  }
  return (
    <div key={current.path} className="animate-fade-in text-center">
      <div className="truncate text-xs font-medium text-faint">
        {current.relDir ? `${folderName} / ${current.relDir}` : folderName}
      </div>
      <h1 className="mt-1 line-clamp-2 text-[22px] leading-snug font-semibold tracking-tight break-words" title={current.name}>
        {current.name}
      </h1>
      {error && (
        <p className="mx-auto mt-3 flex w-fit max-w-full items-start gap-1.5 rounded-lg bg-danger-soft px-3 py-1.5 text-left text-[13px] text-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </p>
      )}
    </div>
  );
}

function Times() {
  const time = useApp((s) => s.time);
  const duration = useApp((s) => s.duration);
  return (
    <div className="tabular -mt-0.5 flex justify-between text-[11px] font-medium text-faint">
      <span>{formatTime(time)}</span>
      <span>{formatTime(duration)}</span>
    </div>
  );
}

function Transport() {
  const hasTrack = useApp((s) => !!s.current);
  const hasTracks = useApp((s) => !!s.folder?.tracks.length);
  const playing = useApp((s) => s.playing);
  const seekStep = useApp((s) => s.settings.seekStep);
  const { toggle, jump, step } = useApp.getState();
  const disabled = !hasTrack;

  return (
    <div className="mt-2 flex items-center justify-center gap-3">
      <RoundButton title="上一首 (↑)" flash="prev" disabled={disabled} onClick={() => step(-1)}>
        <SkipBack size={19} fill="currentColor" strokeWidth={1.5} />
      </RoundButton>
      <RoundButton title={`后退 ${seekStep} 秒 (←)`} flash="back" disabled={disabled} onClick={() => jump(-1)}>
        <StepIcon icon={RotateCcw} seconds={seekStep} />
      </RoundButton>
      <RoundButton primary title="播放 / 暂停 (空格)" flash="toggle" disabled={!hasTracks} onClick={toggle} className="mx-1">
        <span key={playing ? "pause" : "play"} className="grid animate-pop place-items-center">
          {playing ? <Pause size={24} fill="currentColor" strokeWidth={0} /> : <Play size={24} fill="currentColor" strokeWidth={0} className="ml-0.5" />}
        </span>
      </RoundButton>
      <RoundButton title={`前进 ${seekStep} 秒 (→)`} flash="forward" disabled={disabled} onClick={() => jump(1)}>
        <StepIcon icon={RotateCw} seconds={seekStep} />
      </RoundButton>
      <RoundButton title="下一首 (↓)" flash="next" disabled={disabled} onClick={() => step(1)}>
        <SkipForward size={19} fill="currentColor" strokeWidth={1.5} />
      </RoundButton>
    </div>
  );
}

/** Rewind/forward arrow with the jump length written inside, like the system podcast controls. */
function StepIcon({ icon: Icon, seconds }: { icon: typeof RotateCcw; seconds: number }) {
  return (
    <span className="relative grid place-items-center">
      <Icon size={26} strokeWidth={1.6} />
      <span className="tabular absolute pt-px text-[9px] font-bold">{seconds}</span>
    </span>
  );
}
