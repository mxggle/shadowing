// 注音: readings a plugin gives for the words of a sentence (src-tauri/src/plugins/readings.rs),
// shown over them. Which transcripts get them, and how they sit with the other marks on the text.
import type { PluginInfo, RubyPiece } from "./api";

const KANA = /[ぁ-ゖァ-ヺー]/;

/**
 * "ja" when kana are in at least a fifth of the sentences: Japanese almost
 * always has some, Chinese (kanji too, readings would be wrong) never.
 */
export function transcriptLanguage(texts: string[]): string | null {
  if (!texts.length) return null;
  const withKana = texts.filter((t) => KANA.test(t)).length;
  return withKana > 0 && withKana * 5 >= texts.length ? "ja" : null;
}

/** Who reads `language`, and with which settings: readings kept under another key are asked again. */
export function rubyKey(plugins: PluginInfo[], language: string | null): string {
  const plugin = language ? plugins.find((p) => !p.problem && p.readings.includes(language)) : undefined;
  if (!plugin) return "";
  return [language, plugin.id, plugin.version, ...plugin.settings.map((s) => `${s.key}=${s.value}`)].join("\n");
}

/** The texts not read yet, each once. */
export function unread(texts: string[], read: Record<string, RubyPiece[]>): string[] {
  return [...new Set(texts)].filter((t) => !(t in read));
}

/** Pieces with a reading over them, and those without. */
export interface RubyGroup<T> {
  ruby?: string;
  pieces: T[];
}

/**
 * The text's marked pieces (found, unsure, said…) cut where readings start and
 * end, and grouped under them: a reading spans its whole word even when the
 * word is lit half way. Readings that don't fit the text are left out.
 */
export function rubyGroups<T extends { text: string }>(pieces: T[], ruby: RubyPiece[] | undefined): RubyGroup<T>[] {
  const text = pieces.map((p) => p.text).join("");
  if (!ruby?.some((r) => r.ruby) || ruby.map((r) => r.text).join("") !== text) return [{ pieces }];
  const groups: RubyGroup<T>[] = [];
  let p = 0;
  let inPiece = 0;
  for (const r of ruby) {
    const group: RubyGroup<T> = { ruby: r.ruby, pieces: [] };
    let left = r.text.length;
    while (left > 0) {
      const piece = pieces[p];
      const take = Math.min(left, piece.text.length - inPiece);
      group.pieces.push({ ...piece, text: piece.text.slice(inPiece, inPiece + take) });
      left -= take;
      inPiece += take;
      if (inPiece === piece.text.length) {
        p++;
        inPiece = 0;
      }
    }
    const last = groups[groups.length - 1];
    if (!group.ruby && last && !last.ruby) last.pieces.push(...group.pieces);
    else groups.push(group);
  }
  return groups;
}
