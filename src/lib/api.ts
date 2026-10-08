// The only module that talks to Rust. Everything else imports from here.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

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

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export const api = {
  getSnapshot: () => invoke<Snapshot>("get_snapshot"),
  chooseFolder: () => invoke<FolderListing | null>("choose_folder"),
  rescanFolder: () => invoke<FolderListing | null>("rescan_folder"),
  saveProgress: (path: string, position: number, duration: number) =>
    invoke<void>("save_progress", { path, position, duration }),
  setLastTrack: (path: string | null) => invoke<void>("set_last_track", { path }),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  smokeMode: () => invoke<boolean>("smoke_mode"),
  smokeWindow: (minimized: boolean) => invoke<void>("smoke_window", { minimized }),
  smokeFinish: (code: number) => invoke<void>("smoke_finish", { code }),
};

/** Mirrors a diagnostic line to the terminal (printed by debug builds only). */
export function devLog(line: string) {
  if (isTauri()) void invoke("log_line", { line });
}

export const mediaUrl = (path: string) => convertFileSrc(path, "media");
