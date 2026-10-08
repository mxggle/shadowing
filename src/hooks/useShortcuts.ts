import { useEffect } from "react";
import { RATE_STEP } from "../audio/logic";
import { useApp } from "../store";

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useApp.getState();
      const actions: Record<string, () => void> = {
        " ": s.toggle,
        ArrowLeft: () => s.jump(-1),
        ArrowRight: () => s.jump(1),
        ArrowUp: () => s.step(-1),
        ArrowDown: () => s.step(1),
        l: s.cycleLoop,
        L: s.cycleLoop,
        Escape: s.clearLoop,
        "-": () => s.setRate(s.settings.rate - RATE_STEP),
        "=": () => s.setRate(s.settings.rate + RATE_STEP),
      };
      const action = actions[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
