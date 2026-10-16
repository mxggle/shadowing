//! Putting a pack on disk and taking it off again. Files arrive in a hidden
//! `.downloading/<id>/` folder (resumable, each checked against its SHA-256);
//! once all are there the folder moves into place, the subtitles and
//! explanations are saved the way the app keeps its own (`transcripts/`,
//! `explanations/`), and a `.pack.json` written last marks the pack installed.

use super::format::{self, Listing, Pack};
use crate::explain::saved::{self, Saved};
use crate::local::download::{self, Spec};
use crate::transcript::{self, Source, Transcript};
use crate::{sections, store};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

const MARKER: &str = ".pack.json";
const STAGING: &str = ".downloading";
const HOST: &str = "素材库";
/// Who wrote the explanations, as the note under a sentence says.
pub const SOURCE: &str = "Shadowing 素材库";

/// Where things go: the packs folder and the app's own stores.
pub struct Dirs {
    pub root: PathBuf,
    pub transcripts: PathBuf,
    pub explanations: PathBuf,
}

/// What `.pack.json` remembers about an installed pack.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub id: String,
    pub version: u32,
    pub title: String,
    pub folder: String,
    /// File names of its audio, in order.
    pub files: Vec<String>,
    /// The listing it came from, so it can still be shown offline.
    pub listing: Listing,
}

/// Packs on disk, by folder name order.
pub fn installed(root: &Path) -> Vec<Installed> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found: Vec<Installed> = entries
        .filter_map(Result::ok)
        .filter_map(|e| fs::read_to_string(e.path().join(MARKER)).ok())
        .filter_map(|text| serde_json::from_str::<Installed>(&text).ok())
        .filter(|p| format::safe_name(&p.folder))
        .collect();
    found.sort_by(|a, b| crate::library::natural_cmp(&a.folder, &b.folder));
    found
}

pub fn find(root: &Path, id: &str) -> Option<Installed> {
    installed(root).into_iter().find(|p| p.id == id)
}

/// Downloads and installs `listing` (replacing an older copy). `progress(done, total)` in bytes.
pub async fn install(
    dirs: &Dirs,
    manifest_url: &str,
    listing: &Listing,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<Installed, String> {
    let staging = dirs.root.join(STAGING).join(&listing.id);
    let pack_url = format::resolve(manifest_url, &listing.url)?;
    let pack_file = staging.join("pack.json");
    let total = listing.size.max(listing.bytes);
    download::download(
        &Spec {
            url: &pack_url,
            dest: &pack_file,
            size: listing.bytes,
            sha256: &listing.sha256,
            host: HOST,
        },
        cancel,
        |done, _| progress(done, total),
    )
    .await?;
    let text = fs::read_to_string(&pack_file).map_err(|e| e.to_string())?;
    let pack = format::parse_pack(&text, listing)?;

    fs::remove_file(&pack_file).map_err(|e| e.to_string())?;
    // Left from an earlier version's download: not part of this pack.
    let wanted: Vec<String> = pack.tracks.iter().map(|t| t.file_name()).collect();
    for entry in fs::read_dir(&staging).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let base = name.strip_suffix(".part").unwrap_or(&name);
        if !wanted.iter().any(|w| w == base) {
            let _ = fs::remove_file(entry.path());
        }
    }

    let mut before = listing.bytes;
    for track in &pack.tracks {
        let dest = staging.join(track.file_name());
        // Already fetched by a download that was stopped later on.
        if !verified(&dest, track.size, &track.sha256) {
            let url = format::resolve(&pack_url, &track.file)?;
            let spec = Spec {
                url: &url,
                dest: &dest,
                size: track.size,
                sha256: &track.sha256,
                host: HOST,
            };
            download::download(&spec, cancel, |done, _| {
                progress(before + done, total.max(before + track.size))
            })
            .await?;
        }
        before += track.size;
        progress(before, total.max(before));
    }
    put_in_place(dirs, listing, &pack, &staging)
}

fn verified(path: &Path, size: u64, sha256: &str) -> bool {
    use sha2::{Digest, Sha256};
    fs::metadata(path).is_ok_and(|m| m.len() == size)
        && fs::read(path).is_ok_and(|bytes| format!("{:x}", Sha256::digest(&bytes)) == sha256)
}

/// The staged files become the pack's folder, with its subtitles and explanations.
fn put_in_place(
    dirs: &Dirs,
    listing: &Listing,
    pack: &Pack,
    staging: &Path,
) -> Result<Installed, String> {
    let dest = dirs.root.join(&pack.folder);
    if let Some(old) = find(&dirs.root, &pack.id) {
        remove(dirs, &old)?;
    }
    // Anything else under that name is the app's own leftover (an install cut short).
    if dest.exists() {
        forget_tracks(dirs, &dest);
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    fs::rename(staging, &dest).map_err(|e| format!("无法保存素材包：{e}"))?;
    for track in &pack.tracks {
        let audio = dest
            .join(track.file_name())
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let key = audio.to_string_lossy().into_owned();
        let mut transcript = Transcript::new(
            Source::Imported,
            format!("{HOST} · {}", pack.title),
            track.sentences.clone(),
        );
        transcript.sections = sections::whole();
        transcript.speakers = track.speakers.clone();
        transcript::save(&dirs.transcripts, &key, &transcript).map_err(|e| e.to_string())?;
        let answers = track
            .explanations
            .iter()
            .map(|n| Saved {
                index: n.index,
                text: track.sentences[n.index].text.clone(),
                explanation: crate::explain::Explanation {
                    source: SOURCE.into(),
                    ..n.explanation.clone()
                },
            })
            .collect();
        saved::save_all(&dirs.explanations, &key, answers).map_err(|e| e.to_string())?;
    }
    let installed = Installed {
        id: pack.id.clone(),
        version: pack.version,
        title: pack.title.clone(),
        folder: pack.folder.clone(),
        files: pack.tracks.iter().map(|t| t.file_name()).collect(),
        listing: listing.clone(),
    };
    let json = serde_json::to_vec_pretty(&installed).map_err(|e| e.to_string())?;
    store::write_atomic(&dest.join(MARKER), &json).map_err(|e| e.to_string())?;
    Ok(installed)
}

/// Deletes a pack's folder and what the app kept for its audio (recordings stay
/// until 设置 › 录音 clears those of audio that's gone).
pub fn remove(dirs: &Dirs, pack: &Installed) -> Result<(), String> {
    let dir = dirs.root.join(&pack.folder);
    forget_tracks(dirs, &dir);
    match fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("无法删除素材包：{e}")),
        _ => Ok(()),
    }
}

fn forget_tracks(dirs: &Dirs, dir: &Path) {
    let Ok(listing) = crate::library::scan(dir) else {
        return;
    };
    for track in listing.tracks {
        let _ = transcript::remove(&dirs.transcripts, &track.path);
        let _ = saved::remove(&dirs.explanations, &track.path);
    }
}

#[cfg(test)]
#[path = "install_tests.rs"]
mod tests;
