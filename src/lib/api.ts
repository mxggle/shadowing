// The only module that talks to Rust. Everything else imports from here.
import { invoke } from "@tauri-apps/api/core";

export interface Track {
  path: string;
  name: string;
  relDir: string;
  size: number;
}

export interface FolderListing {
  root: string;
  name: string;
  tracks: Track[];
}

export interface Settings {
  rate: number;
  autoAdvance: boolean;
  /** Seconds jumped by ← → and the rewind/forward buttons. */
  seekStep: number;
  /** Last language picked for transcription ("" = detect). */
  transcribeLanguage: string;
}

export interface Progress {
  position: number;
  duration: number;
  updatedAt: number;
}

export interface Snapshot {
  folder: FolderListing | null;
  missingFolder: string | null;
  lastTrack: string | null;
  settings: Settings;
  progress: Record<string, Progress>;
}

export interface Sentence {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  /** Saved in the app ("imported", "transcribed"), or read from a subtitle file next to the audio ("sidecar"). */
  source: "imported" | "sidecar" | "transcribed";
  /** File name it came from, or "Groq · whisper-large-v3". */
  origin: string;
  sentences: Sentence[];
}

export type Feature = "transcribe" | "chat";

/** A service the app can use (fixed list, defined in Rust: src-tauri/src/ai/providers.rs). */
export interface Preset {
  id: string;
  name: string;
  /** "builtin": runs inside the app (whisper.cpp), configured via `api.local`. */
  api: "openAi" | "anthropic" | "builtin";
  /** Empty for custom servers. */
  baseUrl: string;
  /** Runs on this Mac. */
  local: boolean;
  key: "required" | "optional" | "none";
  keyUrl: string | null;
  features: Feature[];
  transcribeModel: string | null;
  /** [model, USD per hour of audio] */
  transcribePrices: [string, number][];
  chatModel: string | null;
  note: string;
}

export interface Choice {
  provider: string | null;
  model: string;
}

export interface AiConfig {
  transcribe: Choice;
  chat: Choice;
  baseUrls: Record<string, string>;
  /** "sk-…abcd" per provider with a saved key; the key itself stays in the Keychain. */
  keyHints: Record<string, string>;
}

export interface AiOverview {
  presets: Preset[];
  config: AiConfig;
}

export interface TestReport {
  models: number;
  modelFound: boolean;
  /** Explanations only: the sample sentence and the model's answer. */
  sample: string | null;
  reply: string | null;
  millis: number;
}

/** `transcribe:status` events; done/total are seconds of audio (total 0 = unknown). */
export type TranscribeStatus =
  | { state: "running"; path: string; done: number; total: number }
  | { state: "done"; path: string; transcript: Transcript }
  | { state: "failed"; path: string; message: string }
  | { state: "cancelled"; path: string };

/** A Whisper model that can run on this Mac. */
export interface LocalModel {
  id: string;
  name: string;
  /** Bytes. */
  size: number;
  memoryGb: number;
  note: string;
  downloaded: boolean;
  /** Bytes of an unfinished download, kept for resuming. */
  partial: number;
  fit: "good" | "tight" | "tooBig";
}

export interface LocalOverview {
  /** Apple Silicon; on Intel the "本机" option is not offered at all. */
  supported: boolean;
  ramGb: number;
  freeBytes: number | null;
  recommended: string;
  models: LocalModel[];
  downloading: string | null;
}

/** `local:download` events; done/total in bytes. */
export type DownloadStatus =
  | { state: "running"; id: string; done: number; total: number }
  | { state: "done"; id: string }
  | { state: "failed"; id: string; message: string }
  | { state: "cancelled"; id: string };

export const LOCAL_PROVIDER = "local";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export const api = {
  getSnapshot: () => invoke<Snapshot>("get_snapshot"),
  chooseFolder: () => invoke<FolderListing | null>("choose_folder"),
  rescanFolder: () => invoke<FolderListing | null>("rescan_folder"),
  saveProgress: (path: string, position: number, duration: number) =>
    invoke<void>("save_progress", { path, position, duration }),
  setLastTrack: (path: string | null) => invoke<void>("set_last_track", { path }),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  getTranscript: (path: string) => invoke<Transcript | null>("transcript_get", { path }),
  /** Opens the file picker; null when cancelled. */
  importTranscript: (path: string) => invoke<Transcript | null>("transcript_import", { path }),
  /** Asks first; returns what the track falls back to. */
  removeTranscript: (path: string) => invoke<Transcript | null>("transcript_remove", { path }),
  ai: {
    get: () => invoke<AiOverview>("ai_get"),
    choose: (feature: Feature, provider: string | null, model: string) =>
      invoke<AiConfig>("ai_choose", { feature, provider, model }),
    /** Empty string goes back to the default address. */
    setBaseUrl: (provider: string, url: string) => invoke<AiConfig>("ai_set_base_url", { provider, url }),
    /** Empty string deletes the saved key. */
    setKey: (provider: string, key: string) => invoke<AiConfig>("ai_set_key", { provider, key }),
    models: (provider: string, feature: Feature) => invoke<string[]>("ai_models", { provider, feature }),
    test: (feature: Feature) => invoke<TestReport>("ai_test", { feature }),
    openKeyPage: (provider: string) => invoke<void>("ai_open_key_page", { provider }),
    /** Ollama / LM Studio servers answering right now. */
    detectLocal: () => invoke<{ id: string; models: number }[]>("ai_detect_local"),
    /** Opens OpenRouter in the browser; resolves once the key is saved. */
    signInOpenRouter: () => invoke<AiConfig>("ai_sign_in_openrouter"),
    cancelSignIn: () => invoke<void>("ai_sign_in_cancel"),
  },
  local: {
    models: () => invoke<LocalOverview>("local_models"),
    /** Progress arrives as `local:download`. */
    download: (id: string) => invoke<void>("local_download", { id }),
    cancel: () => invoke<void>("local_cancel_download"),
    remove: (id: string) => invoke<LocalOverview>("local_delete", { id }),
  },
  transcribe: {
    /** language: ISO-639-1 code, or "" to detect. Progress arrives as `transcribe:status`. */
    start: (path: string, language: string) => invoke<void>("transcribe_start", { path, language }),
    cancel: () => invoke<void>("transcribe_cancel"),
    running: () => invoke<string | null>("transcribe_running"),
  },
  smokeMode: () => invoke<boolean>("smoke_mode"),
  smokeWindow: (minimized: boolean) => invoke<void>("smoke_window", { minimized }),
  smokeFinish: (code: number) => invoke<void>("smoke_finish", { code }),
};

/** Mirrors a diagnostic line to the terminal (printed by debug builds only). */
export function devLog(line: string) {
  if (isTauri()) void invoke("log_line", { line });
}
