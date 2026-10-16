//! 素材库: ready-made practice packs (audio, subtitles with speakers, an
//! explanation for every sentence) listed on the website and downloaded into a
//! folder the app manages, so a beginner can practise without choosing a
//! folder, downloading a model or setting up AI. No account is needed.

pub mod format;
mod install;

use crate::library::{self, FolderListing};
use crate::local::models::free_bytes;
use crate::AppState;
use format::Listing;
use install::{Dirs, Installed};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

pub const MANIFEST_URL: &str = "https://shadowing.nihongo.day/packs/manifest.json";
/// The packs folder inside app data; also its name in the library.
const DIR: &str = "素材库";
/// Room left free after a download.
const DISK_MARGIN: u64 = 50_000_000;

/// Debug builds can list packs from elsewhere (a local copy of `site/`).
fn manifest_url() -> String {
    std::env::var("SHADOWING_PACKS_URL")
        .ok()
        .filter(|_| cfg!(debug_assertions))
        .unwrap_or_else(|| MANIFEST_URL.into())
}

/// The packs folder, created on first use (canonical, like an approved folder).
pub fn root(state: &AppState) -> Result<PathBuf, String> {
    let dir = state.data_dir().join(DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建素材库文件夹：{e}"))?;
    dir.canonicalize().map_err(|e| e.to_string())
}

/// The packs folder if anything has been downloaded (for checking paths; creates nothing).
pub fn existing_root(state: &AppState) -> Option<PathBuf> {
    state.data_dir().join(DIR).canonicalize().ok()
}

fn dirs(state: &AppState) -> Result<Dirs, String> {
    Ok(Dirs {
        root: root(state)?,
        transcripts: state.data_dir().join("transcripts"),
        explanations: state.data_dir().join("explanations"),
    })
}

#[derive(Default)]
pub struct Downloads(Mutex<Option<(String, Arc<AtomicBool>)>>);

#[derive(Clone, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PackStatus {
    Running { id: String, done: u64, total: u64 },
    Done { id: String },
    Failed { id: String, message: String },
    Cancelled { id: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    #[serde(flatten)]
    listing: Listing,
    /// Version on this Mac, if downloaded.
    installed: Option<u32>,
    /// Its folder in the library, if downloaded.
    folder: Option<String>,
    /// Offered by the server now (false: only the copy on this Mac is known).
    available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    packs: Vec<PackInfo>,
    /// Why the list on the server couldn't be read (downloaded packs still show).
    error: Option<String>,
    downloading: Option<String>,
    /// The packs folder, so the app knows when it's the open one.
    root: String,
}

async fn fetch_manifest(url: &str) -> Result<Vec<Listing>, String> {
    let offline = "连不上素材库，请检查网络后再试".to_string();
    let res = crate::ai::http::client()
        .get(url)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| offline.clone())?;
    if !res.status().is_success() {
        return Err(format!(
            "素材库暂时打不开（{}），请稍后再试",
            res.status().as_u16()
        ));
    }
    let text = res.text().await.map_err(|_| offline)?;
    format::parse_manifest(&text)
}

/// The server's list merged with what's on this Mac (offline: just the latter).
fn merge(
    online: Result<Vec<Listing>, String>,
    on_disk: Vec<Installed>,
) -> (Vec<PackInfo>, Option<String>) {
    let on_mac = |id: &str| on_disk.iter().find(|p| p.id == id);
    let (listings, error) = match online {
        Ok(l) => (l, None),
        Err(e) => (Vec::new(), Some(e)),
    };
    let mut packs: Vec<PackInfo> = listings
        .into_iter()
        .map(|listing| PackInfo {
            installed: on_mac(&listing.id).map(|p| p.version),
            folder: on_mac(&listing.id).map(|p| p.folder.clone()),
            listing,
            available: true,
        })
        .collect();
    for pack in &on_disk {
        if !packs.iter().any(|p| p.listing.id == pack.id) {
            packs.push(PackInfo {
                listing: pack.listing.clone(),
                installed: Some(pack.version),
                folder: Some(pack.folder.clone()),
                available: false,
            });
        }
    }
    (packs, error)
}

#[tauri::command]
pub async fn packs_catalog(
    state: State<'_, AppState>,
    downloads: State<'_, Downloads>,
) -> Result<Catalog, String> {
    let root = root(&state)?;
    let (packs, error) = merge(
        fetch_manifest(&manifest_url()).await,
        install::installed(&root),
    );
    Ok(Catalog {
        packs,
        error,
        downloading: downloads.0.lock().unwrap().as_ref().map(|d| d.0.clone()),
        root: root.to_string_lossy().into_owned(),
    })
}

/// Starts downloading a pack in the background; progress arrives as `packs:download`.
#[tauri::command]
pub async fn packs_download(
    app: AppHandle,
    state: State<'_, AppState>,
    downloads: State<'_, Downloads>,
    id: String,
) -> Result<(), String> {
    let url = manifest_url();
    let listing = fetch_manifest(&url)
        .await?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or("素材库里没有这个素材包了")?;
    let dirs = dirs(&state)?;
    if free_bytes(&dirs.root).is_some_and(|free| free < listing.size + DISK_MARGIN) {
        return Err("磁盘空间不够，请先清理一些空间".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut current = downloads.0.lock().unwrap();
        if current.is_some() {
            return Err("已经有一个素材包在下载".into());
        }
        *current = Some((id.clone(), cancel.clone()));
    }
    let spawned = std::thread::Builder::new()
        .name("pack-download".into())
        .spawn(move || {
            let emit = |s: PackStatus| drop(app.emit("packs:download", s));
            let mut last = Instant::now() - Duration::from_secs(1);
            let result = tauri::async_runtime::block_on(install::install(
                &dirs,
                &url,
                &listing,
                &cancel,
                |done, total| {
                    if last.elapsed() >= Duration::from_millis(200) || done == total {
                        last = Instant::now();
                        emit(PackStatus::Running {
                            id: id.clone(),
                            done,
                            total,
                        });
                    }
                },
            ));
            app.state::<Downloads>().0.lock().unwrap().take();
            emit(match result {
                Ok(_) => PackStatus::Done { id },
                Err(m) if m == crate::local::download::CANCELLED => PackStatus::Cancelled { id },
                Err(message) => PackStatus::Failed { id, message },
            });
        });
    if let Err(e) = spawned {
        downloads.0.lock().unwrap().take();
        return Err(e.to_string());
    }
    Ok(())
}

/// Stops the download; what has arrived is kept for next time.
#[tauri::command]
pub fn packs_cancel(downloads: State<Downloads>) {
    if let Some((_, cancel)) = downloads.0.lock().unwrap().as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
}

/// Deletes a pack; returns the open folder as it is now. When that was the
/// packs folder and nothing is left in it, no folder is open any more.
#[tauri::command]
pub fn packs_remove(
    state: State<AppState>,
    downloads: State<Downloads>,
    id: String,
) -> Result<Option<FolderListing>, String> {
    if downloads
        .0
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|d| d.0 == id)
    {
        return Err("请先取消下载".into());
    }
    let dirs = dirs(&state)?;
    if let Some(pack) = install::find(&dirs.root, &id) {
        install::remove(&dirs, &pack)?;
    }
    let Some(open) = state.root() else {
        return Ok(None);
    };
    let listing = library::scan(&open).map_err(|e| e.to_string())?;
    if open == dirs.root && listing.tracks.is_empty() {
        state.update(|d| {
            d.folder = None;
            d.last_track = None;
        })?;
        return Ok(None);
    }
    Ok(Some(listing))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    folder: FolderListing,
    /// The pack's first track.
    first: Option<String>,
}

/// Makes the packs folder the open one (the app manages it, so no dialog is needed).
#[tauri::command]
pub fn packs_open(state: State<AppState>, id: String) -> Result<Opened, String> {
    let root = root(&state)?;
    let pack = install::find(&root, &id).ok_or("这个素材包还没有下载")?;
    let folder = library::scan(&root).map_err(|e| e.to_string())?;
    state.update(|d| {
        d.folder = Some(root.clone());
        d.last_track = None;
    })?;
    let first = folder
        .tracks
        .iter()
        .find(|t| t.rel_dir == pack.folder)
        .map(|t| t.path.clone());
    Ok(Opened { folder, first })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listing(id: &str, version: u32) -> Listing {
        Listing {
            id: id.into(),
            version,
            title: id.into(),
            description: String::new(),
            language: "ja".into(),
            level: String::new(),
            voice: "ai".into(),
            tracks: 1,
            duration: 1.0,
            size: 1,
            url: String::new(),
            sha256: String::new(),
            bytes: 1,
        }
    }

    fn on_disk(id: &str, version: u32) -> Installed {
        Installed {
            id: id.into(),
            version,
            title: id.into(),
            folder: id.into(),
            files: Vec::new(),
            listing: listing(id, version),
        }
    }

    #[test]
    fn the_catalog_shows_what_is_on_this_mac_even_offline() {
        let (packs, error) = merge(
            Ok(vec![listing("a", 2), listing("b", 1)]),
            vec![on_disk("a", 1), on_disk("old", 1)],
        );
        let rows: Vec<_> = packs
            .iter()
            .map(|p| {
                (
                    p.listing.id.as_str(),
                    p.listing.version,
                    p.installed,
                    p.available,
                )
            })
            .collect();
        assert_eq!(
            rows,
            [
                ("a", 2, Some(1), true),
                ("b", 1, None, true),
                ("old", 1, Some(1), false)
            ]
        );
        assert!(error.is_none());

        let (packs, error) = merge(Err("连不上".into()), vec![on_disk("a", 1)]);
        assert_eq!((packs.len(), packs[0].available), (1, false));
        assert_eq!(error.as_deref(), Some("连不上"));
    }
}
