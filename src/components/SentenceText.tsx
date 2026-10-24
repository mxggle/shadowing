import type { Sentence } from "../lib/api";
import { textPieces } from "../lib/edits";
import { t, tk } from "../lib/i18n";
import { shortcut } from "../lib/platform";
import { saidPieces, saidUpTo } from "../lib/sentences";
import { useApp } from "../store";

const UNSURE_TITLE = tk("转写时没把握，可能听错了。按 E 改正；没错的话按 E 再按 {key}，虚线就会去掉");

/**
 * A sentence's text: what the replace bar looks for (and what an AI suggestion
 * would change, `fixes`) is highlighted, and what the transcriber was unsure of
 * has a dotted underline. In the sentence playing (`said`), what hasn't been
 * said yet stays grey, a character (a word) at a time.
 */
export function SentenceText({ text, find, unsure, fixes, said }: {
  text: string;
  find: string;
  unsure?: [number, number][];
  fixes?: string[];
  said?: { times: [number, number][]; upTo: number };
}) {
  if (!find && !unsure?.length && !fixes?.length && !said) return text;
  const fixed = (fixes ?? []).flatMap((from): [number, number][] => {
    const at = text.indexOf(from);
    return at < 0 ? [] : [[at, at + from.length]];
  });
  const pieces = textPieces(text, find, unsure, fixed);
  let at = 0;
  // Keyed by where they start, so a piece keeps its element (and fades) as it's said.
  return (said ? saidPieces(pieces, said.times, said.upTo) : pieces).map((piece) => {
    const key = at;
    at += piece.text.length;
    if (!piece.match && !piece.unsure && piece.said === undefined) return piece.text;
    const Tag = piece.match ? "mark" : "span";
    return (
      <Tag
        key={key}
        title={piece.unsure ? t(UNSURE_TITLE, { key: shortcut("↩") }) : undefined}
        className={`${piece.match ? "rounded-[3px] bg-press text-fg shadow-[0_0_0_2px_var(--press)]" : ""} ${
          piece.unsure ? "underline decoration-warn decoration-dotted decoration-2 underline-offset-[6px]" : ""
        } ${piece.said === undefined ? "" : `transition-colors duration-150 ${piece.said || piece.match ? "" : "text-muted"}`}`}
      >
        {piece.text}
      </Tag>
    );
  });
}

/** The sentence playing, lit up to what has been said; lit whole when its characters aren't timed. */
export function SaidText({ sentence, find, fixes }: { sentence: Sentence; find: string; fixes?: string[] }) {
  const upTo = useApp((s) => saidUpTo(sentence, s.time));
  const said = upTo === null || !sentence.times ? undefined : { times: sentence.times, upTo };
  return <SentenceText text={sentence.text} find={find} unsure={sentence.unsure} fixes={fixes} said={said} />;
}

/** "· 3 处没把握" in the list header; each press plays the next underlined sentence. */
export function UnsureCount() {
  const count = useApp((s) => s.transcript?.sentences.reduce((n, x) => n + (x.unsure?.length ?? 0), 0) ?? 0);
  if (!count) return null;
  const playNext = () => {
    const { transcript, time, playSentence } = useApp.getState();
    const marked = (transcript?.sentences ?? []).flatMap((s, i) => (s.unsure?.length ? [{ i, start: s.start }] : []));
    const next = marked.find((m) => m.start > time + 0.5) ?? marked[0];
    if (next) playSentence(next.i);
  };
  return (
    <span className="shrink-0">
      ·{" "}
      <button
        title={t("转写时没把握的地方画了虚线，点一下播放下一处")}
        onClick={playNext}
        className="underline decoration-warn decoration-dotted underline-offset-[3px] transition-colors hover:text-fg"
      >
        <span className="tabular font-mono">{count}</span> {t("处没把握", { n: count })}
      </button>
    </span>
  );
}
