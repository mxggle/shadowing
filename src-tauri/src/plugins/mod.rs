//! Plugins (docs/plugin-plan.md): folders in app data, each with a
//! `manifest.json` and a program the app runs as a child process (rpc.rs).
//! The one extension point so far is 从链接导入 (import.rs, accept.rs).
//! A plugin's own lasting files go in its `data/` folder, kept across updates.

pub mod accept;
pub mod import;
pub mod manifest;
pub mod rpc;

use crate::AppState;
use manifest::{Importer, Manifest, Permissions};
use serde::Serialize;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use walkdir::WalkDir;

/// Where plugins are installed (app data, beside state.json).
pub fn root(state: &AppState) -> PathBuf {
    state.data_dir().join("plugins")
}

pub struct Installed {
    pub dir: PathBuf,
    pub manifest: Manifest,
}

impl Installed {
    pub fn program(&self) -> Result<PathBuf, String> {
        Ok(self.dir.join(self.manifest.program_path()?))
    }

    /// The plugin's own folder for files it keeps (downloaded tools, caches).
    pub fn data_dir(&self) -> PathBuf {
        self.dir.join("data")
    }
}

/// Every plugin folder, with its manifest or why it can't be used.
fn scan(root: &Path) -> Vec<(String, PathBuf, Result<Manifest, String>)> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            (!name.starts_with('.')).then(|| (name, e.path()))
        })
        .map(|(name, dir)| {
            let manifest = Manifest::read(&dir).and_then(|m| {
                if m.id == name {
                    Ok(m)
                } else {
                    Err(format!("文件夹名和插件 id “{}” 不一样", m.id))
                }
            });
            (name, dir, manifest)
        })
        .collect();
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found
}

pub fn installed(state: &AppState) -> Vec<Installed> {
    scan(&root(state))
        .into_iter()
        .filter_map(|(_, dir, m)| m.ok().map(|manifest| Installed { dir, manifest }))
        .collect()
}

/// The installed plugin (and its importer) that takes this link.
pub fn importer_for(state: &AppState, url: &str) -> Option<(Installed, Importer)> {
    installed(state).into_iter().find_map(|p| {
        let importer = p.manifest.importer_for(url)?.clone();
        Some((p, importer))
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    id: String,
    name: String,
    version: String,
    author: String,
    description: String,
    /// What it can import from (“YouTube”).
    importers: Vec<String>,
    permissions: Permissions,
    /// Disk used, its downloaded tools included.
    bytes: u64,
    /// Why it can't be used (broken manifest, needs a newer app…).
    problem: Option<String>,
}

fn size(dir: &Path) -> u64 {
    WalkDir::new(dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

fn list(state: &AppState) -> Vec<PluginInfo> {
    scan(&root(state))
        .into_iter()
        .map(|(id, dir, manifest)| {
            let bytes = size(&dir);
            match manifest {
                Ok(m) => PluginInfo {
                    id,
                    importers: m
                        .contributes
                        .importers
                        .iter()
                        .map(|i| i.title.clone())
                        .collect(),
                    name: m.name,
                    version: m.version,
                    author: m.author,
                    description: m.description,
                    permissions: m.permissions,
                    bytes,
                    problem: None,
                },
                Err(problem) => PluginInfo {
                    name: id.clone(),
                    id,
                    version: String::new(),
                    author: String::new(),
                    description: String::new(),
                    importers: Vec::new(),
                    permissions: Permissions::default(),
                    bytes,
                    problem: Some(problem),
                },
            }
        })
        .collect()
}

#[tauri::command(async)]
pub fn plugins_list(state: State<AppState>) -> Vec<PluginInfo> {
    list(&state)
}

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

/// 从文件夹安装…: picks a plugin folder, says what it does and asks before copying it in.
#[tauri::command]
pub async fn plugins_install(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Vec<PluginInfo>>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("选择插件文件夹（里面有 manifest.json）")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let source = picked.into_path().map_err(|e| e.to_string())?;
    let manifest = Manifest::read(&source)?;
    if !source.join(manifest.program_path()?).is_file() {
        return Err("插件文件夹里没有它的程序，可能还没有构建".into());
    }
    let root = root(&state);
    let replacing = Manifest::read(&root.join(&manifest.id)).ok();

    let mut message = format!("{} · {}", manifest.version, manifest.author);
    if !manifest.description.is_empty() {
        message.push_str(&format!("\n{}", manifest.description));
    }
    if !manifest.permissions.runs.is_empty() {
        message.push_str(&format!("\n\n它会：{}", manifest.permissions.runs));
    }
    if !manifest.permissions.network.is_empty() {
        message.push_str(&format!(
            "\n联网：{}",
            manifest.permissions.network.join("、")
        ));
    }
    if let Some(old) = &replacing {
        message.push_str(&format!("\n\n会替换已安装的 {}。", old.version));
    }
    message.push_str("\n\n插件是运行在这台 Mac 上的程序，只安装你信任的插件。");
    let confirmed = app
        .dialog()
        .message(message)
        .title(format!("安装插件「{}」？", manifest.name))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "安装".into(),
            "取消".into(),
        ))
        .blocking_show();
    if !confirmed {
        return Ok(None);
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    copy_in(&source, &root, &manifest)?;
    Ok(Some(list(&state)))
}

/// Deletes a plugin with everything it downloaded (asked in the settings row first).
#[tauri::command(async)]
pub fn plugins_remove(state: State<AppState>, id: String) -> Result<Vec<PluginInfo>, String> {
    let dir = scan(&root(&state))
        .into_iter()
        .find(|(name, _, _)| *name == id)
        .map(|(_, dir, _)| dir)
        .ok_or("这个插件已经不在了")?;
    fs::remove_dir_all(dir).map_err(|e| format!("无法删除插件：{e}"))?;
    Ok(list(&state))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin_folder(dir: &Path, version: &str) {
        fs::create_dir_all(dir.join("bin")).unwrap();
        fs::create_dir_all(dir.join("data")).unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join("bin/run"), "#!/bin/sh\n").unwrap();
        fs::write(dir.join("data/dev-cache"), "x").unwrap();
        fs::write(
            dir.join("manifest.json"),
            format!(
                r#"{{"id":"fake","name":"Fake","version":"{version}","protocol":1,"main":{{"{}":"bin/run"}}}}"#,
                manifest::platform()
            ),
        )
        .unwrap();
    }

    #[test]
    fn installing_copies_the_plugin_and_an_update_keeps_its_data() {
        let tmp = tempfile::tempdir().unwrap();
        let (source, root) = (tmp.path().join("src"), tmp.path().join("plugins"));
        plugin_folder(&source, "0.1.0");
        fs::create_dir_all(&root).unwrap();

        let m = Manifest::read(&source).unwrap();
        copy_in(&source, &root, &m).unwrap();
        let installed = root.join("fake");
        assert!(installed.join("manifest.json").is_file());
        let mode = fs::metadata(installed.join("bin/run"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o755, 0o755);
        // The source's own data and hidden folders stay behind.
        assert!(!installed.join("data").exists());
        assert!(!installed.join(".git").exists());

        // What the plugin downloaded survives an update.
        fs::create_dir_all(installed.join("data")).unwrap();
        fs::write(installed.join("data/yt-dlp"), "tool").unwrap();
        plugin_folder(&source, "0.2.0");
        let m = Manifest::read(&source).unwrap();
        copy_in(&source, &root, &m).unwrap();
        assert_eq!(Manifest::read(&installed).unwrap().version, "0.2.0");
        assert_eq!(
            fs::read_to_string(installed.join("data/yt-dlp")).unwrap(),
            "tool"
        );
        assert!(!root.join(".install-fake").exists());

        // A folder whose name isn't its id is listed as a problem, not used.
        fs::rename(&installed, root.join("other")).unwrap();
        let found = scan(&root);
        assert_eq!(found.len(), 1);
        assert!(found[0].2.as_ref().unwrap_err().contains("fake"));
    }

    #[test]
    fn installing_the_installed_folder_itself_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("plugins");
        plugin_folder(&root.join("fake"), "0.1.0");
        let m = Manifest::read(&root.join("fake")).unwrap();
        assert!(copy_in(&root.join("fake"), &root, &m).is_err());
        assert!(root.join("fake/manifest.json").is_file());
    }
}
