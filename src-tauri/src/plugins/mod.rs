//! Plugins (docs/plugin-plan.md): folders in app data, each with a
//! `manifest.json` and a program the app runs as a child process (rpc.rs).
//! The one extension point so far is 从链接导入 (import.rs, accept.rs).
//! A plugin's own lasting files go in its `data/` folder, kept across updates.
//! Installing: the native folder picker, then 安装 in settings (plugins_pick, plugins_install).

pub mod accept;
mod clipboard;
pub mod import;
pub mod install;
mod job;
pub mod manifest;
mod names;
mod os;
pub mod rpc;

use crate::AppState;
use manifest::{Importer, Manifest, Permissions};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
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
pub(super) fn scan(root: &Path) -> Vec<(String, PathBuf, Result<Manifest, String>)> {
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
                    let id = &m.id;
                    Err(tr!(
                        "文件夹名和插件 id “{id}” 不一样",
                        "The folder name doesn't match the plugin ID “{id}”"
                    ))
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

pub(super) fn list(state: &AppState) -> Vec<PluginInfo> {
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

/// Deletes a plugin with everything it downloaded (asked in the settings row first).
#[tauri::command(async)]
pub fn plugins_remove(state: State<AppState>, id: String) -> Result<Vec<PluginInfo>, String> {
    let dir = scan(&root(&state))
        .into_iter()
        .find(|(name, _, _)| *name == id)
        .map(|(_, dir, _)| dir)
        .ok_or(crate::i18n::pick(
            "这个插件已经不在了",
            "This plugin is no longer installed",
        ))?;
    fs::remove_dir_all(dir)
        .map_err(|e| tr!("无法删除插件：{e}", "Couldn't delete the plugin: {e}"))?;
    Ok(list(&state))
}

#[cfg(test)]
mod real_tests;
