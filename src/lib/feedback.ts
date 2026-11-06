// 意见反馈 rules: the same limits as Rust (src-tauri/src/feedback.rs) and the endpoint
// (site/api/feedback.mjs), counted in characters, so an emoji or a kanji is one.

export const MAX_MESSAGE = 4000;
export const MAX_CONTACT = 200;

/** Characters, not UTF-16 units. */
export const chars = (text: string) => [...text].length;

/** Something written that fits. */
export function canSend(message: string, contact = ""): boolean {
  const n = chars(message.trim());
  return n > 0 && n <= MAX_MESSAGE && chars(contact.trim()) <= MAX_CONTACT;
}

/** "3700 / 4000", only once it gets close to the limit. */
export function counter(message: string): string | null {
  const n = chars(message.trim());
  return n >= MAX_MESSAGE * 0.9 ? `${n} / ${MAX_MESSAGE}` : null;
}

/** What 复制内容 puts on the clipboard when sending fails, to send some other way. */
export function asText(message: string, contact: string): string {
  const m = message.trim();
  const c = contact.trim();
  return c ? `${m}\n\n${c}` : m;
}
