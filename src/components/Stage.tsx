import { useStageWide } from "../hooks/useStageWide";
import { t, tk } from "../lib/i18n";
import { layoutShown } from "../lib/picture";
import { useApp } from "../store";
import { BookView } from "./Book";
import { PracticeCoach } from "./guide/PracticeCoach";
import { LoopPanel } from "./Loop";
import { Picture } from "./Picture";
import { TrackTitle } from "./TrackTitle";
import { TranscribeCard } from "./TranscribeCard";
import { SentenceList } from "./Transcript";
import { Kbd } from "./ui";
import { Unsupported } from "./Unsupported";
import { SideBySide, Theater } from "./VideoStage";

/**
 * Main area above the deck: what you're practising. With a transcript that's
 * the sentence list; without one it's the A–B loop. A video's picture goes above
 * them, beside them, or on its own (VideoStage.tsx).
 */
export function Stage() {
  const book = useApp((s) => s.bookOpen);
  const hasTrack = useApp((s) => !!s.current);
  const unsupported = useApp((s) => s.current?.kind === "unsupported");
  const hasTranscript = useApp((s) => !!s.transcript?.sentences.length);
  const coaching = useApp((s) => s.practicing && !!s.current && s.current.path === s.sample?.path);
  // A video whose picture shows (or is still loading: most are what they say).
  const picture = useApp((s) => s.current?.kind === "video" && !s.settings.pictureHidden && (s.pictureLook === "loading" || s.pictureLook === "shown"));
  const chosen = useApp((s) => s.settings.pictureLayout);
  const wide = useStageWide();
  const layout = picture ? layoutShown(chosen, wide) : "stack";

  if (book) return <BookView />;
  if (!hasTrack) return <Empty />;
  if (unsupported) return <Unsupported />;
  if (layout === "side") return <SideBySide hasTranscript={hasTranscript} />;
  if (layout === "theater") return <Theater hasTranscript={hasTranscript} />;

  // One tree either way, so a video's picture isn't loaded again when its transcript arrives.
  return (
    <div className={`flex min-h-0 flex-1 flex-col ${hasTranscript ? "" : "scrollbar-none overflow-y-auto"}`}>
      <TrackTitle />
      <Picture layout="stack" />
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
