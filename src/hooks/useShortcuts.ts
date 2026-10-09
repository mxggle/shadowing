import { useEffect } from "react";
import { RATE_STEP } from "../audio/logic";
import { useApp } from "../store";
import { flash, type FlashId } from "./useFlash";

export const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useApp.getState();
      if (s.settingsOpen || s.wizardOpen) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        const command: Record<string, (() => void) | false> = {
          b: s.toggleShelf,
          // Find in the sentences, starting from any text selected in them.
          f: !!s.transcript && (() => s.openReplace(window.getSelection()?.toString().trim() || undefined)),
          z: s.undo.length > 0 && (() => void s.undoEdit()),
        };
        const run = command[e.key.toLowerCase()];
        if (run) {
          e.preventDefault();
          run();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const actions: Record<string, [() => void, FlashId?]> = {
        " ": [s.toggle, "toggle"],
        ArrowLeft: [() => s.jump(-1), "back"],
        ArrowRight: [() => s.jump(1), "forward"],
        ArrowUp: [() => s.step(-1), "prev"],
        ArrowDown: [() => s.step(1), "next"],
        l: [s.cycleLoop, "loop"],
        L: [s.cycleLoop, "loop"],
        Escape: [s.replace ? s.closeReplace : s.clearLoop],
        "[": [() => s.stepSentence(-1), "prevSentence"],
        "]": [() => s.stepSentence(1), "nextSentence"],
        s: [() => s.toggleSentenceLoop(), "sentenceLoop"],
        S: [() => s.toggleSentenceLoop(), "sentenceLoop"],
        e: [() => s.editSentence()],
        E: [() => s.editSentence()],
        "-": [() => s.setRate(s.settings.rate - RATE_STEP), "slower"],
        "=": [() => s.setRate(s.settings.rate + RATE_STEP), "faster"],
      };
      const entry = actions[e.key];
      if (!entry) return;
      e.preventDefault();
      entry[0]();
      if (entry[1]) flash(entry[1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
