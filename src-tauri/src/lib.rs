mod library;
mod media;
mod smoke;
mod store;

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

    fn update(&self, f: impl FnOnce(&mut Persisted)) -> Result<(), String> {
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
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("media", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || responder.respond(media::handle(&app, &request)));
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            choose_folder,
            rescan_folder,
            save_progress,
            set_last_track,
            save_settings,
            log_line,
            smoke::smoke_mode,
            smoke::smoke_window,
            smoke::smoke_finish
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
