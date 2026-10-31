// The only module that talks to Rust. Everything else imports from here.
import { invoke } from "@tauri-apps/api/core";
import type { PlayMode } from "../audio/logic";
import type { Lang, LangSetting } from "./i18n";
import type { NowPlaying } from "./mediaKeys";
import type { BookEntry } from "./book";
import type { HideHow, HideMode } from "./hide";
import type { PauseLength, PauseMode, PauseWait } from "./pace";

/** Audio; a video (the engine plays its sound, a `<video>` its picture); or a video the app can't play (WebM, MKV), listed to say why. */
export type TrackKind = "audio" | "video" | "unsupported";

/** Above the sentences, beside them, or large on its own. */
export type PictureLayout = "stack" | "side" | "theater";

export interface Track {
  path: string;
  name: string;
  relDir: string;
  size: number;
  kind: TrackKind;
}

let mediaBase = "";
/** The app's local server for videos (src-tauri/src/media.rs), from the snapshot; the browser mock sets its own. */
export const setMediaBase = (base: string) => void (mediaBase = base);
/** Where a video's `<video>` loads it from: only videos in the open folder are served. */
export const mediaUrl = (path: string) => `${mediaBase}/${encodeURIComponent(path)}`;

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
  /** Daily practice goal as changes over time (see goalOn in lib/practice.ts). */
  dailyGoals: GoalChange[];
  /** 跟读录音: hear the sentence then say it, or say it along with the original. */
  recordMode: RecordMode;
  /** Play the take back (against the original) as soon as it's recorded. */
  recordReplay: boolean;
  /** A whole paragraph: read it on your own, or along with the original… */
  paragraphMode: ParagraphMode;
  /** …or 逐句跟读 instead (see readingHow; a field of its own so older versions can still read the settings). */
  paragraphDrill: boolean;
  /** 逐句跟读: times each sentence is said before the next (1–20). */
  drillRounds: number;
  /** Light the playing sentence up a character (a word) at a time, where transcription timed them. */
  wordHighlight: boolean;
  /** 配音 picked for videos: said along (`recordMode` "shadow"), the original silent, the picture showing. */
  recordDub: boolean;
  /** 从链接导入 last brought the picture this tall (0: only the sound). */
  importVideo: number;
  /** Height of a video's picture above the sentences, in CSS pixels. */
  pictureHeight: number;
  /** How a video's picture is shown; "side" falls back to "stack" in a narrow window (lib/picture.ts). */
  pictureLayout: PictureLayout;
  /** A blurred band over subtitles burned into the picture, from `maskTop` to `maskBottom` (fractions of its height). */
  pictureMask: boolean;
  maskTop: number;
  maskBottom: number;
  /** Only listen: a video's picture isn't shown (or decoded). */
  pictureHidden: boolean;
  /** Plugins' marks on the sentences (标注: readings over words, a line under…). */
  annotations: boolean;
  /** 跟读停顿 on: one sentence at a time, each `sentenceRepeats` times with a pause after every time (lib/pace.ts). */
  paceOn: boolean;
  pauseMode: PauseMode;
  /** "length": 短 / 标准 / 长, or "custom" (`pauseRatio`); "" in files from before the steps. */
  pauseLength: PauseLength;
  /** "fixed": seconds (0 = no pause). */
  pauseSeconds: number;
  /** "length" and "custom": times the sentence's length (as it plays, at the speed set). */
  pauseRatio: number;
  /** "wait": for a key, or until you've said it (the mic listens). */
  pauseWait: PauseWait;
  /** Times each sentence plays before the next (1–10). */
  sentenceRepeats: number;
  /** 藏字幕: the sentences' text shown, hidden, or shown once each has played (lib/hide.ts). */
  hideText: HideMode;
  /** The way to hide that H goes back to. */
  hideHow: HideHow;
  /** Keys the learner chose (action → key), only those that differ from the defaults (lib/keymap.ts). */
  shortcuts: Record<string, string>;
  /** 媒体键: the keyboard's ⏯ ⏮ ⏭ and a headset's buttons work the player (lib/mediaKeys.ts). */
  mediaKeys: boolean;
  /** Interface language chosen in settings ("" follows the Mac); see lib/i18n.ts. */
  uiLanguage: LangSetting;
}

/** 听完再说 / 边听边说 for one sentence; "read" is reading a paragraph on your own. */
export type RecordMode = "listen" | "shadow" | "read";
export type ParagraphMode = "read" | "shadow";

/** One recording of you saying a sentence (src-tauri/src/record/saved.rs). */
export interface Take {
  id: string;
  /** Unix ms. */
  created: number;
  /** The part of the track practised (seconds). */
  start: number;
  end: number;
  /** The sentence as it read then ("" for an A–B loop). */
  text: string;
  mode: RecordMode;
  rate: number;
  /** Length of the stored take, and where each voice is in it (seconds). */
  duration: number;
  original: [number, number];
  mine: [number, number];
  /** Shadowing: how far behind the original you were. */
  lagMs: number | null;
  /** Loudness outlines, 50 values a second (0–255). */
  peaks: { original: number[]; mine: number[] };
  /** The paragraph reading this sentence was cut from. */
  group?: string | null;
  /** Heard through Bluetooth earphones: `lagMs` is too large by their delay. */
  bluetooth?: boolean;
  /** Where in the track the original in the file begins (at `original[0]`): a video's picture follows the take with it. */
  originalAt?: number;
  /** 配音: said along with the picture, the original silent. */
  dub?: boolean;
}

/** A paragraph read in one go (src-tauri/src/record/saved.rs); each sentence is also a take. */
export interface RecordingSpace {
  bytes: number;
  /** Audio files moved or deleted (not merely on a disk that isn't connected), and their recordings' size. */
  missingTracks: number;
  missingBytes: number;
}

export interface Reading {
  id: string;
  created: number;
  /** The stretch of the track read. */
  start: number;
  end: number;
  mode: ParagraphMode;
  rate: number;
  duration: number;
  parts: ReadPart[];
  /** The original's length (at the speed compared against) and yours, first word to last. */
  originalSecs: number;
  mineSecs: number;
  lagMs: number | null;
  /** Your voice over the whole reading, 50 values a second. */
  peaks: number[];
  /** Heard through Bluetooth earphones (see `Take.bluetooth`). */
  bluetooth?: boolean;
}

export interface ReadPart {
  /** The sentence in the track. */
  start: number;
  end: number;
  /** Where you said it in the reading. */
  mine: [number, number];
  /** Its own take; null when it wasn't said. */
  take: string | null;
}

/** What a recording kept: one take, or a reading and its sentences' takes. */
export interface Finished {
  takes: Take[];
  reading: Reading | null;
}

/** All of you, you with the original, or each sentence: the original then you. */
export type ReadingWhat = "mine" | "together" | "turns";

export interface ReadingPlaying {
  clip: number;
  duration: number;
  /** `clipAt` seconds in, sentence `part` of the reading plays on `lane` for `len`. */
  stretches: { clipAt: number; len: number; part: number; lane: "original" | "mine" | "both" }[];
}

/** What to play of a take: each voice alone, one after the other, or both at once. */
export type TakePart = "original" | "mine" | "compare" | "together";

/** `clipAt` seconds into a playing clip, the take from `from` to `to` is heard on `lane`. */
export interface ClipPart {
  lane: "original" | "mine" | "both";
  from: number;
  to: number;
  clipAt: number;
}

export interface Playing {
  clip: number;
  parts: ClipPart[];
  duration: number;
}

export interface RecordMeta {
  audio: string;
  start: number;
  end: number;
  text: string;
  mode: RecordMode;
  rate: number;
  /** A paragraph's sentences, in order. */
  sentences?: { start: number; end: number; text: string }[];
  /** 配音 (a video): said along, the speakers silent, the picture showing. */
  dub?: boolean;
}

export interface GoalChange {
  /** First practice day ("2026-10-11") this goal applies to. */
  since: string;
  /** Minutes a day; 0 = no goal. */
  minutes: number;
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
  /** The version whose 新功能 the learner has seen ("" before that was remembered). */
  seenVersion: string;
}

export interface Snapshot {
  folder: FolderListing | null;
  missingFolder: string | null;
  lastTrack: string | null;
  settings: Settings;
  progress: Record<string, Progress>;
  guide: Guide;
  /** The interface language in use, resolved by Rust from `settings.uiLanguage`. */
  uiLang: Lang;
  /** Where videos' pictures are served from (see `mediaUrl`). */
  mediaBase: string;
}

/** A stretch of practice on one audio (see src-tauri/src/practice/clock.rs). */
export interface PracticeSession {
  audio: string;
  /** Unix ms of the first and last activity; all of it counts. */
  start: number;
  end: number;
  /** Ms of that the audio was playing. */
  played: number;
}

export interface Sentence {
  start: number;
  end: number;
  text: string;
  /** Who says it (0 = the first voice heard); only set when a transcription heard more than one. */
  speaker?: number;
  /** Parts of the text the transcriber was unsure of: [start, end) string offsets. */
  unsure?: [number, number][];
  /**
   * When each character (each word, in languages written with spaces) is said:
   * [string offset, seconds], in order. Only transcription knows them; they move
   * with the text when it's corrected (src-tauri/src/timing.rs).
   */
  times?: [number, number][];
}

/** New text for one sentence (by its index in the transcript); times and speaker stay. */
export interface SentenceEdit {
  index: number;
  text: string;
  /** Underlines that still apply to the new text; none when left out. */
  unsure?: [number, number][];
}

/** A run of sentences that belong together (one dialog of several on a track). */
export interface Section {
  /** Index of its first sentence. */
  start: number;
  /** The learner's name for it; shown as "对话 2" without one. */
  title?: string;
}

export interface Transcript {
  /** Saved in the app ("imported", "transcribed"), or read from a subtitle file next to the audio ("sidecar"). */
  source: "imported" | "sidecar" | "transcribed";
  /** File name it came from, or "Groq · whisper-large-v3". */
  origin: string;
  sentences: Sentence[];
  /** Some sentence text was corrected by hand. */
  edited?: boolean;
  /** Where each section starts, the first at sentence 0 (missing = one section). */
  sections?: Section[];
}

/** A word the AI thinks was misheard, shown under its sentence until accepted or ignored. */
export interface Suggestion {
  index: number;
  from: string;
  to: string;
  reason: string;
}

/** What the explanation model says about one sentence, piece by piece (Simplified Chinese; `reading` only for Japanese). */
export interface Explanation {
  translation: string;
  /** The sentence in order: what each piece means here, and what its grammar does (either may be empty). */
  parts: { text: string; reading: string; meaning: string; note: string }[];
  /** How it is said ("带点埋怨"); may be empty. */
  tone: string;
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
  /** Like "Apple M2 Pro". */
  chip: string;
  ramGb: number;
  freeBytes: number | null;
  recommended: string;
  /** Why the recommended model suits this Mac. */
  reason: string;
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

/** A newer version on GitHub Releases. */
export interface AvailableUpdate {
  version: string;
  current: string;
  /** The release's CHANGELOG section (Markdown). */
  notes: string | null;
}

/** `update:progress` events while an update downloads; bytes, total null when unknown. */
export interface UpdateProgress {
  done: number;
  total: number | null;
}

/** An installed plugin (src-tauri/src/plugins). */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** What it imports links from (“YouTube”). */
  importers: string[];
  /** How it marks up sentences (标注), e.g. “日语注音”. */
  annotators: string[];
  /** Its own options, drawn in 设置 → 插件, with the value in use. */
  settings: PluginSetting[];
  permissions: { network: string[]; runs: string };
  /** Disk used, with the tools it downloaded. */
  bytes: number;
  /** Why it can't be used, when it can't. */
  problem: string | null;
}

/** One of a plugin's own options; types this app doesn't know aren't listed. */
export interface PluginSetting {
  key: string;
  kind: "select" | "toggle" | "text";
  label: string;
  /** For "select". */
  options: { value: string; label: string }[];
  value: string | boolean;
}

/** A piece of a sentence and how a plugin marks it (标注); the pieces join into the sentence. */
export interface AnnotationPiece {
  text: string;
  /** Shown over the piece (a reading). */
  ruby?: string;
  /** Shown on hover. */
  note?: string;
  mark?: "underline" | "bold";
}

/** One sentence's marks from the plugins: the pieces (from the first that marks it) and lines shown under it. */
export interface Annotation {
  pieces?: AnnotationPiece[];
  below?: string[];
}

/** A plugin folder picked in 从文件夹安装…, shown before 安装. */
export interface PluginOffer {
  name: string;
  version: string;
  author: string;
  description: string;
  permissions: { network: string[]; runs: string };
  /** The installed version it replaces. */
  replacing: string | null;
}

/** What a link is, told by the plugin before downloading. */
export interface Resolved {
  title: string;
  duration: number | null;
  uploader: string | null;
  /** Language spoken, when the site says. */
  language: string | null;
  /** Subtitles people wrote (not automatic captions). */
  subtitles: { lang: string; name: string }[];
  /** The plugin's name, and what it imports from (“YouTube”). */
  plugin: string;
  via: string;
  /** With the picture too: the heights it comes in (low to high) and about how big each download is, sound included. */
  videos?: { height: number; size: number | null }[];
  /** About how big the sound alone is. */
  audioSize?: number | null;
}

/** `import:status` events while resolving or downloading a link, and how it ended. */
export type ImportStatus =
  | { state: "resolving"; message: string; done: number; total: number }
  | { state: "downloading"; title: string; message: string; done: number; total: number }
  | { state: "done"; title: string; path: string; subtitles: boolean }
  | { state: "failed"; title: string; message: string }
  | { state: "cancelled"; title: string };

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export const api = {
  getSnapshot: () => invoke<Snapshot>("get_snapshot"),
  chooseFolder: () => invoke<FolderListing | null>("choose_folder"),
  rescanFolder: () => invoke<FolderListing | null>("rescan_folder"),
  saveProgress: (path: string, position: number, duration: number) =>
    invoke<void>("save_progress", { path, position, duration }),
  setLastTrack: (path: string | null) => invoke<void>("set_last_track", { path }),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  /** Saves the interface language and returns the one now in use. */
  setUiLanguage: (language: LangSetting) => invoke<Lang>("set_ui_language", { language }),
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
  /** Split, merged or renamed sections, saved in the app; returns the transcript as saved. */
  setSections: (path: string, sections: Section[]) => invoke<Transcript>("transcript_sections", { path, sections }),
  /** Cuts sentence `index` in two at `at` (string offset in its text), the time at a pause heard near there. */
  splitSentence: (path: string, index: number, at: number) => invoke<Transcript>("transcript_split", { path, index, at }),
  /** Joins sentence `index` with the one after it. */
  mergeSentences: (path: string, index: number) => invoke<Transcript>("transcript_merge", { path, index }),
  /** Undoes a cut or join: `sentences` back in place of the `count` at `at`, with these sections. */
  restoreSentences: (path: string, at: number, count: number, sentences: Sentence[], sections: Section[]) =>
    invoke<Transcript>("transcript_restore", { path, at, count, sentences, sections }),
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
  /** What Control Center / Windows' media flyout shows; null lets go of the media keys. Buttons arrive as `media:button`. */
  nowPlaying: (playing: NowPlaying | null) => invoke<void>("now_playing", { playing }),
  practice: {
    /** The learner did something in the window: keeps a paused session counting. */
    ping: () => invoke<void>("practice_ping"),
    /** All sessions; `since` (Unix ms) keeps those still going at or after it, `audio` those on one audio. */
    log: (filter: { since?: number; audio?: string } = {}) =>
      invoke<PracticeSession[]>("practice_log", { since: filter.since ?? null, audio: filter.audio ?? null }),
  },
  record: {
    /** Opens the microphone (asks for permission the first time); resolves with its name once it's listening. */
    begin: (meta: RecordMeta) => invoke<string>("record_begin", { meta }),
    /** The original has finished: the take may now stop by itself (`recorder:auto`). */
    turn: () => invoke<void>("record_turn"),
    /** Pauses the take or paragraph being recorded (the original waits where it is; the time paused is
     *  left out of the take), or lets it go on: then, whether the original plays on. */
    pause: (paused: boolean) => invoke<boolean>("record_pause", { paused }),
    /** Another time through (连续录): the mic stays open, the take starts afresh. Whether the time just said had your voice (kept aside if so). */
    round: () => invoke<boolean>("record_round"),
    /** Stops and keeps the take, or the paragraph's reading and its sentences (echo of the original removed).
     *  `previous`: said again and again (连续录), keep the time before this one. */
    finish: (previous = false) => invoke<Finished>("record_finish", { previous }),
    /** Reading on your own: next (+1) / previous (−1) sentence by hand. */
    step: (by: 1 | -1) => invoke<void>("record_step", { by }),
    readings: (audio: string) => invoke<Reading[]>("record_readings", { audio }),
    /** Also deletes the sentence takes cut from it. */
    removeReading: (audio: string, id: string) => invoke<void>("record_delete_reading", { audio, id }),
    playReading: (audio: string, id: string, what: ReadingWhat) => invoke<ReadingPlaying>("record_play_reading", { audio, id, what }),
    cancel: () => invoke<void>("record_cancel"),
    takes: (audio: string) => invoke<Take[]>("record_takes", { audio }),
    remove: (audio: string, id: string) => invoke<void>("record_delete", { audio, id }),
    /** Plays over the paused track; position arrives as `recorder:clip`. */
    play: (audio: string, id: string, what: TakePart) => invoke<Playing>("record_play", { audio, id, what }),
    stop: () => invoke<void>("record_stop"),
    /** Pauses a take or reading playing back where it is, or lets it go on. */
    pauseClip: (paused: boolean) => invoke<void>("record_pause_clip", { paused }),
    /** 等我说完: listens until you've said it (nothing is recorded); the answer comes as `listen:done`. */
    listen: (id: number, waitSecs: number) => invoke<void>("listen_start", { id, waitSecs }),
    stopListening: () => invoke<void>("listen_stop"),
    /** How much room recordings take (and how much is for audio that's gone). */
    space: () => invoke<RecordingSpace>("record_space"),
    /** Deletes the recordings of audio files that are gone; returns what's left. */
    clearMissing: () => invoke<RecordingSpace>("record_clear_missing"),
  },
  /** 句子本 (lib/book.ts): the whole list, read and written at once. */
  book: {
    get: () => invoke<BookEntry[]>("book_get"),
    save: (entries: BookEntry[]) => invoke<void>("book_save", { entries }),
  },
  update: {
    /** null when this is the newest version. */
    check: () => invoke<AvailableUpdate | null>("update_check"),
    /** Installs what the last check found, then the app relaunches; progress arrives as `update:progress`. */
    install: () => invoke<void>("update_install"),
  },
  plugins: {
    list: () => invoke<PluginInfo[]>("plugins_list"),
    /** The native folder picker; what the plugin is, or null when cancelled. Nothing is installed yet. */
    pick: () => invoke<PluginOffer | null>("plugins_pick"),
    /** Installs the folder `pick` offered. */
    install: () => invoke<PluginInfo[]>("plugins_install"),
    remove: (id: string) => invoke<PluginInfo[]>("plugins_remove", { id }),
    setSetting: (id: string, key: string, value: string | boolean) => invoke<PluginInfo[]>("plugins_set_setting", { id, key, value }),
    /** What the annotating plugins mark on each sentence (empty when none does). */
    annotate: (texts: string[]) => invoke<Annotation[]>("plugins_annotate", { texts }),
  },
  imports: {
    /** The clipboard, when it holds one web link. */
    clipboard: () => invoke<string | null>("import_clipboard"),
    resolve: (url: string) => invoke<Resolved>("import_resolve", { url }),
    /** `folder`: subfolder of the open folder ("" = the folder itself). Ends with an `import:status`. */
    /** `video`: bring the picture too, at most this tall (null: only the sound). */
    start: (url: string, title: string, subtitles: string | null, folder: string, video: number | null) =>
      invoke<void>("import_start", { url, title, subtitles, folder, video }),
    /** Stops reading the link in the sheet, or the running download. */
    cancel: (what: "resolve" | "download") => invoke<void>("import_cancel", { what }),
  },
  smokeMode: () => invoke<boolean>("smoke_mode"),
  smokeWindow: (minimized: boolean) => invoke<void>("smoke_window", { minimized }),
  smokeFinish: (code: number) => invoke<void>("smoke_finish", { code }),
};

/** Mirrors a diagnostic line to the terminal (printed by debug builds only). */
export function devLog(line: string) {
  if (isTauri()) void invoke("log_line", { line });
}
