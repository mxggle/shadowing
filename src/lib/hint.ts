/** One piece of a tip: plain text, or a key named on its own ("按 S 循环") to draw as a key cap. */
export type HintPiece = { text: string; key: boolean };

// No lookbehind: WebKit before Safari 16.4 rejects it, and this module loads with the app.
const KEY = /(^|[\s，、,])([A-Z[\]−=-])(?=\s|$)/g; // i18n: keep

export function hintPieces(text: string): HintPiece[] {
  const out: HintPiece[] = [];
  let at = 0;
  for (const m of text.matchAll(KEY)) {
    const start = m.index + m[1].length;
    if (start > at) out.push({ text: text.slice(at, start), key: false });
    out.push({ text: m[2], key: true });
    at = start + m[2].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), key: false });
  return out;
}
