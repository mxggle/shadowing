import { useMemo } from "react";
import { keymap, keyName, type Action } from "../lib/keymap";
import { useApp } from "../store";

/** The key each action is on, as key caps name it ("L", "←", 空格); follows 设置 → 快捷键. */
export function useKeys(): (action: Action) => string {
  const custom = useApp((s) => s.settings.shortcuts);
  // Also follows the interface language (空格 / Space).
  const lang = useApp((s) => s.lang);
  return useMemo(() => {
    const map = keymap(custom);
    return (action: Action) => (lang ? keyName(map[action]) : "");
  }, [custom, lang]);
}

/** The same outside a component (a tip, a message): the keys as they are now. */
export function keyNow(action: Action): string {
  return keyName(keymap(useApp.getState().settings.shortcuts)[action]);
}
