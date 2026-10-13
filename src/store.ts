import { create } from "zustand";
import { AudioEngine } from "./audio/engine";
import { clampRate, clampSeekStep, cycleLoop, NO_LOOP, nudgeLoop, resumePosition, SEEK_STEP_DEFAULT, trackAfter, type Loop, type PlayMode } from "./audio/logic";
import { listen } from "@tauri-apps/api/event";
import { api, type AiConfig, type AiOverview, type DownloadStatus, type FolderListing, type LocalOverview, type Progress, type Settings, type Track } from "./lib/api";
import { createCorrectSlice, type CorrectState } from "./correctSlice";
import { createExplainSlice, type ExplainState } from "./explainSlice";
import { createGuideSlice, type GuideState } from "./guideSlice";
import { createPracticeSlice, type PracticeState } from "./practiceSlice";
import { createProofreadSlice, type ProofreadState } from "./proofreadSlice";
import { createTranscriptSlice, type LoopFrom, type TranscriptState } from "./transcriptSlice";
import { createUpdateSlice, type UpdateState } from "./updateSlice";

export interface AppState extends TranscriptState, CorrectState, ProofreadState, ExplainState, GuideState, PracticeState, UpdateState {
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

  init(): Promise<void>;
  setSettingsOpen(open: boolean): void;
  toggleShelf(): void;
  setAiConfig(config: AiConfig): void;
  setLocal(local: LocalOverview): void;
  chooseFolder(): Promise<void>;
  rescan(): Promise<void>;
  open(track: Track, autoplay?: boolean): void;
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

const SAVE_EVERY_MS = 2000;
/** Holding = or typing a seek step changes settings many times a second; write once it settles. */
const SETTINGS_SETTLE_MS = 400;
/** Exposed for the debug smoke test only. */
export let debugEngine: AudioEngine | null = null;
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
      if (!playing) saveProgress(true);
    },
    onEnded: () => {
      saveProgress(true);
      // An A–B or sentence loop never reaches the end, so this is the whole track finishing.
      if (get().loop.b === null) get().step(1, true);
    },
    onError: (error) => set({ error, playing: false }),
  });
  debugEngine = engine;

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
    settings: { rate: 1, playMode: "next", seekStep: SEEK_STEP_DEFAULT, transcribeLanguage: "", dailyGoals: [] },
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
    ...createTranscriptSlice(set, get, engine, applyLoop),
    ...createCorrectSlice(set, get),
    ...createProofreadSlice(set, get),
    ...createExplainSlice(set, get),
    ...createGuideSlice(set, get, engine),
    ...createPracticeSlice(set, get, persistSettings),
    ...createUpdateSlice(set, get),

    async init() {
      const [snap, ai, local] = await Promise.all([api.getSnapshot(), api.ai.get(), api.local.models()]);
      set({
        ready: true,
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
      void get().refreshToday();
      const last = snap.folder?.tracks.find((t) => t.path === snap.lastTrack);
      if (last) get().open(last, false);
    },

    setSettingsOpen(settingsOpen) {
      // One overlay at a time: ⌘, while the AI wizard is open replaces it (as the wizard replaces settings).
      set(settingsOpen ? { settingsOpen, wizardOpen: false, statsOpen: false } : { settingsOpen });
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
      engine.unload();
      set({ folder, missingFolder: null, current: null, playing: false, time: 0, duration: 0, loop: NO_LOOP, repeats: 0, error: null, transcript: null, loopSentence: null, loopSection: null, practicing: false });
      if (!get().guide.welcomed) get().saveGuide({ welcomed: true });
    },

    async rescan() {
      const folder = await api.rescanFolder();
      set({ folder });
    },

    open(track, autoplay = true) {
      saveProgress(true);
      // Picking one of your own tracks ends the practice on the sample.
      if (get().practicing && track.path !== get().sample?.path) set({ practicing: false });
      const start = resumePosition(get().progress[track.path]);
      set({ current: track, time: start, duration: 0, loop: NO_LOOP, repeats: 0, error: null, transcript: null, loopSentence: null, loopSection: null, trackMs: 0 });
      void get().refreshToday();
      void get().loadTranscript(track.path);
      void engine.load(track.path, start, autoplay).then(() => engine.setRate(get().settings.rate));
      void api.setLastTrack(track.path);
    },

    toggle() {
      const { current, folder } = get();
      if (!current) {
        const first = folder?.tracks[0];
        if (first) get().open(first);
        return;
      }
      engine.toggle();
    },

    seek(t) {
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
      if (!current) return;
      const tracks = folder?.tracks ?? [];
      // -1 for the sample clip, which isn't part of the folder.
      const i = tracks.findIndex((t) => t.path === current.path);
      const next = trackAfter(settings.playMode, i, tracks.length, direction, ended);
      // Starting the same track again (repeat one, or a one-track list): the engine restarts it from 0.
      if (ended && (settings.playMode === "one" || next === i)) engine.play();
      else if (next !== null) get().open(tracks[next], true);
    },

    setRate(rate) {
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

    setTranscribeLanguage(transcribeLanguage) {
      if (transcribeLanguage !== get().settings.transcribeLanguage) persistSettings({ transcribeLanguage });
    },

    cycleLoop() {
      if (!get().current) return;
      const loop = cycleLoop(get().loop, engine.time);
      applyLoop(loop);
      // Setting B starts the first repeat right away.
      if (loop.a !== null && loop.b !== null) {
        engine.seek(loop.a);
        if (engine.paused) engine.play();
      }
    },

    clearLoop() {
      applyLoop(NO_LOOP);
    },

    nudgeLoop(which, delta) {
      const loop = nudgeLoop(get().loop, which, delta, engine.duration);
      applyLoop(loop, { sentence: get().loopSentence, section: get().loopSection });
      // Re-hear the new boundary immediately.
      if (which === "a" && loop.a !== null) engine.seek(loop.a);
      if (which === "b" && loop.b !== null) engine.seek(Math.max(loop.a ?? 0, loop.b - 1.5));
    },
  };
});
