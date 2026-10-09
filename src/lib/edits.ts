// Pure rules for correcting a transcript by hand; unit-tested in edits.test.ts.
import type { Sentence, SentenceEdit } from "./api";

type Kind = "han" | "hira" | "kata" | "word" | "other";

function kind(ch: string): Kind {
  if (/\p{Script=Han}/u.test(ch)) return "han";
  if (/\p{Script=Hiragana}/u.test(ch)) return "hira";
  if (/[\p{Script=Katakana}ー]/u.test(ch)) return "kata";
  if (/[\p{L}\p{N}'’]/u.test(ch)) return "word";
  return "other";
}

/** Letters of languages written with spaces: a term made of them only matches whole words. */
const SPACED = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}]/u;

/**
 * What a correction changed, widened to the whole word around it (a run of
 * kanji, of katakana, or of letters) so it can be looked for in other
 * sentences: 「寝蔵アート」→「寝相アート」 gives 寝蔵 → 寝相, not 蔵 → 相.
 * Null when there is nothing worth replacing elsewhere: no change, a word
 * only added or deleted, only punctuation, or only hiragana (particles and
 * endings differ from sentence to sentence).
 */
export function changedWord(before: string, after: string): { from: string; to: string } | null {
  const a = Array.from(before);
  const b = Array.from(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  if (head === a.length && head === b.length) return null;

  // The kinds of character at each edge of the change, in either version.
  const changed = (s: string[], i: number) => (i >= head && i < s.length - tail ? kind(s[i]) : null);
  const left = new Set([changed(a, head), changed(b, head)]);
  const right = new Set([changed(a, a.length - tail - 1), changed(b, b.length - tail - 1)]);
  const joins = (kinds: Set<Kind | null>, ch: string) => kind(ch) !== "other" && kinds.has(kind(ch));
  while (head > 0 && joins(left, a[head - 1])) head--;
  while (tail > 0 && joins(right, a[a.length - tail])) tail--;

  const from = a.slice(head, a.length - tail).join("");
  const to = b.slice(head, b.length - tail).join("");
  const wordy = (s: string) => Array.from(s).some((ch) => ["han", "kata", "word"].includes(kind(ch)));
  if (!from || !to || !(wordy(from) || wordy(to))) return null;
  return { from, to };
}

/** Where `find` occurs in `text`, as [start, end) offsets, without overlaps. */
export function matchRanges(text: string, find: string): [number, number][] {
  const ranges: [number, number][] = [];
  if (!find) return ranges;
  const wholeStart = SPACED.test(find[0]);
  const wholeEnd = SPACED.test(find[find.length - 1]);
  let from = 0;
  for (let i = text.indexOf(find, from); i >= 0; i = text.indexOf(find, from)) {
    const end = i + find.length;
    const cutsWord = (wholeStart && i > 0 && SPACED.test(text[i - 1])) || (wholeEnd && SPACED.test(text[end] ?? ""));
    if (cutsWord) {
      from = i + 1;
      continue;
    }
    ranges.push([i, end]);
    from = end;
  }
  return ranges;
}

/** Indices of the sentences that contain `find`. */
export function matchingSentences(sentences: Sentence[], find: string): number[] {
  return sentences.flatMap((s, i) => (matchRanges(s.text, find).length ? [i] : []));
}

/**
 * Edits that put `replace` in place of every `find`; a sentence that would be
 * left empty is skipped. Underlines move with the text around them; one that
 * touches a replaced word goes (that word has been dealt with).
 */
export function replaceEdits(sentences: Sentence[], find: string, replace: string): SentenceEdit[] {
  return sentences.flatMap((s, index) => {
    const ranges = matchRanges(s.text, find);
    if (!ranges.length) return [];
    let text = "";
    let at = 0;
    for (const [start, end] of ranges) {
      text += s.text.slice(at, start) + replace;
      at = end;
    }
    text += s.text.slice(at);
    const lead = text.length - text.trimStart().length;
    text = text.trim();
    if (!text) return [];
    const unsure = (s.unsure ?? []).flatMap(([a, b]): [number, number][] => {
      let shift = -lead;
      for (const [start, end] of ranges) {
        if (b <= start) break;
        if (a < end) return [];
        shift += replace.length - (end - start);
      }
      return a + shift >= 0 && b + shift <= text.length ? [[a + shift, b + shift]] : [];
    });
    return [{ index, text, unsure }];
  });
}

export interface TextPiece {
  text: string;
  /** Matches what the replace bar is looking for. */
  match: boolean;
  /** The transcriber was unsure of it. */
  unsure: boolean;
}

/** The text in pieces for display: matches of `find`, and what the transcriber was unsure of. */
export function textPieces(text: string, find: string, unsure: [number, number][] = []): TextPiece[] {
  const matches = matchRanges(text, find);
  const cuts = new Set([0, text.length]);
  for (const [a, b] of [...matches, ...unsure]) cuts.add(a).add(b);
  const points = [...cuts].filter((x) => x >= 0 && x <= text.length).sort((x, y) => x - y);
  const within = (ranges: [number, number][], at: number) => ranges.some(([a, b]) => a <= at && at < b);
  const pieces: TextPiece[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const piece = { text: text.slice(a, b), match: within(matches, a), unsure: within(unsure, a) };
    const last = pieces[pieces.length - 1];
    if (last && last.match === piece.match && last.unsure === piece.unsure) last.text += piece.text;
    else pieces.push(piece);
  }
  return pieces.length ? pieces : [{ text, match: false, unsure: false }];
}
