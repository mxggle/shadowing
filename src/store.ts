import { create } from "zustand";
import { AudioEngine } from "./audio/engine";
import { clampRate, clampSeekStep, cycleLoop, NO_LOOP, nudgeLoop, resumePosition, SEEK_STEP_DEFAULT, type Loop } from "./audio/logic";
import { api, type FolderListing, type Progress, type Settings, type Track } from "./lib/api";

interface AppState {
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
  error: string | null;

  init(): Promise<void>;
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
  cycleLoop(): void;
  clearLoop(): void;
  nudgeLoop(which: "a" | "b", delta: number): void;
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

  function applyLoop(loop: Loop) {
    engine.setLoop(loop);
    set({ loop });
  }

  return {
    ready: false,
    folder: null,
    missingFolder: null,
    progress: {},
    settings: { rate: 1, autoAdvance: true, seekStep: SEEK_STEP_DEFAULT },
    current: null,
    playing: false,
    time: 0,
    duration: 0,
    loop: NO_LOOP,
    error: null,

    async init() {
      const snap = await api.getSnapshot();
      set({
        ready: true,
        folder: snap.folder,
        missingFolder: snap.missingFolder,
        progress: snap.progress,
        settings: snap.settings,
      });
      engine.setRate(snap.settings.rate);
      const last = snap.folder?.tracks.find((t) => t.path === snap.lastTrack);
      if (last) get().open(last, false);
    },

    async chooseFolder() {
      const folder = await api.chooseFolder();
      if (!folder) return;
      saveProgress(true);
      engine.unload();
      set({ folder, missingFolder: null, current: null, playing: false, time: 0, duration: 0, loop: NO_LOOP, error: null });
    },

    async rescan() {
      const folder = await api.rescanFolder();
      set({ folder });
    },

    open(track, autoplay = true) {
      saveProgress(true);
      const start = resumePosition(get().progress[track.path]);
      set({ current: track, time: start, duration: 0, loop: NO_LOOP, error: null });
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
      applyLoop(loop);
      // Re-hear the new boundary immediately.
      if (which === "a" && loop.a !== null) engine.seek(loop.a);
      if (which === "b" && loop.b !== null) engine.seek(Math.max(loop.a ?? 0, loop.b - 1.5));
    },
  };
});
