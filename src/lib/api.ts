// The only module that talks to Rust. Everything else imports from here.
import { invoke } from "@tauri-apps/api/core";
import type { PlayMode } from "../audio/logic";

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
  /** What happens when a track plays to its end. */
  playMode: PlayMode;
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

/** First-run guide: what the learner chose and has done. */
export interface Guide {
  /** The welcome screen was answered (or skipped). */
  welcomed: boolean;
  /** "ja", "en" or "other": picks the sample clip. */
  language: string;
  /** The practice on the sample was finished or skipped. */
  practiced: boolean;
  /** Contextual tips already shown once. */
  tips: string[];
}

export interface Snapshot {
  folder: FolderListing | null;
  missingFolder: string | null;
  lastTrack: string | null;
  settings: Settings;
  progress: Record<string, Progress>;
  guide: Guide;
}

export interface Sentence {
  start: number;
  end: number;
  text: string;
  /** Who says it (0 = the first voice heard); only set when a transcription heard more than one. */
  speaker?: number;
  /** Parts of the text the transcriber was unsure of: [start, end) string offsets. */
  unsure?: [number, number][];
}

/** New text for one sentence (by its index in the transcript); times and speaker stay. */
export interface SentenceEdit {
  index: number;
  text: string;
  /** Underlines that still apply to the new text; none when left out. */
  unsure?: [number, number][];
}

export interface Transcript {
  /** Saved in the app ("imported", "transcribed"), or read from a subtitle file next to the audio ("sidecar"). */
  source: "imported" | "sidecar" | "transcribed";
  /** File name it came from, or "Groq · whisper-large-v3". */
  origin: string;
  sentences: Sentence[];
  /** Some sentence text was corrected by hand. */
  edited?: boolean;
}

/** A word the AI thinks was misheard, shown under its sentence until accepted or ignored. */
export interface Suggestion {
  index: number;
  from: string;
  to: string;
  reason: string;
}

/** What the explanation model says about one sentence (Simplified Chinese; `reading` only for Japanese). */
export interface Explanation {
  translation: string;
  words: { word: string; reading: string; meaning: string }[];
  points: { point: string; note: string }[];
  /** Who answered, e.g. "ChatGPT · gpt-6-luna" (本机 first when it ran on this Mac). */
  source: string;
}

/** An answer kept from an earlier run, for the sentence as it was asked. */
export interface SavedExplanation {
  index: number;
  text: string;
  explanation: Explanation;
}

/** Sent while proofreading: how many parts of the transcript are done. */
export interface ProofreadProgress {
  path: string;
  done: number;
  total: number;
}

export type Feature = "transcribe" | "chat";

/** A service the app can use (fixed list, defined in Rust: src-tauri/src/ai/providers.rs). */
export interface Preset {
  id: string;
  name: string;
  /** "builtin": runs inside the app (whisper.cpp), configured via `api.local`. */
  api: "openAi" | "anthropic" | "builtin" | "responses";
  /** Empty for custom servers. */
  baseUrl: string;
  /** Runs on this Mac. */
  local: boolean;
  /** "account": signed in through the browser (ChatGPT), no key to paste. */
  key: "required" | "optional" | "none" | "account";
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
  /** "sk-…abcd" per provider with a saved key (the account email for ChatGPT); keys stay in the Keychain. */
  keyHints: Record<string, string>;
  chatgptClientId: string | null;
  chatgptHostId: string | null;
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
  /** done / total in seconds of audio; "speakers" is the pass that tells the voices apart. */
  | { state: "running"; path: string; step: "transcribe" | "speakers"; done: number; total: number }
  /** saved: false for a trial run (the setup wizard's test on the sample). */
  | { state: "done"; path: string; transcript: Transcript; saved: boolean }
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
  saveGuide: (guide: Guide) => invoke<void>("guide_save", { guide }),
  /** The bundled practice clip (Japanese for "ja", English otherwise), with its subtitles beside it. */
  sampleTrack: (language: string) => invoke<Track>("sample_track", { language }),
  getTranscript: (path: string) => invoke<Transcript | null>("transcript_get", { path }),
  /** Opens the file picker; null when cancelled. */
  importTranscript: (path: string) => invoke<Transcript | null>("transcript_import", { path }),
  /** Asks first; returns what the track falls back to. */
  removeTranscript: (path: string) => invoke<Transcript | null>("transcript_remove", { path }),
  /** Corrected sentence text, saved in the app (a subtitle file next to the audio stays as it is). */
  editTranscript: (path: string, edits: SentenceEdit[]) => invoke<Transcript>("transcript_edit", { path, edits }),
  proofread: {
    /** Asks the explanation model for misheard words; changes nothing. Progress: `proofread:progress`. */
    start: (path: string) => invoke<Suggestion[]>("transcript_proofread", { path }),
    cancel: () => invoke<void>("transcript_proofread_cancel"),
  },
  /** Asks the explanation model about one sentence; `text` must still be what it says. */
  explainSentence: (path: string, index: number, text: string) =>
    invoke<Explanation>("sentence_explain", { path, index, text }),
  /** Answers kept for a track whose sentences still say the same. */
  savedExplanations: (path: string) => invoke<SavedExplanation[]>("sentence_explanations", { path }),
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
    /** Sign in with ChatGPT (OpenAI preview); resolves once tokens are in the Keychain. */
    signInChatGPT: () => invoke<AiConfig>("ai_sign_in_chatgpt"),
    signOutChatGPT: () => invoke<AiConfig>("ai_sign_out_chatgpt"),
  },
  local: {
    models: () => invoke<LocalOverview>("local_models"),
    /** Progress arrives as `local:download`. */
    download: (id: string) => invoke<void>("local_download", { id }),
    cancel: () => invoke<void>("local_cancel_download"),
    remove: (id: string) => invoke<LocalOverview>("local_delete", { id }),
  },
  transcribe: {
    /**
     * language: ISO-639-1 code, or "" to detect. Progress arrives as `transcribe:status`.
     * keep: false for a trial run whose result is not saved.
     */
    start: (path: string, language: string, keep = true) => invoke<void>("transcribe_start", { path, language, keep }),
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
