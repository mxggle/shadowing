import { useEffect } from "react";
import { nextPlayMode, RATE_STEP } from "../audio/logic";
import { isTypingTarget } from "../lib/focus";
import { isBrowserKey, isMod } from "../lib/platform";
import { useApp } from "../store";
import { flash, type FlashId } from "./useFlash";

/** Keys that step or nudge, so holding them down keeps going. Toggles (Space, L, S, R…) fire once per press. */
const REPEATS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "[", "]", "{", "}", "-", "="]);

type State = ReturnType<typeof useApp.getState>;

/**
 * While recording only the recording's own keys act: a paragraph finishes,
 * cancels or puts the highlight right; a take skips the original, finishes or
 * cancels. Other keys do nothing.
 */
function recordingKey(e: KeyboardEvent, s: State) {
  const keys: Record<string, () => void> = s.live
    ? {
        " ": () => void s.finishReading(),
        M: () => void s.finishReading(),
        Escape: s.cancelReading,
        "[": () => s.stepReading(-1),
        "]": () => s.stepReading(1),
      }
    : { " ": s.advanceTake, m: s.advanceTake, M: s.advanceTake, Escape: s.cancelTake };
  const run = keys[e.key];
  e.preventDefault();
  if (!run) return;
  if (!e.repeat || e.key === "[" || e.key === "]") run();
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useApp.getState();
      if (s.settingsOpen || s.wizardOpen || s.statsOpen || s.newsOpen || s.linkImport) return;
      if ((s.live || s.rec) && !(e.metaKey || e.ctrlKey || e.altKey)) return recordingKey(e, s);
      if (isMod(e) && !e.altKey && !e.shiftKey) {
        const command: Record<string, (() => void) | false> = {
          b: s.toggleShelf,
          // A link copied elsewhere: import it (when a plugin takes it).
          v: () => void s.pasteLink(),
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
      if (s.playingReading && (e.key === " " || e.key === "Escape")) {
        e.preventDefault();
        s.stopReadingPlayback();
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
        // ⇧M a paragraph, M a sentence (by Shift, not the letter's case: Caps Lock doesn't count).
        m: [() => void (e.shiftKey ? s.startReading() : s.startTake())],
        M: [() => void (e.shiftKey ? s.startReading() : s.startTake())],
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
    // Windows' WebView has shortcuts of its own (reload, print, find); none of them belongs in the app
    // (`tauri dev` keeps them: reloading is handy there).
    const onBrowserKey = (e: KeyboardEvent) => {
      if (import.meta.env.PROD && isBrowserKey(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onBrowserKey, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onBrowserKey, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
