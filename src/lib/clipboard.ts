// Copying text the learner asked for (⌘C on a sentence). The WebView's clipboard API needs a key or
// a click just before it; the old copy command is the fallback where that API is missing or refuses.

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(field);
    field.select();
    try {
      return document.execCommand("copy");
    } finally {
      field.remove();
    }
  }
}
