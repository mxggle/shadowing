//! Folders you've opened, to switch back to one without the native dialog: the
//! ones you pinned (in the order you pinned them), then the last few you opened.
//! Only a folder picked in that dialog gets on the list, so switching to one
//! approves nothing new. Each remembers the track you were on there.

use crate::library::{self, FolderListing};
use crate::store::Persisted;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

/// Unpinned folders kept on the list (the open one counts).
pub const RECENT_MAX: usize = 6;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownFolder {
    /// Canonical, as the native dialog's choice was scanned.
    pub path: PathBuf,
    /// Pinned folders come first, in this order (the order they were pinned).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin: Option<u32>,
    /// The track open when you left the folder, opened again when you come back.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_track: Option<String>,
}

impl KnownFolder {
    fn new(path: &Path) -> Self {
        KnownFolder {
            path: path.to_path_buf(),
            pin: None,
            last_track: None,
        }
    }
}

/// What the switcher shows for a folder.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub path: String,
    pub name: String,
    /// Where it is: the folder it's in, the home folder written `~` (Mac).
    pub place: String,
    pub pinned: bool,
    /// The folder open now.
    pub current: bool,
    /// Moved, renamed, or on a drive that isn't connected.
    pub missing: bool,
    /// 0 for the folder opened last, 1 for the one before, …
    pub recency: usize,
}

/// The list is kept most recent first. `path` was just opened: it goes to the
/// front (keeping its pin and its track), and the oldest unpinned folders past
/// `RECENT_MAX` are dropped. Returns the track you were on there.
pub fn remember(list: &mut Vec<KnownFolder>, path: &Path) -> Option<String> {
    let entry = match list.iter().position(|f| f.path == path) {
        Some(i) => list.remove(i),
        None => KnownFolder::new(path),
    };
    let last = entry.last_track.clone();
    list.insert(0, entry);
    let mut unpinned = 0;
    list.retain(|f| {
        if f.pin.is_some() {
            return true;
        }
        unpinned += 1;
        unpinned <= RECENT_MAX
    });
    last
}

/// Pins a folder after the ones already pinned, or unpins it (it stays among the
/// recent ones where it was, even past `RECENT_MAX` until the next folder opens).
pub fn pin(list: &mut [KnownFolder], path: &Path, pinned: bool) {
    let next = list.iter().filter_map(|f| f.pin).max().map_or(0, |n| n + 1);
    if let Some(f) = list.iter_mut().find(|f| f.path == path) {
        f.pin = match (pinned, f.pin) {
            (true, Some(n)) => Some(n),
            (true, None) => Some(next),
            (false, _) => None,
        };
    }
}

/// Takes a folder off the list; never the one open now (it's where you are).
pub fn forget(list: &mut Vec<KnownFolder>, path: &Path, current: Option<&Path>) {
    if current != Some(path) {
        list.retain(|f| f.path != path);
    }
}

/// Notes the track open in the current folder.
pub fn left_at(list: &mut [KnownFolder], folder: Option<&Path>, track: Option<String>) {
    if let Some(f) = list.iter_mut().find(|f| Some(f.path.as_path()) == folder) {
        f.last_track = track;
    }
}

/// State saved before the list existed: the open folder (and its track) starts it.
pub fn seed(data: &mut Persisted) {
    if let Some(folder) = &data.folder {
        if !data.folders.iter().any(|f| &f.path == folder) {
            let mut entry = KnownFolder::new(folder);
            entry.last_track = data.last_track.clone();
            data.folders.insert(0, entry);
        }
    }
}

/// Pinned first (in the order pinned), then the others, most recent first.
pub fn entries(
    list: &[KnownFolder],
    current: Option<&Path>,
    exists: impl Fn(&Path) -> bool,
) -> Vec<FolderEntry> {
    let home = home();
    let mut shown: Vec<(usize, &KnownFolder)> = list.iter().enumerate().collect();
    shown.sort_by_key(|(i, f)| (f.pin.is_none(), f.pin, *i));
    shown
        .into_iter()
        .map(|(recency, f)| FolderEntry {
            path: f.path.to_string_lossy().into_owned(),
            name: f
                .path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| f.path.to_string_lossy().into_owned()),
            place: place(&f.path, home.as_deref()),
            pinned: f.pin.is_some(),
            current: current == Some(f.path.as_path()),
            missing: !exists(&f.path),
            recency,
        })
        .collect()
}

fn home() -> Option<PathBuf> {
    if cfg!(windows) {
        return None;
    }
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|h| h.is_absolute())
}

/// The folder it's in, short: `~/Documents/日语`, `iCloud 云盘/日语`, `/Volumes/U盘`.
fn place(path: &Path, home: Option<&Path>) -> String {
    let parent = path.parent().unwrap_or(path);
    let Some(rest) = home.and_then(|h| parent.strip_prefix(h).ok()) else {
        return parent.to_string_lossy().into_owned();
    };
    let icloud = Path::new("Library/Mobile Documents/com~apple~CloudDocs");
    let (start, rest) = match rest.strip_prefix(icloud) {
        Ok(inside) => (crate::i18n::pick("iCloud 云盘", "iCloud Drive"), inside),
        Err(_) => ("~", rest),
    };
    if rest.as_os_str().is_empty() {
        start.to_string()
    } else {
        format!("{start}/{}", rest.to_string_lossy())
    }
}

/// The list as the switcher shows it. Checking which folders still exist touches
/// the disk (a network drive can be slow), so it happens outside the state lock.
pub fn list(state: &AppState) -> Vec<FolderEntry> {
    let (list, current) = state.read(|d| (d.folders.clone(), d.folder.clone()));
    entries(&list, current.as_deref(), Path::is_dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub folder: FolderListing,
    /// The track you were on in this folder last time.
    pub last_track: Option<String>,
    pub folders: Vec<FolderEntry>,
}

/// The folder in `listing` is now the open one; it goes to the top of the list.
pub fn enter(state: &AppState, listing: FolderListing) -> Result<Opened, String> {
    let root = PathBuf::from(&listing.root);
    let mut last_track = None;
    state.update(|d| {
        last_track = remember(&mut d.folders, &root);
        d.folder = Some(root.clone());
        d.last_track = last_track.clone();
    })?;
    Ok(Opened {
        folder: listing,
        last_track,
        folders: list(state),
    })
}

fn missing() -> String {
    crate::i18n::pick(
        "找不到这个文件夹：可能被移动、改了名，或者它所在的硬盘没有接上",
        "Can't find this folder. It may have been moved or renamed, or its drive isn't connected.",
    )
    .into()
}

#[tauri::command(async)]
pub fn folders_list(state: State<AppState>) -> Vec<FolderEntry> {
    list(&state)
}

/// Opens a folder from the list (one picked in the native dialog before).
#[tauri::command(async)]
pub fn folder_open(state: State<AppState>, path: String) -> Result<Opened, String> {
    let path = PathBuf::from(path);
    if !state.read(|d| d.folders.iter().any(|f| f.path == path)) {
        return Err(crate::i18n::pick(
            "这个文件夹不在列表里了，请重新选择",
            "This folder is no longer on the list. Choose it again.",
        )
        .into());
    }
    let listing = library::scan(&path).map_err(|_| missing())?;
    enter(&state, listing)
}

#[tauri::command(async)]
pub fn folder_pin(
    state: State<AppState>,
    path: String,
    pinned: bool,
) -> Result<Vec<FolderEntry>, String> {
    state.update(|d| pin(&mut d.folders, Path::new(&path), pinned))?;
    Ok(list(&state))
}

#[tauri::command(async)]
pub fn folder_forget(state: State<AppState>, path: String) -> Result<Vec<FolderEntry>, String> {
    state.update(|d| {
        let current = d.folder.clone();
        forget(&mut d.folders, Path::new(&path), current.as_deref());
    })?;
    Ok(list(&state))
}

#[cfg(test)]
#[path = "folders_tests.rs"]
mod tests;
