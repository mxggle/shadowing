import { Eye, EyeOff } from "lucide-react";
import { t } from "../lib/i18n";
import { sentenceIndexAt } from "../lib/sentences";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { LoopPanel } from "./Loop";
import { Picture } from "./Picture";
import { TrackTitle } from "./TrackTitle";
import { TranscribeCard } from "./TranscribeCard";
import { SentenceList } from "./Transcript";
import { SaidText, SentenceText } from "./SentenceText";
import { IconButton } from "./ui";

/**
 * 并排: the picture on the left with the sentence being said under it, so the eyes
 * needn't leave the speaker's mouth; the whole script on the right.
 */
export function SideBySide({ hasTranscript }: { hasTranscript: boolean }) {
  return (
    <div className="flex min-h-0 flex-1">
      <section className="scrollbar-none flex min-w-0 flex-1 flex-col overflow-y-auto pr-6 pb-6 pl-10">
        <TrackTitle bare />
        <Picture layout="side" />
        {hasTranscript && <CurrentLine />}
      </section>
      {/* Each sentence row keeps room for its buttons: the script needs the wider half. */}
      <section className="flex min-w-[480px] flex-1 flex-col border-l border-line">
        {hasTranscript ? (
          <SentenceList />
        ) : (
          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-10">
            <LoopPanel />
            <TranscribeCard />
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * 影院: the picture as large as it goes, the sentence being said under it and the
 * next one faint; the line can be hidden to shadow without reading.
 */
export function Theater({ hasTranscript }: { hasTranscript: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-10 pt-1 pb-5">
      <div className="flex min-h-0 flex-1 justify-center">
        <Picture layout="theater" />
      </div>
      {hasTranscript && <CurrentLine big />}
    </div>
  );
}

/** The sentence playing (lit as it's said) under the picture. `big`: centred, with the next one and a hide button. */
function CurrentLine({ big = false }: { big?: boolean }) {
  const sentences = useApp((s) => s.transcript?.sentences ?? []);
  const index = useApp((s) => (s.transcript ? sentenceIndexAt(s.transcript.sentences, s.time) : -1));
  const lit = useApp((s) => s.settings.wordHighlight && !s.playingTake && !s.playingReading);
  const hidden = useApp((s) => big && s.lineHidden);
  const toggleHidden = useApp((s) => s.toggleLineHidden);
  const sentence = sentences[index];
  const next = sentences[index + 1];
  const text = sentence && (lit ? <SaidText sentence={sentence} find="" /> : <SentenceText text={sentence.text} find="" />);

  if (!big) {
    return (
      <div className="mt-4 min-h-[76px]">
        {sentence && (
          <>
            <p className="text-[12px] text-faint">
              {t("第 {n} 句", { n: index + 1 })} · <span className="tabular font-mono">{formatTime(sentence.start)}</span>
            </p>
            <p className="mt-1 font-script text-[24px] leading-[1.5] font-medium break-words select-text">{text}</p>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="relative mx-auto mt-4 min-h-[66px] w-full max-w-[920px] shrink-0 px-11 text-center">
      {hidden ? (
        <p className="pt-2 text-[13px] text-faint">{t("这一句藏起来了：不看字幕，只听着跟读")}</p>
      ) : (
        sentence && (
          <>
            <p className="font-script text-[24px] leading-[1.5] font-medium break-words select-text">{text}</p>
            {next && <p className="mt-1 font-script text-[15px] leading-[1.6] break-words text-faint">{next.text}</p>}
          </>
        )
      )}
      <IconButton title={hidden ? t("显示这一句") : t("藏起这一句（不看字幕跟读）")} aria-pressed={hidden} onClick={toggleHidden} className="absolute top-1 right-0">
        {hidden ? <Eye /> : <EyeOff />}
      </IconButton>
    </div>
  );
}
