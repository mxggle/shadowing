import { create } from "zustand";
import { AudioEngine } from "./audio/engine";
import { clampRate, clampSeekStep, cycleLoop, NO_LOOP, nudgeLoop, resumePosition, SEEK_STEP_DEFAULT, type Loop } from "./audio/logic";
import { listen } from "@tauri-apps/api/event";
import { api, type AiConfig, type AiOverview, type DownloadStatus, type FolderListing, type LocalOverview, type Progress, type Settings, type Track } from "./lib/api";
import { createGuideSlice, type GuideState } from "./guideSlice";
import { createTranscriptSlice, type TranscriptState } from "./transcriptSlice";

export interface AppState extends TranscriptState, GuideState {
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
  step(direction: 1 | -1): void;
  setRate(rate: number): void;
  setAutoAdvance(on: boolean): void;
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
      const { settings, loop } = get();
      if (settings.autoAdvance && loop.b === null) get().step(1);
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
    if (document.visibilityState === "hidden") saveProgress(true);
  });
  window.addEventListener("pagehide", () => saveProgress(true));

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

  function persistSettings(patch: Partial<Settings>) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    void api.saveSettings(settings);
  }

  /** `sentence`: which transcript sentence this loop repeats, if any. */
  function applyLoop(loop: Loop, loopSentence: number | null = null) {
    engine.setLoop(loop);
    set({ loop, loopSentence, repeats: 0 });
  }

  return {
    ready: false,
    folder: null,
    missingFolder: null,
    progress: {},
    settings: { rate: 1, autoAdvance: true, seekStep: SEEK_STEP_DEFAULT, transcribeLanguage: "" },
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
    ...createGuideSlice(set, get, engine),

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
      const last = snap.folder?.tracks.find((t) => t.path === snap.lastTrack);
      if (last) get().open(last, false);
    },

    setSettingsOpen(settingsOpen) {
      set({ settingsOpen });
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
      set({ folder, missingFolder: null, current: null, playing: false, time: 0, duration: 0, loop: NO_LOOP, repeats: 0, error: null, transcript: null, loopSentence: null, practicing: false });
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
      set({ current: track, time: start, duration: 0, loop: NO_LOOP, repeats: 0, error: null, transcript: null, loopSentence: null });
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

    step(direction) {
      const { folder, current } = get();
      if (!folder || !current) return;
      const i = folder.tracks.findIndex((t) => t.path === current.path);
      if (i < 0) return; // the sample clip isn't part of the folder
      const next = folder.tracks[i + direction];
      if (next) get().open(next, true);
    },

    setRate(rate) {
      const r = clampRate(rate);
      engine.setRate(r);
      persistSettings({ rate: r });
    },

    setAutoAdvance(autoAdvance) {
      persistSettings({ autoAdvance });
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
      applyLoop(loop, get().loopSentence);
      // Re-hear the new boundary immediately.
      if (which === "a" && loop.a !== null) engine.seek(loop.a);
      if (which === "b" && loop.b !== null) engine.seek(Math.max(loop.a ?? 0, loop.b - 1.5));
    },
  };
});
