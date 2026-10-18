//! 从文件夹安装…: the native folder picker, then 安装 in settings. The copy keeps
//! the `data/` of the version it replaces.

use super::manifest::{Manifest, Permissions};
use super::{list, root, PluginInfo};
use crate::AppState;
use serde::Serialize;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

/// Copies a plugin folder into app data, keeping the `data/` of the version it replaces.
/// The source's own `data/` and hidden files (`.git`) are left behind.
pub fn copy_in(source: &Path, root: &Path, manifest: &Manifest) -> Result<(), String> {
    let target = root.join(&manifest.id);
    if source.canonicalize().ok() == target.canonicalize().ok() {
        return Err("这个文件夹就是已安装的插件".into());
    }
    let staging = root.join(format!(".install-{}", manifest.id));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let walk = WalkDir::new(source).min_depth(1).follow_links(false);
    let skip = |e: &walkdir::DirEntry| {
        let name = e.file_name().to_string_lossy();
        name.starts_with('.') || (e.depth() == 1 && name == "data")
    };
    for entry in walk.into_iter().filter_entry(|e| !skip(e)) {
        let entry = entry.map_err(|e| e.to_string())?;
        let rel = entry
            .path()
            .strip_prefix(source)
            .map_err(|e| e.to_string())?;
        let to = staging.join(rel);
        let kind = entry.file_type();
        if kind.is_dir() {
            fs::create_dir_all(&to).map_err(|e| e.to_string())?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &to).map_err(|e| format!("复制插件文件失败：{e}"))?;
            clear_quarantine(&to);
        }
    }
    let program = staging.join(manifest.program_path()?);
    let mut mode = fs::metadata(&program)
        .map_err(|_| "插件文件夹里没有它的程序".to_string())?
        .permissions();
    mode.set_mode(mode.mode() | 0o755);
    fs::set_permissions(&program, mode).map_err(|e| e.to_string())?;

    if target.exists() {
        let data = target.join("data");
        if data.is_dir() {
            fs::rename(&data, staging.join("data")).map_err(|e| e.to_string())?;
        }
        fs::remove_dir_all(&target).map_err(|e| format!("无法替换旧版本：{e}"))?;
    }
    fs::rename(&staging, &target).map_err(|e| e.to_string())
}

/// Installing is the learner's go-ahead. A plugin downloaded as a zip in a browser
/// carries macOS's quarantine mark onto every file it unpacks (and a copy keeps
/// it), and macOS kills a quarantined program the moment the app starts it.
fn clear_quarantine(path: &Path) {
    use std::os::unix::ffi::OsStrExt;
    let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return;
    };
    // SAFETY: both are NUL-terminated C strings that live through the call.
    unsafe {
        libc::removexattr(
            path.as_ptr(),
            c"com.apple.quarantine".as_ptr(),
            libc::XATTR_NOFOLLOW,
        );
    }
}

/// The folder picked, or the one plugin folder inside it: picking the folder a plugin
/// sits in (its `dist/`, a download folder) is easy to do and means the same thing.
pub fn plugin_folder(picked: PathBuf) -> PathBuf {
    if picked.join("manifest.json").is_file() {
        return picked;
    }
    let inside: Vec<PathBuf> = fs::read_dir(&picked)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.join("manifest.json").is_file())
                .collect()
        })
        .unwrap_or_default();
    match <[PathBuf; 1]>::try_from(inside) {
        Ok([one]) => one,
        Err(_) => picked,
    }
}

/// The folder picked in 从文件夹安装…, waiting for 安装 in settings. Only a folder
/// chosen in the native picker gets here, so the page can't name another one.
#[derive(Default)]
pub struct Picked(Mutex<Option<PathBuf>>);

/// What settings shows before 安装: what the plugin is and says it does.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    name: String,
    version: String,
    author: String,
    description: String,
    permissions: Permissions,
    /// The version it replaces, when one is installed.
    replacing: Option<String>,
}

/// Reads a plugin folder that is about to be installed.
fn installable(source: &Path) -> Result<Manifest, String> {
    let manifest = Manifest::read(source)?;
    if !source.join(manifest.program_path()?).is_file() {
        return Err("插件文件夹里没有它的程序，可能还没有构建".into());
    }
    Ok(manifest)
}

/// 从文件夹安装…: the native picker, then what the plugin is (null when cancelled).
/// Nothing is copied until `plugins_install`. (Not a native confirmation: an alert
/// shown as the picker closes sometimes answered itself.)
#[tauri::command]
pub async fn plugins_pick(
    app: AppHandle,
    state: State<'_, AppState>,
    picked: State<'_, Picked>,
) -> Result<Option<Offer>, String> {
    let Some(folder) = app
        .dialog()
        .file()
        .set_title("选择插件文件夹（里面有 manifest.json）")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let source = plugin_folder(folder.into_path().map_err(|e| e.to_string())?);
    let manifest = installable(&source)?;
    let replacing = Manifest::read(&root(&state).join(&manifest.id))
        .ok()
        .map(|m| m.version);
    *picked.0.lock().unwrap() = Some(source);
    Ok(Some(Offer {
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        description: manifest.description,
        permissions: manifest.permissions,
        replacing,
    }))
}

/// 安装 in settings: copies in the folder `plugins_pick` offered.
#[tauri::command(async)]
pub fn plugins_install(
    state: State<AppState>,
    picked: State<Picked>,
) -> Result<Vec<PluginInfo>, String> {
    let source = picked
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("请重新选择插件文件夹")?;
    let manifest = installable(&source)?;
    let root = root(&state);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    copy_in(&source, &root, &manifest)?;
    Ok(list(&state))
}

#[cfg(test)]
#[path = "install_tests.rs"]
mod tests;
