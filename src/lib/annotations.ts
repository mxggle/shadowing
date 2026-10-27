// 标注: marks plugins put on the sentences (src-tauri/src/plugins/annotate.rs):
// a reading over a piece, a note on hover, an underline or bold, a line under
// the sentence. Which plugins and settings they came from, and how the marked
// pieces sit with the app's own marks on the text.
import type { AnnotationPiece, PluginInfo } from "./api";

/** The annotating plugins and their settings: marks kept under another key are asked again. */
export function annotationKey(plugins: PluginInfo[]): string {
  return plugins
    .filter((p) => !p.problem && p.annotators.length)
    .map((p) => [p.id, p.version, ...p.settings.map((s) => `${s.key}=${String(s.value)}`)].join(" "))
    .join("\n");
}

/** The texts not marked up yet, each once. */
export function unread(texts: string[], read: Record<string, unknown>): string[] {
  return [...new Set(texts)].filter((t) => !(t in read));
}

/** Pieces under one plugin piece: its marks, and the app's own pieces (found, unsure, said…) inside it. */
export interface MarkedGroup<T> {
  mark?: Omit<AnnotationPiece, "text">;
  pieces: T[];
}

const marked = (p: Omit<AnnotationPiece, "text">) => !!(p.ruby || p.note || p.mark);

/**
 * The text's own pieces cut where the plugin's pieces start and end, and
 * grouped under them: a reading spans its whole word even when the word is
 * lit half way. Plugin pieces that don't fit the text are left out.
 */
export function markedGroups<T extends { text: string }>(pieces: T[], plugin: AnnotationPiece[] | undefined): MarkedGroup<T>[] {
  const text = pieces.map((p) => p.text).join("");
  if (!plugin?.some(marked) || plugin.map((r) => r.text).join("") !== text) return [{ pieces }];
  const groups: MarkedGroup<T>[] = [];
  let p = 0;
  let inPiece = 0;
  for (const { text: part, ...mark } of plugin) {
    const group: MarkedGroup<T> = { mark: marked(mark) ? mark : undefined, pieces: [] };
    let left = part.length;
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
    if (!group.mark && last && !last.mark) last.pieces.push(...group.pieces);
    else groups.push(group);
  }
  return groups;
}
