import { create } from "zustand";
import { AudioEngine } from "./audio/engine";
import { clampRate, clampSeekStep, cycleLoop, NO_LOOP, nudgeLoop, resumePosition, SEEK_STEP_DEFAULT, trackAfter, type Loop, type PlayMode } from "./audio/logic";
import { listen } from "@tauri-apps/api/event";
import { api, setMediaBase, type AiConfig, type AiOverview, type DownloadStatus, type FolderListing, type LocalOverview, type Progress, type Settings, type Track } from "./lib/api";
import { setLang, type Lang, type LangSetting } from "./lib/i18n";
import { playKey } from "./lib/playKey";
import { createCorrectSlice, type CorrectState } from "./correctSlice";
import { createDrillSlice, type DrillState } from "./drillSlice";
import { createExplainSlice, type ExplainState } from "./explainSlice";
import { createGuideSlice, type GuideState } from "./guideSlice";
import { createImportSlice, type ImportState } from "./importSlice";
import { createPracticeSlice, type PracticeState } from "./practiceSlice";
import { createProofreadSlice, type ProofreadState } from "./proofreadSlice";
import { createReadingSlice, type ReadingState } from "./readingSlice";
import { createRecordSlice, micOpen, type RecordState } from "./recordSlice";
import { createReshapeSlice, type ReshapeState } from "./reshapeSlice";
import { createTranscriptSlice, type LoopFrom, type TranscriptState } from "./transcriptSlice";
import { createUpdateSlice, type UpdateState } from "./updateSlice";
import { createVideoSlice, type VideoState } from "./videoSlice";

export interface AppState extends TranscriptState, CorrectState, ReshapeState, ProofreadState, ExplainState, GuideState, PracticeState, UpdateState, RecordState, ReadingState, DrillState, ImportState, VideoState {
  ready: boolean;
  folder: FolderListing | null;
  missingFolder: string | null;
  progress: Record<string, Progress>;
  settings: Settings;
  current: Track | null;
  playing: boolean;
  time: number;
  duration: number;
  loop: Loop;
  /** Passes the current loop has completed, counted by the Rust engine. */
  repeats: number;
  error: string | null;
  /** AI services and the choices made; loaded at start, never contains keys. */
  ai: AiOverview | null;
  /** Whisper models for transcribing on this Mac. */
  local: LocalOverview | null;
  /** Latest model download update. */
  download: DownloadStatus | null;
  settingsOpen: boolean;
  /** Whether the recordings sidebar is shown; remembered between launches. */
  shelfOpen: boolean;
  /** Interface language in use; the app re-renders when it changes (lib/i18n.ts). */
  lang: Lang;

  init(): Promise<void>;
  setSettingsOpen(open: boolean): void;
  setUiLanguage(language: LangSetting): Promise<void>;
  toggleShelf(): void;
  setAiConfig(config: AiConfig): void;
  setLocal(local: LocalOverview): void;
  chooseFolder(): Promise<void>;
  rescan(): Promise<void>;
  open(track: Track, autoplay?: boolean): void;
  /** The deck's play key: pauses / goes on with a recording or a playback, else plays / pauses the track. */
  toggle(): void;
  seek(t: number): void;
  seekBy(delta: number): void;
  /** Jump back (-1) or forward (+1) by the configured step. */
  jump(direction: 1 | -1): void;
  /** Previous / next track; `ended` when the current one just played to its end. */
  step(direction: 1 | -1, ended?: boolean): void;
  setRate(rate: number): void;
  setPlayMode(mode: PlayMode): void;
  setSeekStep(seconds: number): void;
  /** Light the playing sentence up a character at a time (true) or whole. */
  setWordHighlight(on: boolean): void;
  setTranscribeLanguage(language: string): void;
  cycleLoop(): void;
  clearLoop(): void;
  nudgeLoop(which: "a" | "b", delta: number): void;
}

const SHELF_KEY = "shadowing:shelfOpen";
function loadShelfOpen(): boolean {
  try {
    return localStorage.getItem(SHELF_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Audio or a video: something the engine can play (not a WebM or MKV listed only to say why it can't). */
export const playable = (track: Track) => track.kind !== "unsupported";

/** What the deck's play key does now (lib/playKey.ts). */
export const playKeyOf = ({ rec, live, drill, playingTake, playingReading, playing, current, folder }: AppState) =>
  playKey({
    rec,
    live: live && { phase: live.phase, paused: live.pausedAt !== null },
    drill,
    playingTake,
    playingReading,
    playing,
    hasTracks: current ? playable(current) : !!folder?.tracks.some(playable),
  });

const SAVE_EVERY_MS = 2000;
/** Holding = or typing a seek step changes settings many times a second; write once it settles. */
const SETTINGS_SETTLE_MS = 400;
/** Exposed for the debug smoke test only. */
export let debugEngine: AudioEngine | null = null;
let theEngine: AudioEngine | null = null;

/** Where the engine is now (between its status events too): what a video's picture follows. */
export const playhead = () => theEngine && { time: theEngine.time, playing: !theEngine.paused, rate: theEngine.speed };
let lastSaved = { path: "", position: -1 };

export const useApp = create<AppState>((set, get) => {
  const engine = new AudioEngine({
    onTime: (t) => {
      if (Math.abs(t - get().time) >= 0.05) set({ time: t });
    },
    onRepeats: (repeats) => set({ repeats }),
    onDuration: (d) => set({ duration: Number.isFinite(d) ? d : 0 }),
    onPlaying: (playing) => {
      set({ playing });
      if (playing) get().trackPlaying();
      if (!playing) {
        saveProgress(true);
        get().playbackStopped();
        get().readingPlaybackStopped();
      }
    },
    onEnded: () => {
      saveProgress(true);
      // An A–B or sentence loop never reaches the end, so this is the whole track finishing.
      if (get().loop.b === null) get().step(1, true);
    },
    onError: (error) => set({ error, playing: false }),
  });
  debugEngine = engine;
  theEngine = engine;

  void listen<DownloadStatus>("local:download", ({ payload }) => {
    set({ download: payload });
    if (payload.state !== "running") void api.local.models().then((local) => set({ local }));
  });

  // Fixed interval rather than a debounce: frequent time updates would keep
  // resetting a debounce and nothing would ever be saved.
  window.setInterval(() => {
    if (get().playing) saveProgress(false);
  }, SAVE_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveProgress(true);
      flushSettings();
    }
  });
  window.addEventListener("pagehide", () => {
    saveProgress(true);
    flushSettings();
  });

  function saveProgress(force: boolean) {
    const { current } = get();
    const duration = engine.duration;
    if (!current || duration <= 0) return;
    const position = engine.time;
    const same = lastSaved.path === current.path;
    if (same && Math.abs(position - lastSaved.position) < (force ? 0.1 : 1)) return;
    lastSaved = { path: current.path, position };
    const entry = { position, duration, updatedAt: Date.now() / 1000 };
    set((s) => ({ progress: { ...s.progress, [current.path]: entry } }));
    void api.saveProgress(current.path, position, duration);
  }

  let settingsTimer: number | null = null;
  function persistSettings(patch: Partial<Settings>) {
    set({ settings: { ...get().settings, ...patch } });
    if (settingsTimer !== null) window.clearTimeout(settingsTimer);
    settingsTimer = window.setTimeout(flushSettings, SETTINGS_SETTLE_MS);
  }

  function flushSettings() {
    if (settingsTimer === null) return;
    window.clearTimeout(settingsTimer);
    settingsTimer = null;
    void api.saveSettings(get().settings);
  }

  /** `from`: the transcript sentence or section this loop repeats, if any. */
  function applyLoop(loop: Loop, from: LoopFrom = {}) {
    engine.setLoop(loop);
    set({ loop, loopSentence: from.sentence ?? null, loopSection: from.section ?? null, repeats: 0 });
  }

  return {
    ready: false,
    folder: null,
    missingFolder: null,
    progress: {},
    settings: { rate: 1, playMode: "next", seekStep: SEEK_STEP_DEFAULT, transcribeLanguage: "", dailyGoals: [], recordMode: "listen", recordReplay: true, paragraphMode: "read", paragraphDrill: false, drillRounds: 3, wordHighlight: true, pictureHeight: 300, uiLanguage: "" },
    current: null,
    playing: false,
    time: 0,
    duration: 0,
    loop: NO_LOOP,
    repeats: 0,
    error: null,
    ai: null,
    local: null,
    download: null,
    settingsOpen: false,
    shelfOpen: loadShelfOpen(),
    lang: "zh",
    ...createTranscriptSlice(set, get, engine, applyLoop),
    ...createCorrectSlice(set, get),
    ...createReshapeSlice(set, get, engine, applyLoop),
    ...createProofreadSlice(set, get),
    ...createExplainSlice(set, get),
    ...createGuideSlice(set, get, engine),
    ...createPracticeSlice(set, get, persistSettings),
    ...createUpdateSlice(set, get),
    ...createRecordSlice(set, get, engine, persistSettings),
    ...createReadingSlice(set, get, engine, persistSettings),
    ...createDrillSlice(set, get, engine, persistSettings),
    ...createImportSlice(set, get),
    ...createVideoSlice(persistSettings),

    async init() {
      const [snap, ai, local] = await Promise.all([api.getSnapshot(), api.ai.get(), api.local.models()]);
      setLang(snap.uiLang);
      setMediaBase(snap.mediaBase);
      set({
        ready: true,
        lang: snap.uiLang,
        folder: snap.folder,
        missingFolder: snap.missingFolder,
        progress: snap.progress,
        settings: snap.settings,
        guide: snap.guide,
        ai,
        local,
        download: local.downloading ? { state: "running", id: local.downloading, done: 0, total: 0 } : null,
      });
      engine.setRate(snap.settings.rate);
      void get().restoreJob();
      get().watchImports();
      void get().refreshToday();
      const last = snap.folder?.tracks.find((t) => t.path === snap.lastTrack && playable(t));
      if (last) get().open(last, false);
    },

    setSettingsOpen(settingsOpen) {
      // One overlay at a time: ⌘, while the AI wizard is open replaces it (as the wizard replaces settings).
      set(settingsOpen ? { settingsOpen, wizardOpen: false, statsOpen: false, newsOpen: false } : { settingsOpen });
    },
    async setUiLanguage(uiLanguage) {
      // Kept in the store's settings too, so a settings save still pending can't undo it.
      set({ settings: { ...get().settings, uiLanguage } });
      const lang = await api.setUiLanguage(uiLanguage);
      // Service and model names (and notes) come from Rust in the language in use.
      const [ai, local] = await Promise.all([api.ai.get().catch(() => get().ai), api.local.models().catch(() => get().local)]);
      setLang(lang);
      // Explanations are kept per language (src-tauri/src/explain/saved.rs): drop this one's, bring back the other's.
      get().resetExplanations();
      set({ lang, ai, local });
      const current = get().current;
      if (current) void get().loadExplanations(current.path);
    },
    toggleShelf() {
      const shelfOpen = !get().shelfOpen;
      set({ shelfOpen });
      try {
        localStorage.setItem(SHELF_KEY, shelfOpen ? "1" : "0");
      } catch {
        /* a per-window convenience; fine to forget */
      }
    },

    setLocal(local) {
      set({ local });
    },

    setAiConfig(config) {
      const ai = get().ai;
      if (ai) set({ ai: { ...ai, config } });
    },

    async chooseFolder() {
      const folder = await api.chooseFolder();
      if (!folder) return;
      saveProgress(true);
      get().cancelTake();
      get().stopTake();
      get().cancelReading();
      get().stopReadingPlayback();
      engine.unload();
      set({ takes: [], readings: [], rec: null, live: null, recordAt: null, folder, missingFolder: null, current: null, playing: false, time: 0, duration: 0, loop: NO_LOOP, repeats: 0, error: null, transcript: null, loopSentence: null, loopSection: null, practicing: false });
      if (!get().guide.welcomed) get().saveGuide({ welcomed: true });
    },

    async rescan() {
      const folder = await api.rescanFolder();
      set({ folder });
    },

    open(track, autoplay = true) {
      saveProgress(true);
      get().cancelTake();
      get().stopTake();
      get().cancelReading();
      get().stopReadingPlayback();
      // Picking one of your own tracks ends the practice on the sample.
      if (get().practicing && track.path !== get().sample?.path) set({ practicing: false });
      if (!playable(track)) {
        // Shown with why it can't play (Stage); nothing to load, nothing to resume next time.
        engine.unload();
        set({ rec: null, live: null, current: track, playing: false, time: 0, duration: 0, loop: NO_LOOP, repeats: 0, error: null, transcript: null, loopSentence: null, loopSection: null, trackMs: 0, takes: [], readings: [] });
        return;
      }
      const start = resumePosition(get().progress[track.path]);
      set({ rec: null, live: null, current: track, time: start, duration: 0, loop: NO_LOOP, repeats: 0, error: null, transcript: null, loopSentence: null, loopSection: null, trackMs: 0 });
      void get().refreshToday();
      void get().loadTranscript(track.path);
      void get().loadTakes(track.path);
      void get().loadReadings(track.path);
      void engine.load(track.path, start, autoplay).then(() => engine.setRate(get().settings.rate));
      void api.setLastTrack(track.path);
    },

    toggle() {
      const key = playKeyOf(get());
      if (key.target !== "track") {
        if (!key.enabled) return;
        const s = get();
        const pause = key.running;
        if (key.target === "take") void s.pauseTake(pause);
        else if (key.target === "reading") void s.pauseReading(pause);
        else if (key.target === "takePlayback") s.pausePlayingTake(pause);
        else s.pausePlayingReading(pause);
        return;
      }
      if (micOpen(get())) return;
      const { current, folder } = get();
      if (!current) {
        const first = folder?.tracks.find(playable);
        if (first) get().open(first);
        return;
      }
      if (playable(current)) engine.toggle();
    },

    seek(t) {
      if (micOpen(get())) return;
      engine.seek(t);
      saveProgress(true);
    },

    seekBy(delta) {
      get().seek(engine.time + delta);
    },

    jump(direction) {
      get().seekBy(direction * get().settings.seekStep);
    },

    step(direction, ended = false) {
      const { folder, current, settings } = get();
      if (!current || micOpen(get())) return;
      // Over what can play; from a file that can't, on to its neighbours.
      const tracks = (folder?.tracks ?? []).filter((t) => playable(t) || t.path === current.path);
      // -1 for the sample clip, which isn't part of the folder.
      const i = tracks.findIndex((t) => t.path === current.path);
      const next = trackAfter(settings.playMode, i, tracks.length, direction, ended);
      // Starting the same track again (repeat one, or a one-track list): the engine restarts it from 0.
      if (ended && (settings.playMode === "one" || next === i)) engine.play();
      else if (next !== null) get().open(tracks[next], true);
    },

    setRate(rate) {
      if (micOpen(get())) return; // a take keeps the speed it began at
      const r = clampRate(rate);
      engine.setRate(r);
      persistSettings({ rate: r });
    },

    setPlayMode(playMode) {
      persistSettings({ playMode });
    },

    setSeekStep(seconds) {
      const seekStep = clampSeekStep(seconds);
      if (seekStep !== get().settings.seekStep) persistSettings({ seekStep });
    },

    setWordHighlight(wordHighlight) {
      persistSettings({ wordHighlight });
    },

    setTranscribeLanguage(transcribeLanguage) {
      if (transcribeLanguage !== get().settings.transcribeLanguage) persistSettings({ transcribeLanguage });
    },

    cycleLoop() {
      if (!get().current || micOpen(get())) return;
      const loop = cycleLoop(get().loop, engine.time);
      applyLoop(loop);
      // Setting B starts the first repeat right away.
      if (loop.a !== null && loop.b !== null) {
        engine.seek(loop.a);
        if (engine.paused) engine.play();
      }
    },

    clearLoop() {
      if (micOpen(get())) return;
      applyLoop(NO_LOOP);
    },

    nudgeLoop(which, delta) {
      if (micOpen(get())) return;
      const loop = nudgeLoop(get().loop, which, delta, engine.duration);
      applyLoop(loop, { sentence: get().loopSentence, section: get().loopSection });
      // Re-hear the new boundary immediately.
      if (which === "a" && loop.a !== null) engine.seek(loop.a);
      if (which === "b" && loop.b !== null) engine.seek(Math.max(loop.a ?? 0, loop.b - 1.5));
    },
  };
});
