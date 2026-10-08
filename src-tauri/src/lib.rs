mod ai;
mod audio;
mod library;
mod smoke;
mod store;
mod subtitles;
mod transcript;

use library::FolderListing;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use store::{Persisted, Progress, Settings};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    state_path: PathBuf,
    data: Mutex<Persisted>,
}

impl AppState {
    /// The single approved folder (canonical). Media requests outside it are refused.
    pub fn root(&self) -> Option<PathBuf> {
        self.data.lock().unwrap().folder.clone()
    }

    /// Where state.json lives; transcripts and models sit beside it.
    pub fn data_dir(&self) -> PathBuf {
        self.state_path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_default()
    }

    pub fn read<T>(&self, f: impl FnOnce(&Persisted) -> T) -> T {
        f(&self.data.lock().unwrap())
    }

    pub fn update(&self, f: impl FnOnce(&mut Persisted)) -> Result<(), String> {
        let mut data = self.data.lock().unwrap();
        f(&mut data);
        data.save(&self.state_path).map_err(|e| e.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    folder: Option<FolderListing>,
    /// Remembered folder that could not be opened (moved, unmounted).
    missing_folder: Option<String>,
    last_track: Option<String>,
    settings: Settings,
    progress: HashMap<String, Progress>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
fn get_snapshot(state: State<AppState>) -> Snapshot {
    let data = state.data.lock().unwrap().clone();
    let (folder, missing_folder) = match &data.folder {
        Some(root) => match library::scan(root) {
            Ok(listing) => (Some(listing), None),
            Err(_) => (None, Some(root.to_string_lossy().into_owned())),
        },
        None => (None, None),
    };
    Snapshot {
        folder,
        missing_folder,
        last_track: data.last_track,
        settings: data.settings,
        progress: data.progress,
    }
}

/// Only a folder picked in the native dialog becomes the approved root.
#[tauri::command]
async fn choose_folder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<FolderListing>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let listing = library::scan(&path).map_err(|e| e.to_string())?;
    state.update(|d| {
        d.folder = Some(PathBuf::from(&listing.root));
        d.last_track = None;
    })?;
    Ok(Some(listing))
}

#[tauri::command]
fn rescan_folder(state: State<AppState>) -> Result<Option<FolderListing>, String> {
    match state.root() {
        Some(root) => library::scan(&root).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

#[tauri::command]
fn save_progress(
    state: State<AppState>,
    path: String,
    position: f64,
    duration: f64,
) -> Result<(), String> {
    if !position.is_finite() || !duration.is_finite() {
        return Ok(());
    }
    state.update(|d| {
        d.progress.insert(
            path,
            Progress {
                position: position.max(0.0),
                duration: duration.max(0.0),
                updated_at: now_secs(),
            },
        );
    })
}

#[tauri::command]
fn set_last_track(state: State<AppState>, path: Option<String>) -> Result<(), String> {
    state.update(|d| d.last_track = path)
}

#[tauri::command]
fn save_settings(state: State<AppState>, settings: Settings) -> Result<(), String> {
    state.update(|d| d.settings = settings)
}

/// Debug aid: lets the webview print to the terminal. Silent in release builds.
#[tauri::command]
fn log_line(line: String) {
    if cfg!(debug_assertions) {
        println!("[web] {line}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let smoke_run = smoke::folder().is_some();
            let (state_path, data) = match smoke::folder() {
                Some(folder) => {
                    let path = smoke::state_path();
                    let _ = std::fs::remove_file(&path);
                    let data = Persisted {
                        folder: Some(folder),
                        ..Default::default()
                    };
                    (path, data)
                }
                None => {
                    let path = app.path().app_data_dir()?.join("state.json");
                    let data = Persisted::load(&path);
                    (path, data)
                }
            };
            app.manage(AppState {
                state_path,
                data: Mutex::new(data),
            });
            // Smoke runs never touch the real Keychain.
            let store: Box<dyn ai::secrets::SecretStore> = match ai::secrets::Keychain::new() {
                Ok(keychain) if !smoke_run => Box::new(keychain),
                Ok(_) => Box::new(ai::secrets::Memory::default()),
                Err(e) => {
                    eprintln!("{e}; API keys will not be kept after quitting");
                    Box::new(ai::secrets::Memory::default())
                }
            };
            app.manage(ai::secrets::Secrets(store));
            let sink = std::sync::Arc::new(audio::TauriSink(app.handle().clone()));
            app.manage(audio::Player::new(sink));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            choose_folder,
            rescan_folder,
            save_progress,
            set_last_track,
            save_settings,
            log_line,
            ai::ai_get,
            ai::ai_choose,
            ai::ai_set_base_url,
            ai::ai_set_key,
            ai::ai_models,
            ai::ai_test,
            ai::ai_open_key_page,
            transcript::transcript_get,
            transcript::transcript_import,
            transcript::transcript_remove,
            smoke::smoke_mode,
            smoke::smoke_window,
            smoke::smoke_finish,
            audio::commands::player_load,
            audio::commands::player_play,
            audio::commands::player_pause,
            audio::commands::player_toggle,
            audio::commands::player_seek,
            audio::commands::player_set_rate,
            audio::commands::player_set_loop,
            audio::commands::player_set_volume,
            audio::commands::player_unload,
            audio::commands::player_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
