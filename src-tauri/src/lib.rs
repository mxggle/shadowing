mod ai;
mod audio;
mod explain;
mod guide;
mod library;
mod local;
mod practice;
mod proofread;
mod record;
mod reshape;
mod sections;
mod smoke;
mod speakers;
mod store;
mod subtitles;
mod transcribe;
mod transcript;
mod update;

use library::FolderListing;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use store::{Persisted, Progress, Saver, Settings};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    state_path: PathBuf,
    data: Mutex<Persisted>,
    /// Bumped (under the `data` lock) by every change, so the saver can tell snapshots apart.
    version: AtomicU64,
    saver: Saver,
    /// Bundled sample clips (read-only), playable without choosing a folder.
    pub samples: Option<PathBuf>,
}

impl AppState {
    pub fn new(state_path: PathBuf, data: Persisted, samples: Option<PathBuf>) -> Self {
        Self {
            saver: Saver::new(state_path.clone()),
            state_path,
            data: Mutex::new(data),
            version: AtomicU64::new(0),
            samples,
        }
    }

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

    /// Changes the state and writes it to disk before returning (errors reach the caller).
    /// The write happens outside the state lock, so other commands aren't held up by the disk.
    pub fn update(&self, f: impl FnOnce(&mut Persisted)) -> Result<(), String> {
        let (version, snapshot) = self.change(f);
        self.saver
            .now(version, &snapshot)
            .map_err(|e| e.to_string())
    }

    /// For frequent small changes (playback progress): the state changes now, the
    /// file is written shortly after on a background thread.
    pub fn update_soon(&self, f: impl FnOnce(&mut Persisted)) {
        let (version, snapshot) = self.change(f);
        self.saver.later(version, snapshot);
    }

    /// Writes anything `update_soon` hasn't yet (on quit).
    pub fn flush(&self) {
        let (version, snapshot) = {
            let data = self.data.lock().unwrap();
            (self.version.load(Ordering::SeqCst), data.clone())
        };
        if let Err(e) = self.saver.now(version, &snapshot) {
            eprintln!("state.json not saved: {e}");
        }
    }

    fn change(&self, f: impl FnOnce(&mut Persisted)) -> (u64, Persisted) {
        let mut data = self.data.lock().unwrap();
        f(&mut data);
        (
            self.version.fetch_add(1, Ordering::SeqCst) + 1,
            data.clone(),
        )
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

// `async`: scanning a large or network folder must not freeze the window.
#[tauri::command(async)]
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

#[tauri::command(async)]
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
    // Saved every couple of seconds while playing: never wait for the disk here.
    state.update_soon(|d| {
        d.progress.insert(
            path,
            Progress {
                position: position.max(0.0),
                duration: duration.max(0.0),
                updated_at: now_secs(),
            },
        );
    });
    Ok(())
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .menu(update::menu)
        .on_menu_event(|app, event| update::on_menu(app, event.id().as_ref()))
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
                    // Debug builds may use another folder, e.g. to see the first-run onboarding.
                    let dir = std::env::var_os("SHADOWING_DATA_DIR")
                        .filter(|_| cfg!(debug_assertions))
                        .map(PathBuf::from);
                    let path = match dir {
                        Some(dir) => dir.join("state.json"),
                        None => app.path().app_data_dir()?.join("state.json"),
                    };
                    let data = Persisted::load(&path);
                    (path, data)
                }
            };
            app.manage(AppState::new(
                state_path,
                data,
                guide::samples_dir(app.handle()),
            ));
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
            app.manage(update::Pending::default());
            let practice = std::sync::Arc::new(practice::Practice::open(
                &app.state::<AppState>().data_dir(),
            ));
            app.manage(practice.clone());
            let sink = std::sync::Arc::new(practice::Watch {
                inner: audio::TauriSink(app.handle().clone()),
                practice,
            });
            app.manage(audio::Player::new(sink));
            app.manage(record::Recorder::default());
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
            transcript::transcript_sections,
            reshape::transcript_split,
            reshape::transcript_merge,
            reshape::transcript_restore,
            proofread::transcript_proofread,
            proofread::transcript_proofread_cancel,
            explain::sentence_explain,
            explain::sentence_explanations,
            practice::practice_ping,
            practice::practice_log,
            update::update_check,
            update::update_install,
            smoke::smoke_mode,
            smoke::smoke_window,
            smoke::smoke_finish,
            audio::commands::player_load,
            audio::commands::player_play,
            audio::commands::player_pause,
            audio::commands::player_toggle,
            audio::commands::player_seek,
            audio::commands::player_play_range,
            audio::commands::player_set_rate,
            audio::commands::player_set_loop,
            audio::commands::player_set_volume,
            audio::commands::player_unload,
            audio::commands::player_status,
            record::commands::record_begin,
            record::commands::record_turn,
            record::commands::record_round,
            record::commands::record_cancel,
            record::commands::record_finish,
            record::commands::record_step,
            record::commands::record_readings,
            record::commands::record_delete_reading,
            record::commands::record_space,
            record::commands::record_clear_missing,
            record::commands::record_play_reading,
            record::commands::record_takes,
            record::commands::record_delete,
            record::commands::record_play,
            record::commands::record_stop
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    state.flush();
                }
                if let Some(practice) = app.try_state::<std::sync::Arc<practice::Practice>>() {
                    practice.flush();
                }
            }
        });
}
