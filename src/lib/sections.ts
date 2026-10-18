// Pure rules for sections (对话段落): runs of sentences that belong together.
// Unit-tested in sections.test.ts. Rust keeps them tidy (src-tauri/src/sections.rs);
// these work on what it sends.
import type { Loop } from "../audio/logic";
import type { Section, Sentence, Transcript } from "./api";
import { t } from "./i18n";
import { sentenceLoop } from "./sentences";

const WHOLE: Section[] = [{ start: 0 }];

/** A transcript's sections; one covering everything when it has none. */
export const sectionsOf = (t: Pick<Transcript, "sections"> | null | undefined): Section[] =>
  t?.sections?.length ? t.sections : WHOLE;

/** Which section sentence `i` is in (0 for −1, before the first sentence). */
export function sectionIndexOf(sections: Section[], i: number): number {
  let k = 0;
  while (k + 1 < sections.length && sections[k + 1].start <= i) k++;
  return k;
}

/** Sentences [first, end) of section `k`. */
export function sectionRange(sections: Section[], k: number, count: number): [number, number] {
  return [sections[k]?.start ?? 0, sections[k + 1]?.start ?? count];
}

/** "对话 2", or the learner's title. */
export const sectionName = (sections: Section[], k: number) => sections[k]?.title || t(`对话 ${k + 1}`, `Section ${k + 1}`);

/** Starts a new section at sentence `i` (no change at 0 or where one already starts). */
export function splitAt(sections: Section[], i: number): Section[] {
  if (i <= 0 || sections.some((s) => s.start === i)) return sections;
  return [...sections, { start: i }].sort((a, b) => a.start - b.start);
}

/** Folds section `k` into the one before it (the first can't be merged up). */
export const mergeUp = (sections: Section[], k: number): Section[] =>
  k <= 0 || k >= sections.length ? sections : sections.filter((_, j) => j !== k);

/** A new title for section `k`; blank goes back to "对话 N". */
export function rename(sections: Section[], k: number, title: string): Section[] {
  const t = title.trim().replace(/\s+/g, " ");
  return sections.map((s, j) => (j !== k ? s : t ? { ...s, title: t } : { start: s.start }));
}

/** The A–B loop that repeats a whole section: its first sentence's start to its last one's end. */
export function sectionLoop(sentences: Sentence[], sections: Section[], k: number, duration: number): Loop | null {
  const [first, end] = sectionRange(sections, k, sentences.length);
  if (end <= first) return null;
  const { a } = sentenceLoop(sentences[first], duration);
  const { b } = sentenceLoop(sentences[end - 1], duration);
  return { a, b };
}

/**
 * Where `{` (−1) and `}` (+1) go from the playing sentence `active`: the next
 * section, or back to the start of this one unless already there, then the one before.
 */
export function sectionStep(sections: Section[], active: number, direction: 1 | -1): number {
  if (active < 0) return 0;
  const k = sectionIndexOf(sections, active);
  if (direction > 0) return Math.min(sections.length - 1, k + 1);
  return active > sections[k].start ? k : Math.max(0, k - 1);
}
