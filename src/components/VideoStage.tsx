import { Eye, EyeOff } from "lucide-react";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useKeys } from "../hooks/useKeys";
import { hideModeOf, textShown } from "../lib/hide";
import { t } from "../lib/i18n";
import { firstFit, LINE_FITS, type LineFit } from "../lib/picture";
import { sentenceIndexAt } from "../lib/sentences";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { LoopPanel } from "./Loop";
import { Picture } from "./Picture";
import { TrackTitle } from "./TrackTitle";
import { TranscribeCard } from "./TranscribeCard";
import { SentenceList } from "./Transcript";
import { SaidText, SentenceText, useAnnotation } from "./SentenceText";
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
 * next one faint; 藏字幕 (H) hides it, as it does the sentence list. The sentence
 * has a room of its own that doesn't change with it, so the picture keeps its size.
 */
export function Theater({ hasTranscript }: { hasTranscript: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pt-1 pb-3">
      <div className="flex min-h-0 flex-1 justify-center">
        <Picture layout="theater" />
      </div>
      {hasTranscript && <TheaterLine />}
    </div>
  );
}

/** The sentence playing (lit as it's said when it's timed) and the one after it. */
function useCurrent() {
  const sentences = useApp((s) => s.transcript?.sentences ?? []);
  const index = useApp((s) => (s.transcript ? sentenceIndexAt(s.transcript.sentences, s.time) : -1));
  const lit = useApp((s) => s.settings.wordHighlight && !s.playingTake && !s.playingReading);
  const sentence = sentences[index];
  const text = sentence && (lit ? <SaidText sentence={sentence} find="" /> : <SentenceText text={sentence.text} find="" />);
  return { index, sentence, next: sentences[index + 1], text };
}

/** 并排: the sentence playing under the picture, with its number and time. */
function CurrentLine() {
  const { index, sentence, text } = useCurrent();
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

/**
 * 影院: the sentence playing, centred, and the next one faint, with a button to hide them.
 * Its room is as tall as two lines of the sentence: a longer one first drops the next
 * sentence, then gets smaller (useFitLine).
 */
function TheaterLine() {
  const { index, sentence, next, text } = useCurrent();
  const hidden = useApp((s) => !textShown(hideModeOf(s.settings.hideText), index, { active: index, revealed: s.revealed, peek: s.peek, heard: s.heard }));
  // Readings over the words make the lines taller.
  const marks = useAnnotation(sentence?.text ?? "");
  const key = useKeys()("hideText");
  const room = useRef<HTMLDivElement>(null);
  useFitLine(room, [index, sentence?.text, next?.text, hidden, marks]);
  return (
    <div className="relative mx-auto mt-2 h-[80px] w-full max-w-[1080px] shrink-0 px-11 text-center">
      <div ref={room} className="group scrollbar-none h-full overflow-y-auto">
        {hidden ? (
          <p className="pt-2 text-[13px] text-faint">{t("字幕藏起来了：只听着跟读，按住 {key} 偷看", { key })}</p>
        ) : (
          sentence && (
            <>
              <p className="font-script text-[length:var(--line-size,24px)] leading-[1.5] font-medium break-words select-text">{text}</p>
              {next && <p className="mt-1 truncate font-script text-[15px] leading-[1.6] text-faint group-data-[no-next]:hidden">{next.text}</p>}
            </>
          )
        )}
      </div>
      <IconButton
        title={hidden ? t("显示字幕 ({key})", { key }) : t("藏字幕：不看原文，只听着跟读（按住 {key} 偷看正在放的一句）", { key })}
        aria-pressed={hidden}
        onClick={() => useApp.getState().toggleHideText()}
        className="absolute top-1 right-0"
      >
        {hidden ? <Eye /> : <EyeOff />}
      </IconButton>
    </div>
  );
}

/**
 * Fits the sentence into its room (lib/picture.ts, LINE_FITS) before the frame is drawn,
 * and again when the room gets wider or narrower. The size is set on the room, not by
 * React, so the text lighting up as it's said leaves it alone.
 */
function useFitLine(ref: RefObject<HTMLDivElement | null>, deps: unknown[]) {
  useLayoutEffect(() => {
    const room = ref.current;
    if (!room) return;
    const use = (fit: LineFit) => {
      room.style.setProperty("--line-size", `${fit.size}px`);
      room.toggleAttribute("data-no-next", !fit.next);
    };
    const fits = (fit: LineFit) => {
      use(fit);
      return room.scrollHeight <= room.clientHeight;
    };
    const fitNow = () => use(firstFit(LINE_FITS, fits));
    // A sentence too long even at the smallest size scrolls in its room: the next one starts at its top.
    room.scrollTop = 0;
    fitNow();
    let width = room.clientWidth;
    const resized = new ResizeObserver(() => {
      if (room.clientWidth === width) return;
      width = room.clientWidth;
      fitNow();
    });
    resized.observe(room);
    return () => resized.disconnect();
  }, [ref, ...deps]);
}
