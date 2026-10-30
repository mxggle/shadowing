import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { ACTIONS, actionFor, DEFAULT_KEYS, keyName, keyOf, keymap, rebind, reset } from "./keymap";

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
