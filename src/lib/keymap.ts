// The single keys that drive the player (Space, L, S, [ ]…), and the learner's own choices for them
// (设置 → 快捷键). Only the keys the app picked can change; Esc (cancel), ? (this list), the ⌘ shortcuts
// and the keys inside a text field stay. Unit-tested in keymap.test.ts.
import { t, tk } from "./i18n";

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
  // One character (a letter, a digit, a sign) or a key that moves (an arrow, PageUp, Home…).
  if ([...key].length === 1) return key.toLowerCase();
  return NAMED.has(key) ? key : null;
}

const NAMED = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Insert"]);

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
    else if (typeof k === "string" && keyOf({ key: k }) === k) own.set(a, k);
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

/** A key as the key caps show it: "L", "←", "−", 空格 (Space); "—" for none. */
export function keyName(key: string | null): string {
  if (key === null || key === "") return "—";
  if (key === " ") return t("空格");
  return NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}
