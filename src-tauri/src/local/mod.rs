//! Transcription on this Mac: the Whisper models on offer, downloading them
//! (`download.rs`), and running them (`whisper.rs`). Apple Silicon only.

pub mod download;
pub mod models;
#[cfg(test)]
mod real_tests;
pub mod whisper;

use crate::AppState;
use models::{Fit, Model, MODELS};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// The provider id used in settings for "transcribe on this Mac".
pub const PROVIDER: &str = "local";

/// Room left on the disk after a download, so the Mac isn't filled to the brim.
const DISK_MARGIN: u64 = 500 * 1024 * 1024;

pub fn models_dir(state: &AppState) -> PathBuf {
    // Debug builds (smoke runs) may borrow an existing folder instead of downloading again.
    if cfg!(debug_assertions) {
        if let Some(dir) = std::env::var_os("SHADOWING_MODELS_DIR") {
            return dir.into();
        }
    }
    state.data_dir().join("models")
}

/// The model's file, if it has been downloaded completely.
pub fn model_file(state: &AppState, id: &str) -> Option<PathBuf> {
    let path = models_dir(state).join(models::find(id)?.file);
    path.is_file().then_some(path)
}

pub fn downloaded(state: &AppState) -> Vec<&'static str> {
    MODELS
        .iter()
        .filter(|m| model_file(state, m.id).is_some())
        .map(|m| m.id)
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelState {
    #[serde(flatten)]
    model: &'static Model,
    downloaded: bool,
    /// Bytes of an unfinished download, kept for resuming.
    partial: u64,
    fit: Fit,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    supported: bool,
    ram_gb: f64,
    free_bytes: Option<u64>,
    recommended: &'static str,
    models: Vec<ModelState>,
    downloading: Option<String>,
}

#[derive(Default)]
pub struct Downloads(Mutex<Option<(String, Arc<AtomicBool>)>>);

#[derive(Clone, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DownloadStatus {
    Running { id: String, done: u64, total: u64 },
    Done { id: String },
    Failed { id: String, message: String },
    Cancelled { id: String },
}

fn overview(state: &AppState, downloads: &Downloads) -> Overview {
    let dir = models_dir(state);
    let ram = models::ram_gb();
    Overview {
        supported: models::supported(),
        ram_gb: ram,
        free_bytes: models::free_bytes(&dir),
        recommended: models::recommended(ram),
        models: MODELS
            .iter()
            .map(|m| {
                let file = dir.join(m.file);
                ModelState {
                    model: m,
                    downloaded: file.is_file(),
                    partial: download::partial_len(&file),
                    fit: models::fit(m, ram),
                }
            })
            .collect(),
        downloading: downloads.0.lock().unwrap().as_ref().map(|d| d.0.clone()),
    }
}

#[tauri::command]
pub fn local_models(state: State<AppState>, downloads: State<Downloads>) -> Overview {
    overview(&state, &downloads)
}

/// Starts downloading a model in the background; progress arrives as `local:download`.
#[tauri::command]
pub fn local_download(
    app: AppHandle,
    state: State<AppState>,
    downloads: State<Downloads>,
    id: String,
) -> Result<(), String> {
    if !models::supported() {
        return Err("这台 Mac 不支持本机转写".into());
    }
    let model = models::find(&id).ok_or("未知的模型")?;
    let dest = models_dir(&state).join(model.file);
    if dest.is_file() {
        return Ok(());
    }
    // `saturating_sub`: a `.part` larger than the model (a bad server reply) is removed by
    // `download` itself; here it must not wrap around into an absurd "need".
    let need = model.size.saturating_sub(download::partial_len(&dest));
    if let Some(free) = models::free_bytes(&dest) {
        if free < need + DISK_MARGIN {
            let gb = |b: u64| b as f64 / 1e9;
            return Err(format!(
                "磁盘空间不够：还需要 {:.1} GB，目前可用 {:.1} GB",
                gb(need + DISK_MARGIN),
                gb(free)
            ));
        }
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut current = downloads.0.lock().unwrap();
        if current.is_some() {
            return Err("已经有一个模型在下载".into());
        }
        *current = Some((id.clone(), cancel.clone()));
    }
    let spawned = std::thread::Builder::new()
        .name("model-download".into())
        .spawn(move || {
            let emit = |s: DownloadStatus| drop(app.emit("local:download", s));
            let url = model.url();
            let spec = download::Spec {
                url: &url,
                dest: &dest,
                size: model.size,
                sha256: model.sha256,
            };
            let mut last = Instant::now() - Duration::from_secs(1);
            let result = tauri::async_runtime::block_on(download::download(
                &spec,
                &cancel,
                |done, total| {
                    if last.elapsed() >= Duration::from_millis(250) || done == total {
                        last = Instant::now();
                        emit(DownloadStatus::Running {
                            id: id.clone(),
                            done,
                            total,
                        });
                    }
                },
            ));
            app.state::<Downloads>().0.lock().unwrap().take();
            emit(match result {
                Ok(()) => DownloadStatus::Done { id },
                Err(m) if m == download::CANCELLED => DownloadStatus::Cancelled { id },
                Err(message) => DownloadStatus::Failed { id, message },
            });
        });
    if let Err(e) = spawned {
        downloads.0.lock().unwrap().take();
        return Err(e.to_string());
    }
    Ok(())
}

/// Stops the current download; what has arrived is kept for resuming.
#[tauri::command]
pub fn local_cancel_download(downloads: State<Downloads>) {
    if let Some((_, cancel)) = downloads.0.lock().unwrap().as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
}

/// Deletes a model (and any unfinished download of it).
#[tauri::command]
pub fn local_delete(
    state: State<AppState>,
    downloads: State<Downloads>,
    id: String,
) -> Result<Overview, String> {
    let model = models::find(&id).ok_or("未知的模型")?;
    if downloads
        .0
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|d| d.0 == id)
    {
        return Err("请先取消下载".into());
    }
    let file = models_dir(&state).join(model.file);
    for path in [download::part_path(&file), file] {
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(overview(&state, &downloads))
}
