// Which system the interface runs on. The app was made for the Mac and also ships for Windows: only
// Windows is different (Ctrl for ⌘, "this PC" for "this Mac", a normal title bar), and anything that
// isn't Windows (a Mac, the plain browser used for UI work) behaves exactly as it always did.

export type Platform = "mac" | "windows" | "other";

/**
 * From the WebView's user agent: WebView2 says "Windows NT", WKWebView says "Macintosh".
 * `override` ("windows" or "mac") is for the browser mock only, see `platform`.
 */
export function detectPlatform(userAgent: string, override?: string | null): Platform {
  if (override === "windows" || override === "mac") return override;
  if (/Windows NT/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "mac";
  return "other";
}

function detect(): Platform {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  // `npm run dev` in a plain browser (no Tauri): add ?platform=windows to the address to see the Windows interface.
  const mock = import.meta.env.DEV && typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);
  return detectPlatform(userAgent, mock ? new URLSearchParams(window.location.search).get("platform") : null);
}

/** Fixed while the app runs. */
export const platform: Platform = detect();
export const isWindows = platform === "windows";
export const isMac = platform === "mac";

// ---- Shortcuts ----------------------------------------------------------------------------------
// Shortcuts are written the Mac way (⌘F). On Windows ⌘ is Ctrl, and the key caps say so.

type Mods = Pick<KeyboardEvent, "metaKey" | "ctrlKey">;

/**
 * The command key is held: ⌘ on a Mac, Ctrl on Windows. A shortcut that took ⌘ or Ctrl on a Mac still does
 * (as it always did); on Windows only Ctrl counts, the Windows key is the system's.
 */
export const isMod = (e: Mods, on: Platform = platform) => (on === "windows" ? e.ctrlKey : e.metaKey || e.ctrlKey);

/** Only the platform's own command key: ⌘ on a Mac (Ctrl is left alone), Ctrl on Windows. */
export const isCmd = (e: Mods, on: Platform = platform) => (on === "windows" ? e.ctrlKey : e.metaKey);

const WINDOWS_KEYS: Record<string, string> = {
  "⌘": "Ctrl",
  "⌃": "Ctrl",
  "⌥": "Alt",
  "⇧": "Shift",
  "↩": "Enter",
  "⌫": "Backspace",
  "⌦": "Del",
};
const MODIFIERS = ["Ctrl", "Alt", "Shift"];

/**
 * A key or shortcut as the Mac writes it ("⌘", "⌘F", "⇧↩", "⌘,", "M"), named the way the platform does:
 * the same on a Mac, "Ctrl", "Ctrl+F", "Shift+Enter", "Ctrl+," on Windows.
 */
export function shortcut(keys: string, on: Platform = platform): string {
  if (on !== "windows") return keys;
  const chars = [...keys];
  const mods = new Set<string>();
  let i = 0;
  while (i < chars.length && ["⌘", "⌃", "⌥", "⇧"].includes(chars[i])) mods.add(WINDOWS_KEYS[chars[i++]]);
  const rest = chars.slice(i).join("");
  const ordered = MODIFIERS.filter((m) => mods.has(m));
  return [...ordered, WINDOWS_KEYS[rest] ?? rest].filter(Boolean).join("+");
}

/**
 * Keys WebView2 (Chromium) treats as its own: reload, print, find, save, caret browsing. A desktop app has
 * no use for them, and a reload would throw away what is on screen. The Mac's WebView has none of these.
 */
export function isBrowserKey(e: Mods & Pick<KeyboardEvent, "key" | "altKey">, on: Platform = platform): boolean {
  if (on !== "windows") return false;
  const key = e.key.toLowerCase();
  if (["f3", "f5", "f7"].includes(key)) return true;
  return e.ctrlKey && !e.altKey && ["r", "p", "f", "g", "s"].includes(key);
}
