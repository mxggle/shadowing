//! Debug-only self-test: `SHADOWING_SMOKE=<audio folder> npm run smoke`.
//! The webview runs a scripted playback scenario (src/dev/smoke.ts), prints
//! results to stdout and exits. Uses a throwaway data folder (state.json, transcripts), cleared on start.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn folder() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var_os("SHADOWING_SMOKE").and_then(|p| PathBuf::from(p).canonicalize().ok())
}

pub fn state_path() -> PathBuf {
    std::env::temp_dir()
        .join("shadowing-smoke")
        .join("state.json")
}

#[tauri::command]
pub fn smoke_mode() -> bool {
    folder().is_some()
}

#[tauri::command]
pub fn smoke_window(app: AppHandle, minimized: bool) {
    if let (Some(_), Some(w)) = (folder(), app.get_webview_window("main")) {
        let _ = if minimized {
            w.minimize()
        } else {
            w.unminimize()
        };
    }
}

#[tauri::command]
pub fn smoke_finish(app: AppHandle, code: i32) {
    if folder().is_some() {
        app.exit(code);
    }
}
