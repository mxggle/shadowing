import { textPieces } from "../lib/edits";
import { useApp } from "../store";

const UNSURE_TITLE = "转写时没把握，可能听错了。按 E 改正；没错的话按 E 再按 ↩，虚线就会去掉";

/**
 * A sentence's text: what the replace bar looks for is highlighted, and what
 * the transcriber was unsure of has a dotted underline.
 */
export function SentenceText({ text, find, unsure }: { text: string; find: string; unsure?: [number, number][] }) {
  if (!find && !unsure?.length) return text;
  return textPieces(text, find, unsure).map((piece, k) => {
    if (!piece.match && !piece.unsure) return piece.text;
    const Tag = piece.match ? "mark" : "span";
    return (
      <Tag
        key={k}
        title={piece.unsure ? UNSURE_TITLE : undefined}
        className={`${piece.match ? "rounded-[3px] bg-press text-fg shadow-[0_0_0_2px_var(--press)]" : ""} ${
          piece.unsure ? "underline decoration-warn decoration-dotted decoration-2 underline-offset-[6px]" : ""
        }`}
      >
        {piece.text}
      </Tag>
    );
  });
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
        title="转写时没把握的地方画了虚线，点一下播放下一处"
        onClick={playNext}
        className="underline decoration-warn decoration-dotted underline-offset-[3px] transition-colors hover:text-fg"
      >
        <span className="tabular font-mono">{count}</span> 处没把握
      </button>
    </span>
  );
}
