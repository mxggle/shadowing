// First-run guide part of the single store: the welcome answers, the hands-on
// practice on a bundled sample clip, the AI setup wizard and one-off tips.
import type { AudioEngine } from "./audio/engine";
import { NO_LOOP } from "./audio/logic";
import { api, type Guide, type Track } from "./lib/api";
import { t, tk } from "./lib/i18n";
import { hideHowOf, hideModeOf } from "./lib/hide";
import { keymap, keyName } from "./lib/keymap";
import { paceActive, withPause } from "./lib/pace";
import type { AppState } from "./store";

/** Shown once each, when the learner uses the mouse for something that has a key. */
export const TIPS = {
  sentenceLoop: tk("下次可以直接按 {sentenceLoop} 循环当前句，{prev} 和 {next} 换到上一句 / 下一句。"),
  rate: tk("按 {slower} 和 {faster} 也能调速度。"),
  abLoop: tk("按 {loop} 依次设 A、设 B、取消循环。"),
} as const;

/** The keys a tip names, as they are now (设置 → 快捷键 can move them). */
function tipKeys(shortcuts: Record<string, string>) {
  const map = keymap(shortcuts);
  return {
    loop: keyName(map.loop),
    sentenceLoop: keyName(map.sentenceLoop),
    prev: keyName(map.prevSentence),
    next: keyName(map.nextSentence),
    slower: keyName(map.slower),
    faster: keyName(map.faster),
  };
}
export type TipId = keyof typeof TIPS;

/**
 * Shown once each, at the moment the learner seems to want something the app can do, with a
 * button that does it (most of them): pausing by hand right after sentences, looping a sentence
 * with no gap to speak in, going on early or holding every pause.
 */
export const NUDGES = {
  pauseByHand: tk("想每句后自动停一下？跟读停顿会替你按暂停。"),
  loopGap: tk("循环之间想留几秒跟着说？"),
  paceFirst: tk("{toggle} 马上继续，Esc 一直等你；停多久在 ˄ 里调。"),
  paceShorter: tk("停顿有点长？"),
  paceLonger: tk("停顿不够？"),
  hideText: tk("能跟上了？试试藏起字幕跟。"),
} as const;
export type NudgeId = keyof typeof NUDGES;

/** A tip's button: what it says (and the key that does the same), and what it does. */
export interface HintAction {
  label: string;
  key?: string;
  run(): void;
}

const HINT_MS = 6000;
/** A nudge asks something, so it stays a little longer. */
const NUDGE_MS = 10000;

export interface GuideState {
  guide: Guide;
  /** The sample clip while practising on it. */
  sample: Track | null;
  practicing: boolean;
  wizardOpen: boolean;
  /** A tip currently on screen. */
  hint: string | null;
  /** Its button, for a nudge that has one. */
  hintAction: HintAction | null;

  saveGuide(patch: Partial<Guide>): void;
  /** Opens the sample for the learning language and shows the practice checklist. */
  startPractice(): Promise<void>;
  /** Done or skipped: leaves the sample (back to the folder, or the welcome screen). */
  endPractice(): void;
  setWizardOpen(open: boolean): void;
  tip(id: TipId): void;
  /** A nudge, once ever and at most one a session; never over a recording or a countdown. */
  nudge(id: NudgeId, action?: HintAction): void;
  /** A loop went round again: three times with no room to speak, or with the text still there, a nudge. */
  notePass(): void;
  /** Shows a short message in the same place as tips, for a few seconds (`ms`). */
  say(text: string, ms?: number): void;
  dismissHint(): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export function createGuideSlice(set: Set, get: Get, engine: AudioEngine): GuideState {
  let hintTimer = 0;
  let nudged = false;

  return {
    guide: { welcomed: false, language: "", practiced: false, tips: [], seenVersion: "" },
    sample: null,
    practicing: false,
    wizardOpen: false,
    hint: null,
    hintAction: null,

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
      get().paceReset();
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
      get().say(t(TIPS[id], tipKeys(get().settings.shortcuts)));
    },

    nudge(id, action) {
      const s = get();
      if (nudged || s.guide.tips.includes(id) || s.hint || s.rec || s.live || s.drill || (s.paceGap && s.paceGap.until !== null)) return;
      nudged = true;
      s.saveGuide({ tips: [...s.guide.tips, id] });
      s.say(t(NUDGES[id], { toggle: keyName(keymap(s.settings.shortcuts).toggle) }), NUDGE_MS);
      if (action) set({ hintAction: action });
    },

    notePass() {
      const s = get();
      if (s.repeats < 3) return;
      const keys = keymap(s.settings.shortcuts);
      if (s.loopSentence !== null && !paceActive(s.settings))
        s.nudge("loopGap", { label: t("每遍停一下"), run: () => get().setPace(withPause(get().settings)) });
      else if (hideModeOf(s.settings.hideText) === "show")
        s.nudge("hideText", { label: t("藏字幕"), key: keyName(keys.hideText), run: () => get().setHideText(hideHowOf(get().settings.hideHow)) });
    },

    say(text, ms = HINT_MS) {
      set({ hint: text, hintAction: null });
      window.clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => set({ hint: null, hintAction: null }), ms);
    },

    dismissHint() {
      window.clearTimeout(hintTimer);
      set({ hint: null, hintAction: null });
    },
  };
}
