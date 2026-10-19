import { describe, expect, it } from "vitest";
import { detectPlatform, isBrowserKey, isCmd, isMod, shortcut } from "./platform";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

describe("detectPlatform", () => {
  it("tells WebView2 from WKWebView by the user agent", () => {
    expect(detectPlatform(WINDOWS)).toBe("windows");
    expect(detectPlatform(MAC)).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("other");
    expect(detectPlatform("")).toBe("other");
  });

  it("lets the browser mock pick, and ignores anything else", () => {
    expect(detectPlatform(MAC, "windows")).toBe("windows");
    expect(detectPlatform(WINDOWS, "mac")).toBe("mac");
    expect(detectPlatform(MAC, "linux")).toBe("mac");
    expect(detectPlatform(WINDOWS, null)).toBe("windows");
  });
});

describe("the command key", () => {
  const ctrl = { metaKey: false, ctrlKey: true };
  const meta = { metaKey: true, ctrlKey: false };
  const none = { metaKey: false, ctrlKey: false };

  it("is ⌘ or Ctrl on a Mac, as before, and only Ctrl on Windows", () => {
    expect([ctrl, meta, none].map((e) => isMod(e, "mac"))).toEqual([true, true, false]);
    expect([ctrl, meta, none].map((e) => isMod(e, "windows"))).toEqual([true, false, false]);
    expect([ctrl, meta, none].map((e) => isMod(e, "other"))).toEqual([true, true, false]);
  });

  it("is ⌘ alone on a Mac and Ctrl alone on Windows when the shortcut is strict", () => {
    expect([ctrl, meta].map((e) => isCmd(e, "mac"))).toEqual([false, true]);
    expect([ctrl, meta].map((e) => isCmd(e, "windows"))).toEqual([true, false]);
  });
});

describe("shortcut", () => {
  it("leaves the Mac's key names alone", () => {
    for (const keys of ["⌘", "⌘F", "⇧↩", "⌘,", "⌫", "M", "Esc"]) expect(shortcut(keys, "mac")).toBe(keys);
    expect(shortcut("⌘F", "other")).toBe("⌘F");
  });

  it("names the keys the Windows way", () => {
    expect(shortcut("⌘", "windows")).toBe("Ctrl");
    expect(shortcut("⌥", "windows")).toBe("Alt");
    expect(shortcut("⇧", "windows")).toBe("Shift");
    expect(shortcut("⌘F", "windows")).toBe("Ctrl+F");
    expect(shortcut("⌘,", "windows")).toBe("Ctrl+,");
    expect(shortcut("⇧M", "windows")).toBe("Shift+M");
    expect(shortcut("⇧↩", "windows")).toBe("Shift+Enter");
    expect(shortcut("↩", "windows")).toBe("Enter");
    expect(shortcut("⌫", "windows")).toBe("Backspace");
    expect(shortcut("⌦", "windows")).toBe("Del");
  });

  it("puts modifiers in Windows order and leaves other keys as they are", () => {
    expect(shortcut("⇧⌘Z", "windows")).toBe("Ctrl+Shift+Z");
    expect(shortcut("⌥⇧⌘Z", "windows")).toBe("Ctrl+Alt+Shift+Z");
    for (const keys of ["M", "Esc", "空格", "−", "[", "?"]) expect(shortcut(keys, "windows")).toBe(keys);
  });
});

describe("isBrowserKey", () => {
  const key = (k: string, mods: object = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

  it("catches reload, print, find and save on Windows", () => {
    expect(isBrowserKey(key("F5"), "windows")).toBe(true);
    expect(isBrowserKey(key("r", { ctrlKey: true }), "windows")).toBe(true);
    expect(isBrowserKey(key("R", { ctrlKey: true, shiftKey: true }), "windows")).toBe(true);
    expect(isBrowserKey(key("p", { ctrlKey: true }), "windows")).toBe(true);
    expect(isBrowserKey(key("f", { ctrlKey: true }), "windows")).toBe(true);
  });

  it("leaves the app's own keys and text editing alone", () => {
    expect(isBrowserKey(key("r"), "windows")).toBe(false);
    expect(isBrowserKey(key("z", { ctrlKey: true }), "windows")).toBe(false);
    expect(isBrowserKey(key("v", { ctrlKey: true }), "windows")).toBe(false);
    expect(isBrowserKey(key("b", { ctrlKey: true }), "windows")).toBe(false);
  });

  it("does nothing on a Mac", () => {
    expect(isBrowserKey(key("F5"), "mac")).toBe(false);
    expect(isBrowserKey(key("r", { ctrlKey: true }), "mac")).toBe(false);
  });
});
