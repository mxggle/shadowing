import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { ACTIONS, actionFor, DEFAULT_KEYS, heldOf, isTaken, keyName, keyOf, keymap, pressOf, rebind, reset, unshifted } from "./keymap";

afterEach(() => setLang("zh"));

describe("keyOf", () => {
  it("keeps letters in lower case, so Caps Lock and Shift don't matter", () => {
    expect(keyOf({ key: "L" })).toBe("l");
    expect(keyOf({ key: "l" })).toBe("l");
  });

  it("keeps signs and named keys as they are", () => {
    expect(keyOf({ key: "[" })).toBe("[");
    expect(keyOf({ key: " " })).toBe(" ");
    expect(keyOf({ key: "Spacebar" })).toBe(" ");
    expect(keyOf({ key: "ArrowLeft" })).toBe("ArrowLeft");
    expect(keyOf({ key: "PageDown" })).toBe("PageDown");
  });

  it("takes F1–F12 (foot pedals, page turners)", () => {
    for (const key of ["F1", "F5", "F12"]) expect(keyOf({ key })).toBe(key);
    expect(keyName("F5")).toBe("F5");
  });

  it("refuses the app's own keys, modifiers and other named keys", () => {
    for (const key of ["Escape", "?", "Tab", "Enter", "Backspace", "Shift", "Meta", "AltGraph", "Dead", "F13", "MediaPlayPause"]) expect(keyOf({ key })).toBeNull();
  });
});

describe("keymap", () => {
  it("is the defaults with nothing chosen, each key on one action", () => {
    const map = keymap({});
    expect(map).toEqual(DEFAULT_KEYS);
    expect(new Set(Object.values(map)).size).toBe(ACTIONS.length);
  });

  it("takes the learner's own keys", () => {
    expect(keymap({ loop: "k" }).loop).toBe("k");
  });

  it("leaves a default unbound when one of the learner's keys took it", () => {
    // A newer version adds G for 跟读停顿; this learner had already put the loop on G.
    const map = keymap({ loop: "g" });
    expect(map.loop).toBe("g");
    expect(map.pace).toBeNull();
  });

  it("keeps an action the learner left without a key", () => {
    expect(keymap({ replay: "" }).replay).toBeNull();
  });

  it("ignores junk: unknown actions, reserved or odd keys, two actions on one key", () => {
    expect(keymap({ nothing: "x", loop: "Escape", edit: "AB" })).toEqual(DEFAULT_KEYS);
    const map = keymap({ loop: "k", edit: "k" });
    expect(map.loop).toBe("k");
    expect(map.edit).toBeNull();
  });
});

describe("actionFor", () => {
  it("finds the action on a key", () => {
    const map = keymap({ loop: "k" });
    expect(actionFor(map, "k")).toBe("loop");
    expect(actionFor(map, "l")).toBeUndefined();
    expect(actionFor(map, null)).toBeUndefined();
  });
});

describe("rebind", () => {
  it("keeps only what differs from the defaults", () => {
    expect(rebind({}, "loop", "k")).toEqual({ custom: { loop: "k" }, swapped: null });
    expect(rebind({ loop: "k" }, "loop", "l")).toEqual({ custom: {}, swapped: null });
  });

  it("swaps with the action that had the key", () => {
    const { custom, swapped } = rebind({}, "loop", "s");
    expect(swapped).toBe("sentenceLoop");
    const map = keymap(custom);
    expect(map.loop).toBe("s");
    expect(map.sentenceLoop).toBe("l");
  });

  it("swapping back is the defaults again", () => {
    const once = rebind({}, "loop", "s").custom;
    expect(rebind(once, "loop", "l").custom).toEqual({});
  });
});

describe("reset", () => {
  it("one action, or all of them", () => {
    const custom = { loop: "k", edit: "x" };
    expect(reset(custom, "loop")).toEqual({ edit: "x" });
    expect(reset(custom)).toEqual({});
  });

  it("gives the default back even when another action had moved onto it", () => {
    const custom = rebind({}, "edit", "l").custom; // edit on L, the loop on E
    const map = keymap(reset(custom, "loop"));
    expect(map.loop).toBe("l");
    expect(map.edit).toBe("e");
  });
});

describe("keyName", () => {
  it("names keys the way key caps do", () => {
    expect(keyName("l")).toBe("L");
    expect(keyName("ArrowLeft")).toBe("←");
    expect(keyName("-")).toBe("−");
    expect(keyName(" ")).toBe("空格");
    expect(keyName(null)).toBe("—");
    setLang("en");
    expect(keyName(" ")).toBe("Space");
  });
});

/** A keydown as the browser gives it: `key` what it types, `code` where it is. */
const press = (key: string, code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
  key,
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

describe("pressOf", () => {
  it("a single key is just what keyOf says: Shift and Caps Lock fold in as before", () => {
    expect(pressOf(press("l", "KeyL"))).toBe("l");
    expect(pressOf(press("L", "KeyL", { shift: true }))).toBe("l");
    expect(pressOf(press("{", "BracketLeft", { shift: true }))).toBe("{");
    expect(pressOf(press(" ", "Space"))).toBe(" ");
    expect(pressOf(press("Escape", "Escape"))).toBeNull();
  });

  it("with Ctrl, Alt or ⌘ held, a combination, modifiers in a fixed order", () => {
    expect(pressOf(press("t", "KeyT", { ctrl: true, alt: true }))).toBe("ctrl+alt+t");
    expect(pressOf(press("L", "KeyL", { ctrl: true, shift: true }))).toBe("ctrl+shift+l");
    expect(pressOf(press("k", "KeyK", { meta: true, shift: true }), "mac")).toBe("shift+meta+k");
    expect(pressOf(press("ArrowLeft", "ArrowLeft", { alt: true }))).toBe("alt+ArrowLeft");
    expect(pressOf(press("F5", "F5", { ctrl: true }))).toBe("ctrl+F5");
  });

  it("goes by where the key is, not what it types", () => {
    // ⌥T on a Mac types †; Ctrl+Alt+E is € on a German Windows keyboard; ⇧1 is !.
    expect(pressOf(press("†", "KeyT", { alt: true }), "mac")).toBe("alt+t");
    expect(pressOf(press("€", "KeyE", { ctrl: true, alt: true }), "windows")).toBe("ctrl+alt+e");
    expect(pressOf(press("!", "Digit1", { ctrl: true, shift: true }))).toBe("ctrl+shift+1");
    expect(pressOf(press("{", "BracketLeft", { alt: true, shift: true }))).toBe("alt+shift+[");
  });

  it("a modifier on its own, a reserved key or the Windows key is nothing", () => {
    expect(pressOf(press("Control", "ControlLeft", { ctrl: true }))).toBeNull();
    expect(pressOf(press("Alt", "AltLeft", { alt: true }))).toBeNull();
    expect(pressOf(press("Tab", "Tab", { ctrl: true }))).toBeNull();
    expect(pressOf(press("e", "KeyE", { meta: true }), "windows")).toBeNull();
  });
});

describe("combinations in the keymap", () => {
  it("takes the learner's combinations, keeps single keys working beside them", () => {
    const map = keymap({ loop: "ctrl+alt+t" });
    expect(map.loop).toBe("ctrl+alt+t");
    expect(actionFor(map, "ctrl+alt+t")).toBe("loop");
    // L is free now: it does nothing, and the others keep their keys.
    expect(actionFor(map, "l")).toBeUndefined();
    expect(map.toggle).toBe(" ");
  });

  it("ignores combinations that are taken, odd or written another way", () => {
    for (const k of ["meta+c", "ctrl+f", "meta+q", "shift+t", "ctrl+T", "alt+ctrl+t", "ctrl+", "ctrl+Escape"]) {
      expect(keymap({ loop: k }).loop, k).toBe("l");
    }
  });

  it("knows what the app, the menu and the system already use", () => {
    expect(isTaken("meta+c", "mac")).toBe(true);
    expect(isTaken("ctrl+c", "mac")).toBe(true); // Ctrl does ⌘'s shortcuts on a Mac too
    expect(isTaken("shift+meta+z", "mac")).toBe(true);
    expect(isTaken("ctrl+c", "windows")).toBe(true);
    expect(isTaken("alt+F4", "windows")).toBe(true);
    expect(isTaken("ctrl+alt+t", "mac")).toBe(false);
    expect(isTaken("ctrl+alt+t", "windows")).toBe(false);
  });

  it("swaps like single keys do", () => {
    const first = rebind({}, "loop", "ctrl+alt+t").custom;
    const { custom, swapped } = rebind(first, "edit", "ctrl+alt+t");
    expect(swapped).toBe("loop");
    expect(keymap(custom).loop).toBe("e");
  });

  it("⇧ with the record key's combination is the same key without it", () => {
    expect(unshifted("ctrl+alt+shift+m")).toBe("ctrl+alt+m");
    expect(unshifted("m")).toBe("m");
  });

  it("names them as each system writes them", () => {
    expect(keyName("ctrl+alt+t", "mac")).toBe("⌃⌥T");
    expect(keyName("alt+shift+meta+ArrowLeft", "mac")).toBe("⌥⇧⌘←");
    expect(keyName("ctrl+alt+t", "windows")).toBe("Ctrl+Alt+T");
    expect(keyName("ctrl+shift+ ", "windows")).toBe("Ctrl+Shift+空格");
    // A single + is a key, not a combination.
    expect(keyName("+", "mac")).toBe("+");
  });
});

describe("heldOf", () => {
  it("shows the modifiers held while picking a key", () => {
    expect(heldOf(press("Alt", "AltLeft", { ctrl: true, alt: true }), "mac")).toBe("⌃⌥…");
    expect(heldOf(press("Alt", "AltLeft", { ctrl: true, alt: true }), "windows")).toBe("Ctrl+Alt+…");
  });

  it("nothing for Shift alone (it is part of a single key) or the Windows key", () => {
    expect(heldOf(press("Shift", "ShiftLeft", { shift: true }), "mac")).toBeNull();
    expect(heldOf(press("Meta", "MetaLeft", { meta: true }), "windows")).toBeNull();
  });
});
