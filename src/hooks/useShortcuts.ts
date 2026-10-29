import { useEffect } from "react";
import { nextPlayMode, RATE_STEP } from "../audio/logic";
import { copyText } from "../lib/clipboard";
import { isTypingTarget } from "../lib/focus";
import { t } from "../lib/i18n";
import { actionFor, keyOf, keymap, REPEATING, type Action } from "../lib/keymap";
import { paceLabel } from "../lib/pace";
import { isBrowserKey, isMod } from "../lib/platform";
import { sentenceIndexAt } from "../lib/sentences";
import { useApp } from "../store";
import { flash, type FlashId } from "./useFlash";

type State = ReturnType<typeof useApp.getState>;

/**
 * While recording only the recording's own keys act: a paragraph finishes,
 * cancels or puts the highlight right; a take skips the original, finishes or
 * cancels. Other keys do nothing.
 */
function recordingKey(e: KeyboardEvent, s: State) {
  const map = keymap(s.settings.shortcuts);
  const key = keyOf(e);
  const keys: Record<string, () => void> = {};
  if (s.live) {
    keys[" "] = () => void s.finishReading();
    if (map.record) keys[map.record] = () => void s.finishReading();
    keys.Escape = s.cancelReading;
    if (map.prevSentence) keys[map.prevSentence] = () => s.stepReading(-1);
    if (map.nextSentence) keys[map.nextSentence] = () => s.stepReading(1);
  } else {
    keys[" "] = s.advanceTake;
    if (map.record) keys[map.record] = s.advanceTake;
    keys.Escape = s.cancelTake;
  }
  const run = keys[e.key === "Escape" ? "Escape" : (key ?? "")];
  e.preventDefault();
  if (!run) return;
  const stepping = key !== null && (key === map.prevSentence || key === map.nextSentence);
  if (!e.repeat || stepping) run();
}

/** ⌘C with nothing selected: the sentence playing (or looping) goes to the clipboard. */
function copySentence(s: State): boolean {
  if (window.getSelection()?.toString()) return false; // a selection copies as usual
  const list = s.transcript?.sentences ?? [];
  const i = s.loopSentence ?? sentenceIndexAt(list, s.time);
  const sentence = list[i];
  if (!sentence) return false;
  void copyText(sentence.text).then((ok) => s.say(ok ? t("已复制第 {n} 句", { n: i + 1 }) : t("没能复制"), 1800));
  return true;
}

/** Each action: what it does, and the on-screen button it presses. */
function actions(s: State, e: KeyboardEvent): Record<Action, [() => void, FlashId?]> {
  return {
    toggle: [s.toggle, "toggle"],
    back: [() => s.jump(-1), "back"],
    forward: [() => s.jump(1), "forward"],
    prevTrack: [() => s.step(-1), "prev"],
    nextTrack: [() => s.step(1), "next"],
    slower: [() => s.setRate(s.settings.rate - RATE_STEP), "slower"],
    faster: [() => s.setRate(s.settings.rate + RATE_STEP), "faster"],
    playMode: [() => s.setPlayMode(nextPlayMode(s.settings.playMode)), "playMode"],
    picture: [s.cyclePictureLayout],
    loop: [s.cycleLoop, "loop"],
    pace: [
      () => {
        s.togglePace();
        const on = useApp.getState().settings;
        s.say(on.paceOn ? t("跟读停顿：开（{how}）", { how: paceLabel(on) }) : t("跟读停顿：关"), 2500);
      },
      "pace",
    ],
    sentenceLoop: [() => s.toggleSentenceLoop(), "sentenceLoop"],
    prevSentence: [() => s.stepSentence(-1), "prevSentence"],
    nextSentence: [() => s.stepSentence(1), "nextSentence"],
    prevSection: [() => s.stepSection(-1)],
    nextSection: [() => s.stepSection(1)],
    explain: [() => s.toggleExplain()],
    edit: [() => s.editSentence()],
    // With ⇧ a paragraph, without a sentence (by Shift, not the letter's case: Caps Lock doesn't count).
    record: [() => void (e.shiftKey ? s.startReading() : s.startTake())],
    replay: [() => s.replayTake()],
  };
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useApp.getState();
      if (s.settingsOpen || s.wizardOpen || s.statsOpen || s.newsOpen || s.linkImport) return;
      if ((s.live || s.rec) && !(e.metaKey || e.ctrlKey || e.altKey)) return recordingKey(e, s);
      if (isMod(e) && !e.altKey && !e.shiftKey) {
        const command: Record<string, (() => boolean | void) | false> = {
          b: s.toggleShelf,
          // A link copied elsewhere: import it (when a plugin takes it).
          v: () => void s.pasteLink(),
          // Find in the sentences, starting from any text selected in them.
          f: !!s.transcript && (() => s.openReplace(window.getSelection()?.toString().trim() || undefined)),
          z: s.undo.length > 0 && (() => void s.undoEdit()),
          c: () => copySentence(s),
        };
        const run = command[e.key.toLowerCase()];
        // A command that declines (⌘C with text selected) leaves the key to the WebView.
        if (run && run() !== false) e.preventDefault();
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
      if (e.key === "Escape") {
        e.preventDefault();
        // The nearest thing first; a pause after a sentence waits for you instead of going on.
        if (s.replace) s.closeReplace();
        else if (s.recordAt !== null) s.closeRecorder();
        else if (s.shownReading) s.showReading(null);
        else if (!s.paceHold()) s.clearLoop();
        return;
      }
      const action = actionFor(keymap(s.settings.shortcuts), keyOf(e));
      if (!action) return;
      e.preventDefault();
      if (e.repeat && !REPEATING.has(action)) return;
      const [run, flashId] = actions(s, e)[action];
      run();
      if (flashId) flash(flashId);
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
