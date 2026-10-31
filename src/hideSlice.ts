// 藏字幕 part of the single store: whether the sentences' text shows (a setting), and what shows
// anyway while it's hidden: the one clicked, the one playing while H is held, and with 听完再看
// those that have played through (lib/hide.ts has the rules).
import type { Settings } from "./lib/api";
import { heardBetween, hideHowOf, hideModeOf, leftRevealed, type HideMode } from "./lib/hide";
import type { AppState } from "./store";

export interface HideState {
  /** A hidden sentence clicked to see (until the track moves on from it). */
  revealed: number | null;
  /** H (or the 按住偷看 button) held: the sentence playing shows. */
  peek: boolean;
  /** Sentences of this track played through, for 听完再看. */
  heard: ReadonlySet<number>;
  setHideText(mode: HideMode): void;
  /** Shown ↔ hidden the way chosen last (H pressed). */
  toggleHideText(): void;
  revealSentence(index: number | null): void;
  setPeek(peek: boolean): void;
  /** H: a press toggles, holding it peeks. */
  hideKeyDown(): void;
  /** `toggle` false: let go somewhere else (the window lost focus), so only a peek ends. */
  hideKeyUp(toggle?: boolean): void;
  /** The track played from `from` to `to`: what it played through, and leaving a sentence clicked to see. */
  noteHeard(from: number, to: number): void;
  /** Another track: nothing heard yet. */
  hideReset(): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

/** Held this long, H peeks instead of toggling. */
const PEEK_AFTER_MS = 300;

export function createHideSlice(set: Set, get: Get, persistSettings: (patch: Partial<Settings>) => void): HideState {
  let pressing = false;
  let peekTimer = 0;

  return {
    revealed: null,
    peek: false,
    heard: new Set(),

    setHideText(mode) {
      const hideText = hideModeOf(mode);
      persistSettings(hideText === "show" ? { hideText } : { hideText, hideHow: hideText });
      set({ revealed: null });
    },

    toggleHideText() {
      const { hideText, hideHow } = get().settings;
      get().setHideText(hideModeOf(hideText) === "show" ? hideHowOf(hideHow) : "show");
    },

    revealSentence(revealed) {
      set({ revealed });
    },

    setPeek(peek) {
      if (get().peek !== peek) set({ peek });
    },

    hideKeyDown() {
      if (pressing) return;
      pressing = true;
      window.clearTimeout(peekTimer);
      // Held while hidden: peek at the sentence playing.
      peekTimer = window.setTimeout(() => {
        if (pressing && hideModeOf(get().settings.hideText) !== "show") get().setPeek(true);
      }, PEEK_AFTER_MS);
    },

    hideKeyUp(toggle = true) {
      if (!pressing) return;
      pressing = false;
      window.clearTimeout(peekTimer);
      if (get().peek) get().setPeek(false);
      else if (toggle) get().toggleHideText();
    },

    noteHeard(from, to) {
      const s = get();
      const mode = hideModeOf(s.settings.hideText);
      if (mode === "show") return;
      const sentences = s.transcript?.sentences ?? [];
      if (leftRevealed(sentences, s.revealed, from, to)) set({ revealed: null });
      if (mode !== "after") return;
      const played = heardBetween(sentences, from, to).filter((i) => !s.heard.has(i));
      if (played.length) set({ heard: new Set([...s.heard, ...played]) });
    },

    hideReset() {
      pressing = false;
      window.clearTimeout(peekTimer);
      set({ revealed: null, peek: false, heard: new Set() });
    },
  };
}
