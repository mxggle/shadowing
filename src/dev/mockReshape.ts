// Cutting and joining sentences in the browser mock, by the same rules as
// src-tauri/src/reshape.rs, except that a cut's time is only the guess from
// the words (there's no audio here to find the pause in).
import type { SavedExplanation, Section, Sentence, Transcript } from "../lib/api";
import { cutRatio, cutText, joinText, movedIndex, replaceRun, shiftSections, type Change } from "../lib/reshape";

const STALE = "字幕已经变了，请重新打开这个音频";

/** Underlines that fall in [from, to), counted from `from`. */
const within = (unsure: [number, number][] = [], from: number, to: number) =>
  unsure.flatMap(([a, b]): [number, number][] => (Math.max(a, from) < Math.min(b, to) ? [[Math.max(a, from) - from, Math.min(b, to) - from]] : []));

function split(s: Sentence, at: number): Sentence[] {
  const cut = cutText(s.text, at);
  if (!cut) throw "要在句子中间断开，两边都要有字";
  const t = s.start + (s.end - s.start) * cutRatio(cut.first, cut.second);
  const first = { ...s, end: t, text: cut.first, unsure: within(s.unsure, 0, cut.first.length) };
  const second = { ...s, start: t, text: cut.second, unsure: within(s.unsure, cut.secondFrom, cut.secondFrom + cut.second.length) };
  return [first, second];
}

function merge(a: Sentence, b: Sentence): Sentence {
  const text = joinText(a.text, b.text);
  const offset = text.length - b.text.length;
  const unsure = [...(a.unsure ?? []), ...(b.unsure ?? []).map(([x, y]): [number, number] => [x + offset, y + offset])];
  return { ...a, end: Math.max(a.end, b.end), text, speaker: a.speaker ?? b.speaker, unsure };
}

/** transcript_split / _merge / _restore: the transcript saved, with its kept explanations moved along. */
export function mockReshape(cmd: string, a: Record<string, never>, transcripts: Map<string, Transcript>, kept: Map<string, SavedExplanation[]>): Transcript {
  const t = transcripts.get(a.path);
  if (!t) throw "这个音频没有字幕";
  const list = t.sentences;
  let at: number = a.index;
  let removed: number;
  let added: Sentence[];
  let sections: Section[] | null = null;
  if (cmd === "transcript_split") {
    if (!list[at]) throw STALE;
    [removed, added] = [1, split(list[at], a.at)];
  } else if (cmd === "transcript_merge") {
    if (!list[at] || !list[at + 1]) throw STALE;
    [removed, added] = [2, [merge(list[at], list[at + 1])]];
  } else {
    [at, removed, added, sections] = [a.at, a.count, a.sentences, a.sections];
    if (!removed || !added.length || at + removed > list.length) throw STALE;
  }
  const c: Change = { at, removed, added: added.length };
  const sentences = replaceRun(list, c, added);
  const saved: Transcript = {
    ...t,
    sentences,
    sections: sections ?? shiftSections(t.sections ?? [{ start: 0 }], c),
    edited: true,
    source: t.source === "sidecar" ? "imported" : t.source,
  };
  transcripts.set(a.path, saved);
  const answers = kept.get(a.path) ?? [];
  kept.set(a.path, answers.map((k) => ({ ...k, index: movedIndex(k.index, c) ?? c.at })));
  return saved;
}
