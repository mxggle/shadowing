// The single keys that drive the player (Space, L, S, [ ]…), and the learner's own choices for them
// (设置 → 快捷键): another single key, or a combination with Ctrl, Alt or ⌘ ("ctrl+alt+t"). Only the
// keys the app picked can change; Esc (cancel), ? (this list), the ⌘ shortcuts and the keys inside a
// text field stay. Unit-tested in keymap.test.ts.
import { t, tk } from "./i18n";
import { platform, shortcut, type Platform } from "./platform";

export const ACTIONS = [
  "toggle",
  "back",
  "forward",
  "prevTrack",
  "nextTrack",
  "slower",
  "faster",
  "playMode",
  "picture",
  "loop",
  "pace",
  "sentenceLoop",
  "prevSentence",
  "nextSentence",
  "prevSection",
  "nextSection",
  "explain",
  "edit",
  "record",
  "replay",
] as const;
export type Action = (typeof ACTIONS)[number];

/** A key as `KeyboardEvent.key` names it, letters in lower case ("l", " ", "ArrowLeft", "["). */
export const DEFAULT_KEYS: Record<Action, string> = {
  toggle: " ",
  back: "ArrowLeft",
  forward: "ArrowRight",
  prevTrack: "ArrowUp",
  nextTrack: "ArrowDown",
  slower: "-",
  faster: "=",
  playMode: "r",
  picture: "v",
  loop: "l",
  pace: "g",
  sentenceLoop: "s",
  prevSentence: "[",
  nextSentence: "]",
  prevSection: "{",
  nextSection: "}",
  explain: "i",
  edit: "e",
  record: "m",
  replay: "p",
};

/** What each one does, in 设置 → 快捷键 (shown through t(), with {shift} filled). */
export const ACTION_LABELS: Record<Action, string> = {
  toggle: tk("播放 / 暂停"),
  back: tk("后退"),
  forward: tk("前进"),
  prevTrack: tk("上一个音频"),
  nextTrack: tk("下一个音频"),
  slower: tk("放慢"),
  faster: tk("加快"),
  playMode: tk("切换播放顺序"),
  picture: tk("视频：画面在上 / 并排 / 影院"),
  loop: tk("A–B 循环：设 A → 设 B → 取消"),
  pace: tk("跟读停顿：开 / 关"),
  sentenceLoop: tk("循环当前句 / 取消"),
  prevSentence: tk("上一句"),
  nextSentence: tk("下一句"),
  prevSection: tk("上一段"),
  nextSection: tk("下一段"),
  explain: tk("解释当前句"),
  edit: tk("修改当前句"),
  record: tk("跟读录音（加 {shift} 是整段录音）"),
  replay: tk("回放录音和原句对比"),
};

/** Keys that step or nudge, so holding them down keeps going. Toggles (Space, L, S…) fire once per press. */
export const REPEATING: ReadonlySet<Action> = new Set(["back", "forward", "prevTrack", "nextTrack", "prevSentence", "nextSentence", "prevSection", "nextSection", "slower", "faster"]);

/** The app's own: Esc cancels, ? shows the keys, the rest move focus, edit text or are modifiers. */
const RESERVED = new Set(["Escape", "?", "Tab", "Enter", "Backspace", "Delete", "Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "Dead", "Unidentified", "Process", "ContextMenu", "OS"]);

/** The key a keydown names, as the keymap keeps it; null for a modifier or a key that can't be bound. */
export function keyOf(e: Pick<KeyboardEvent, "key">): string | null {
  const key = e.key === "Spacebar" ? " " : e.key;
  if (!key || RESERVED.has(key)) return null;
  // One character (a letter, a digit, a sign), a key that moves (an arrow, PageUp, Home…) or F1–F12
  // (what foot pedals and page turners tend to send).
  if ([...key].length === 1) return key.toLowerCase();
  return NAMED.has(key) ? key : null;
}

const NAMED = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Insert", ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]);

// ---- Combinations ---------------------------------------------------------------------------------
// Ctrl, Alt or ⌘ held make a combination; Shift only adds to one (on its own it is part of the
// character: ⇧[ is {, ⇧L is L). Kept as "ctrl+alt+shift+meta+<key>", modifiers in that order.

type Press = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

const MODS = ["ctrl", "alt", "shift", "meta"] as const;

/** Signs by where they are on the keyboard (`KeyboardEvent.code`), as they are without Shift. */
const SIGNS: Record<string, string> = {
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  Space: " ",
};

/**
 * The key under the modifiers, by where it is: ⌥T types "†" on a Mac, and Ctrl+Alt+E "€" on some
 * Windows layouts, but both are T and E here. Falls back to the key itself without a code.
 */
function baseOf(e: Pick<KeyboardEvent, "key" | "code">): string | null {
  const code = e.code ?? "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^(Digit|Numpad)[0-9]$/.test(code)) return code.slice(-1);
  if (code in SIGNS) return SIGNS[code];
  if (NAMED.has(code)) return code;
  return keyOf(e);
}

/** Taken by the app (⌘B, ⌘C…; on a Mac Ctrl does those too), the Mac's menu (⌘Q, ⌘H…) or the system. */
const TAKEN_MAC: ReadonlySet<string> = new Set([
  ...["b", "v", "f", "z", "c"].flatMap((k) => [`meta+${k}`, `ctrl+${k}`]),
  "meta+,",
  ...["q", "w", "h", "m", "a", "x"].map((k) => `meta+${k}`),
  "alt+meta+h",
  "shift+meta+z",
  "ctrl+meta+f",
]);
const TAKEN: Record<Platform, ReadonlySet<string>> = {
  mac: TAKEN_MAC,
  windows: new Set([...["b", "v", "f", "z", "c", ","].map((k) => `ctrl+${k}`), "alt+F4"]),
  other: TAKEN_MAC,
};

/**
 * What a keydown is, as the keymap keeps it: a single key just as `keyOf` says (Shift folded in), or
 * with Ctrl, Alt or ⌘ held a combination ("ctrl+alt+t"). Null for a modifier on its own, a key that
 * can't be bound, or the Windows key (the system's).
 */
export function pressOf(e: Press, on: Platform = platform): string | null {
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return keyOf(e);
  if (on === "windows" && e.metaKey) return null;
  const base = baseOf(e);
  if (base === null) return null;
  const held = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
  return [...MODS.filter((m) => held[m]), base].join("+");
}

/** A combination's modifiers and the key under them; a single key has none. */
function split(key: string): { mods: string[]; base: string } {
  const mods: string[] = [];
  let base = key;
  for (const m of MODS) {
    if (base.startsWith(`${m}+`) && base.length > m.length + 1) {
      mods.push(m);
      base = base.slice(m.length + 1);
    }
  }
  return { mods, base };
}

/** A combination the app, the menu or the system already uses: not one to give an action. */
export function isTaken(key: string, on: Platform = platform): boolean {
  return TAKEN[on].has(key);
}

/** A key the keymap can hold: a single key, or a combination with Ctrl, Alt or ⌘ not already taken. */
function bindable(key: string): boolean {
  const { mods, base } = split(key);
  if (mods.length === 0) return keyOf({ key }) === key;
  const real = mods.some((m) => m !== "shift");
  return real && keyOf({ key: base }) === base && pressFrom(mods, base) === key && !isTaken(key);
}

/** The canonical form, to check a stored combination is written the way `pressOf` writes it. */
const pressFrom = (mods: string[], base: string) => [...MODS.filter((m) => mods.includes(m)), base].join("+");

/** While picking a key: the modifiers held so far, as "⌃⌥…" ("Ctrl+Alt+…"); null with none of Ctrl, Alt or ⌘. */
export function heldOf(e: Omit<Press, "key" | "code">, on: Platform = platform): string | null {
  const held = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey && on !== "windows" };
  if (!held.ctrl && !held.alt && !held.meta) return null;
  return keyName([...MODS.filter((m) => held[m]), "…"].join("+"), on);
}

/** The combination without Shift: ⇧ with the record key's combination records a section, as ⇧M does. */
export function unshifted(key: string): string {
  const { mods, base } = split(key);
  return pressFrom(mods.filter((m) => m !== "shift"), base);
}

/**
 * Every action's key: the default, or the learner's own (`custom`). A default taken by a key of
 * the learner's goes unbound rather than doing two things (a later version may add an action with a
 * key they had already used). Junk in `custom` (an unknown action, a reserved key) is ignored.
 */
export function keymap(custom: Record<string, string> | undefined): Record<Action, string | null> {
  // "" is an action the learner left without a key.
  const own = new Map<Action, string | null>();
  for (const a of ACTIONS) {
    const k = custom?.[a];
    if (k === "") own.set(a, null);
    else if (typeof k === "string" && bindable(k)) own.set(a, k);
  }
  const taken = new Set(own.values());
  const out = {} as Record<Action, string | null>;
  for (const a of ACTIONS) out[a] = own.has(a) ? own.get(a)! : taken.has(DEFAULT_KEYS[a]) ? null : DEFAULT_KEYS[a];
  // Two of the learner's own on one key (a hand-edited file): the first keeps it.
  const seen = new Set<string>();
  for (const a of ACTIONS) {
    const k = out[a];
    if (k === null) continue;
    if (seen.has(k)) out[a] = null;
    else seen.add(k);
  }
  return out;
}

/** The action a key does, if any. */
export function actionFor(map: Record<Action, string | null>, key: string | null): Action | undefined {
  return key === null ? undefined : ACTIONS.find((a) => map[a] === key);
}

/**
 * Gives `action` the key `key`. An action that had it takes `action`'s old key instead (they swap),
 * so nothing goes unbound by surprise. Returns the new choices, keeping only what differs from the
 * defaults, and which action swapped.
 */
export function rebind(custom: Record<string, string> | undefined, action: Action, key: string): { custom: Record<string, string>; swapped: Action | null } {
  const map = keymap(custom);
  const old = map[action];
  const other = ACTIONS.find((a) => a !== action && map[a] === key) ?? null;
  const next = { ...map, [action]: key };
  if (other) next[other] = old;
  return { custom: diff(next), swapped: other };
}

/** Back to the default key for one action (`action`), or for all. */
export function reset(custom: Record<string, string> | undefined, action?: Action): Record<string, string> {
  if (!action) return {};
  return rebind(custom, action, DEFAULT_KEYS[action]).custom;
}

/** Only the keys that differ from the defaults (an unbound action is kept as ""). */
function diff(map: Record<Action, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ACTIONS) if (map[a] !== DEFAULT_KEYS[a]) out[a] = map[a] ?? "";
  return out;
}

const NAMES: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  "-": "−",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

/** Modifiers as a Mac writes them, in its order (⌃⌥⇧⌘); `shortcut()` names them on Windows. */
const MOD_SIGNS: [string, string][] = [
  ["ctrl", "⌃"],
  ["alt", "⌥"],
  ["shift", "⇧"],
  ["meta", "⌘"],
];

/** A key as the key caps show it: "L", "←", "−", 空格 (Space), ⌃⌥T (Ctrl+Alt+T on Windows); "—" for none. */
export function keyName(key: string | null, on: Platform = platform): string {
  if (key === null || key === "") return "—";
  const { mods, base } = split(key);
  const name = base === " " ? t("空格") : (NAMES[base] ?? (base.length === 1 ? base.toUpperCase() : base));
  if (mods.length === 0) return name;
  return shortcut(MOD_SIGNS.filter(([m]) => mods.includes(m)).map(([, sign]) => sign).join("") + name, on);
}
