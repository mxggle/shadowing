// First-run guide part of the single store: the welcome answers, the hands-on
// practice on a bundled sample clip, the AI setup wizard and one-off tips.
import type { AudioEngine } from "./audio/engine";
import { NO_LOOP } from "./audio/logic";
import { api, type Guide, type Track } from "./lib/api";
import { t, tk } from "./lib/i18n";
import type { AppState } from "./store";

/** Shown once each, when the learner uses the mouse for something that has a key. */
export const TIPS = {
  sentenceLoop: tk("下次可以直接按 S 循环当前句，[ 和 ] 换到上一句 / 下一句。"),
  rate: tk("按 − 和 = 也能调速度。"),
  abLoop: tk("按 L 依次设 A、设 B、取消循环。"),
} as const;
export type TipId = keyof typeof TIPS;

const HINT_MS = 6000;

export interface GuideState {
  guide: Guide;
  /** The sample clip while practising on it. */
  sample: Track | null;
  practicing: boolean;
  wizardOpen: boolean;
  /** A tip currently on screen. */
  hint: string | null;

  saveGuide(patch: Partial<Guide>): void;
  /** Opens the sample for the learning language and shows the practice checklist. */
  startPractice(): Promise<void>;
  /** Done or skipped: leaves the sample (back to the folder, or the welcome screen). */
  endPractice(): void;
  setWizardOpen(open: boolean): void;
  tip(id: TipId): void;
  /** Shows a short message in the same place as tips, for a few seconds. */
  say(text: string): void;
  dismissHint(): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export function createGuideSlice(set: Set, get: Get, engine: AudioEngine): GuideState {
  let hintTimer = 0;

  return {
    guide: { welcomed: false, language: "", practiced: false, tips: [], seenVersion: "" },
    sample: null,
    practicing: false,
    wizardOpen: false,
    hint: null,

    saveGuide(patch) {
      const guide = { ...get().guide, ...patch };
      set({ guide });
      void api.saveGuide(guide);
    },

    async startPractice() {
      try {
        const sample = await api.sampleTrack(get().guide.language);
        get().saveGuide({ welcomed: true });
        set({ sample, practicing: true, settingsOpen: false });
        get().open(sample, false);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    endPractice() {
      const { sample, current } = get();
      set({ practicing: false });
      get().saveGuide({ practiced: true });
      if (!current || current.path !== sample?.path) return;
      // Leave the sample: nothing plays and the library (or welcome screen) shows again.
      get().cancelTake();
      get().stopTake();
      get().cancelReading();
      get().stopReadingPlayback();
      engine.unload();
      set({ rec: null, live: null, takes: [], readings: [], recordAt: null, current: null, playing: false, time: 0, duration: 0, loop: NO_LOOP, repeats: 0, transcript: null, loopSentence: null, loopSection: null });
      void api.setLastTrack(null);
    },

    setWizardOpen(wizardOpen) {
      set({ wizardOpen, settingsOpen: false, statsOpen: false, newsOpen: false });
    },

    tip(id) {
      const { guide } = get();
      if (guide.tips.includes(id)) return;
      get().saveGuide({ tips: [...guide.tips, id] });
      get().say(t(TIPS[id]));
    },

    say(text) {
      set({ hint: text });
      window.clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => set({ hint: null }), HINT_MS);
    },

    dismissHint() {
      window.clearTimeout(hintTimer);
      set({ hint: null });
    },
  };
}
