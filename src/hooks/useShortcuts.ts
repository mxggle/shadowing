import { useEffect } from "react";
import { nextPlayMode, RATE_STEP } from "../audio/logic";
import { useApp } from "../store";
import { flash, type FlashId } from "./useFlash";

export const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

/** Keys that step or nudge, so holding them down keeps going. Toggles (Space, L, S, R…) fire once per press. */
const REPEATS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "[", "]", "{", "}", "-", "="]);

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useApp.getState();
      if (s.settingsOpen || s.wizardOpen || s.statsOpen) return;
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
      // Reading a paragraph: finish, cancel, or put the highlight right.
      if (s.live) {
        const keys: Record<string, () => void> = {
          " ": () => void s.finishReading(),
          M: () => void s.finishReading(),
          Escape: s.cancelReading,
          "[": () => s.stepReading(-1),
          "]": () => s.stepReading(1),
        };
        e.preventDefault();
        if (!e.repeat || e.key === "[" || e.key === "]") keys[e.key]?.();
        return;
      }
      if (s.playingReading && (e.key === " " || e.key === "Escape")) {
        e.preventDefault();
        s.stopReadingPlayback();
        return;
      }
      // Recording: only the keys of the take itself.
      if (s.rec) {
        const take: Record<string, () => void> = { " ": s.advanceTake, m: s.advanceTake, M: s.advanceTake, Escape: s.cancelTake };
        e.preventDefault();
        if (!e.repeat) take[e.key]?.();
        return;
      }
      // A take playing back: Space or Esc stops it (instead of starting the track).
      if (s.playingTake && (e.key === " " || e.key === "Escape")) {
        e.preventDefault();
        s.stopTake();
        return;
      }
      const actions: Record<string, [() => void, FlashId?]> = {
        " ": [s.toggle, "toggle"],
        ArrowLeft: [() => s.jump(-1), "back"],
        ArrowRight: [() => s.jump(1), "forward"],
        ArrowUp: [() => s.step(-1), "prev"],
        ArrowDown: [() => s.step(1), "next"],
        l: [s.cycleLoop, "loop"],
        L: [s.cycleLoop, "loop"],
        Escape: [s.replace ? s.closeReplace : s.recordAt !== null ? s.closeRecorder : s.shownReading ? () => s.showReading(null) : s.clearLoop],
        "[": [() => s.stepSentence(-1), "prevSentence"],
        "]": [() => s.stepSentence(1), "nextSentence"],
        "{": [() => s.stepSection(-1)],
        "}": [() => s.stepSection(1)],
        s: [() => s.toggleSentenceLoop(), "sentenceLoop"],
        S: [() => s.toggleSentenceLoop(), "sentenceLoop"],
        i: [() => s.toggleExplain()],
        I: [() => s.toggleExplain()],
        e: [() => s.editSentence()],
        E: [() => s.editSentence()],
        m: [() => void s.startTake()],
        M: [() => void s.startReading()],
        p: [() => s.replayTake()],
        P: [() => s.replayTake()],
        r: [() => s.setPlayMode(nextPlayMode(s.settings.playMode)), "playMode"],
        R: [() => s.setPlayMode(nextPlayMode(s.settings.playMode)), "playMode"],
        "-": [() => s.setRate(s.settings.rate - RATE_STEP), "slower"],
        "=": [() => s.setRate(s.settings.rate + RATE_STEP), "faster"],
      };
      const entry = actions[e.key];
      if (!entry) return;
      e.preventDefault();
      if (e.repeat && !REPEATS.has(e.key)) return;
      entry[0]();
      if (entry[1]) flash(entry[1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
