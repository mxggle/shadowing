import { AlertCircle } from "lucide-react";
import { t, tk } from "../lib/i18n";
import { formatDuration } from "../lib/practice";
import { useApp } from "../store";
import { PracticeCoach } from "./guide/PracticeCoach";
import { LoopPanel } from "./Loop";
import { Picture, Unsupported } from "./Picture";
import { TranscribeCard } from "./TranscribeCard";
import { SentenceList } from "./Transcript";
import { Kbd } from "./ui";

/**
 * Main area above the deck: what you're practising. With a transcript that's
 * the sentence list; without one it's the A–B loop.
 */
export function Stage() {
  const hasTrack = useApp((s) => !!s.current);
  const unsupported = useApp((s) => s.current?.kind === "unsupported");
  const hasTranscript = useApp((s) => !!s.transcript?.sentences.length);
  const coaching = useApp((s) => s.practicing && !!s.current && s.current.path === s.sample?.path);

  if (!hasTrack) return <Empty />;
  if (unsupported) return <Unsupported />;

  // One tree either way, so a video's picture isn't loaded again when its transcript arrives.
  return (
    <div className={`flex min-h-0 flex-1 flex-col ${hasTranscript ? "" : "scrollbar-none overflow-y-auto"}`}>
      <TrackTitle />
      <Picture />
      {hasTranscript ? (
        <>
          {coaching && <PracticeCoach />}
          <SentenceList />
        </>
      ) : (
        <div className="mx-auto flex w-full max-w-[760px] flex-col px-10 pt-9 pb-10">
          <LoopPanel />
          <TranscribeCard />
        </div>
      )}
    </div>
  );
}

const KEYS: [string[], string][] = [
  [[tk("空格")], tk("播放 / 暂停")],
  [["L"], tk("设 A、设 B，反复听一段")],
  [["S"], tk("循环当前句（有字幕时）")],
  [["−", "="], tk("放慢 / 加快")],
];

/** Nothing picked yet: how to start, and the four keys that matter most. */
function Empty() {
  return (
    <div className="flex min-h-0 flex-1 animate-fade-in flex-col justify-center px-10 pb-8">
      <div className="mx-auto w-full max-w-[560px]">
        <h1 className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.01em]">{t("选一段音频，开始跟读。")}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">{t("从左边的列表点一个，或者直接按空格播放第一个。")}</p>
        <dl className="mt-8 grid max-w-[360px] grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 border-t border-line pt-5 text-[13px]">
          {KEYS.map(([keys, label]) => (
            <div key={label} className="contents">
              <dt className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k} className="min-w-[24px] px-1.5">
                    {t(k)}
                  </Kbd>
                ))}
              </dt>
              <dd className="text-muted">{t(label)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function TrackTitle() {
  const current = useApp((s) => s.current)!;
  const error = useApp((s) => s.error);
  // A video's title keeps to one smaller line: the picture under it needs the room.
  const size = current.kind === "video" ? "line-clamp-1 text-[22px] leading-[1.3]" : "line-clamp-2 text-[28px] leading-[1.22]";
  return (
    <div key={current.path} className="mx-auto w-full max-w-[760px] shrink-0 animate-fade-in px-10 pt-1">
      <h1
        className={`${size} font-script font-semibold tracking-[-0.012em] break-words text-balance`}
        title={current.name}
      >
        {current.name}
      </h1>
      <TrackPractice />
      {error && (
        <p className="mt-3 flex w-fit max-w-full items-start gap-1.5 rounded-[8px] bg-danger-soft px-3 py-1.5 text-[13px] text-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </p>
      )}
    </div>
  );
}

/** How long this audio has been practised in all, once there's at least a minute. */
function TrackPractice() {
  const ms = useApp((s) => s.trackMs);
  if (ms < 60_000) return null;
  return (
    <p className="mt-1 text-[12px] text-faint" title={t("练这段音频的时间（播放和中间的跟读），详见学习记录")}>
      {t("已练")} <span className="tabular text-muted">{formatDuration(ms)}</span>
    </p>
  );
}
