mod ai;
mod audio;
mod explain;
mod guide;
mod library;
mod local;
mod proofread;
mod smoke;
mod speakers;
mod store;
mod subtitles;
mod transcribe;
mod transcript;

use library::FolderListing;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use store::{Persisted, Progress, Settings};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    state_path: PathBuf,
    data: Mutex<Persisted>,
    /// Bundled sample clips (read-only), playable without choosing a folder.
    pub samples: Option<PathBuf>,
}

impl AppState {
    /// The single approved folder (canonical). Media requests outside it are refused.
    pub fn root(&self) -> Option<PathBuf> {
        self.data.lock().unwrap().folder.clone()
    }

    /// Canonical path if it is inside the approved folder or the bundled samples.
    pub fn allowed(&self, path: &Path) -> Option<PathBuf> {
        [self.root(), self.samples.clone()]
            .into_iter()
            .flatten()
            .find_map(|root| library::resolve_inside(&root, path))
    }

    /// An audio file the webview may use (play, transcribe, attach subtitles to).
    pub fn audio(&self, path: &str) -> Result<PathBuf, String> {
        self.allowed(Path::new(path))
            .filter(|p| library::is_audio(p))
            .ok_or_else(|| "无法访问此文件".into())
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
    guide: guide::Guide,
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
        guide: data.guide,
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
                    // Fresh every run: state.json and the transcripts saved beside it.
                    if let Some(dir) = path.parent() {
                        let _ = std::fs::remove_dir_all(dir);
                    }
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
                samples: guide::samples_dir(app.handle()),
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
            app.manage(transcribe::commands::Jobs::default());
            app.manage(local::Downloads::default());
            app.manage(proofread::Proofreading::default());
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
            guide::guide_save,
            guide::sample_track,
            ai::ai_get,
            ai::ai_choose,
            ai::ai_set_base_url,
            ai::ai_set_key,
            ai::ai_models,
            ai::check::ai_test,
            ai::check::ai_detect_local,
            ai::openrouter::ai_sign_in_openrouter,
            ai::openrouter::ai_sign_in_cancel,
            ai::chatgpt::sign_in::ai_sign_in_chatgpt,
            ai::chatgpt::ai_sign_out_chatgpt,
            ai::ai_open_key_page,
            local::local_models,
            local::local_download,
            local::local_cancel_download,
            local::local_delete,
            transcribe::commands::transcribe_start,
            transcribe::commands::transcribe_cancel,
            transcribe::commands::transcribe_running,
            transcript::transcript_get,
            transcript::transcript_import,
            transcript::transcript_remove,
            transcript::transcript_edit,
            proofread::transcript_proofread,
            proofread::transcript_proofread_cancel,
            explain::sentence_explain,
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
