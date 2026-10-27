//! `manifest.json`: who a plugin is, which program to run, and which links it
//! can import. Checked when installing and every time plugins are listed.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

/// The only protocol version this app speaks (see docs/plugin-plan.md).
pub const PROTOCOL: u32 = 1;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub protocol: u32,
    #[serde(default)]
    pub min_app_version: Option<String>,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    /// Platform ("darwin-arm64", "windows-x86_64") → program inside the plugin folder.
    pub main: HashMap<String, String>,
    #[serde(default)]
    pub contributes: Contributes,
    #[serde(default)]
    pub permissions: Permissions,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Contributes {
    #[serde(default)]
    pub importers: Vec<Importer>,
    #[serde(default)]
    pub annotators: Vec<Annotator>,
    #[serde(default)]
    pub settings: Vec<super::options::Setting>,
}

/// 标注: the plugin marks up the sentences of any transcript (readings over
/// words, a line under the sentence…; annotate.rs). It says itself which
/// sentences it has something for.
#[derive(Debug, Clone, Deserialize)]
pub struct Annotator {
    pub id: String,
    pub title: String,
}

/// 从链接导入: links matching one of `matches` are handed to the plugin.
#[derive(Debug, Clone, Deserialize)]
pub struct Importer {
    pub id: String,
    pub title: String,
    #[serde(rename = "match")]
    pub matches: Vec<String>,
}

/// What the plugin says it does, shown before installing. Not enforced: a
/// plugin is a program running on this computer.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Permissions {
    #[serde(default)]
    pub network: Vec<String>,
    #[serde(default)]
    pub runs: String,
}

/// The `main` keys this computer runs, best first: `{os}-{arch}`. Windows on Arm
/// also takes an x86_64 program (Windows 11 runs x64 programs emulated); a Mac
/// takes only its own chip's (Rosetta isn't always installed).
pub fn platforms() -> &'static [&'static str] {
    platforms_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn platforms_for(os: &str, arch: &str) -> &'static [&'static str] {
    match (os, arch) {
        ("macos", "aarch64") => &["darwin-arm64"],
        ("macos", "x86_64") => &["darwin-x86_64"],
        ("windows", "aarch64") => &["windows-arm64", "windows-x86_64"],
        ("windows", "x86_64") => &["windows-x86_64"],
        _ => &[],
    }
}

/// This computer's own key, e.g. for a plugin built here.
pub fn platform() -> &'static str {
    platforms().first().copied().unwrap_or("unsupported")
}

/// The program listed for the first of `platforms` the plugin has.
fn program_for<'a>(main: &'a HashMap<String, String>, platforms: &[&str]) -> Option<&'a String> {
    platforms.iter().find_map(|p| main.get(*p))
}

fn unsupported() -> &'static str {
    if cfg!(windows) {
        crate::i18n::pick(
            "这个插件不支持这台电脑（没有对应处理器的 Windows 程序）",
            "This plugin doesn't support this PC (it has no Windows program for this processor)",
        )
    } else {
        crate::i18n::pick(
            "这个插件不支持这台 Mac（没有对应芯片的程序）",
            "This plugin doesn't support this Mac (it has no program for this chip)",
        )
    }
}

impl Manifest {
    pub fn read(dir: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(dir.join("manifest.json")).map_err(|_| {
            crate::i18n::pick(
                "文件夹里没有 manifest.json，不是一个插件",
                "This folder has no manifest.json, so it isn't a plugin",
            )
            .to_string()
        })?;
        let manifest: Manifest = serde_json::from_str(&text).map_err(|e| {
            tr!(
                "manifest.json 写得不对：{e}",
                "manifest.json isn't valid: {e}"
            )
        })?;
        // A debug build runs code newer than its version number, so it takes plugins
        // written for the next version (they are tried there first).
        let version = if cfg!(debug_assertions) {
            "9999.0.0"
        } else {
            env!("CARGO_PKG_VERSION")
        };
        manifest.check(version)?;
        Ok(manifest)
    }

    pub fn check(&self, app_version: &str) -> Result<(), String> {
        let id_ok = (1..=40).contains(&self.id.len())
            && self
                .id
                .starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
            && self
                .id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !id_ok {
            let id = &self.id;
            return Err(tr!(
                "插件 id “{id}” 只能用小写字母、数字和 -",
                "The plugin ID “{id}” can only contain lowercase letters, digits, and -"
            ));
        }
        if self.name.trim().is_empty() {
            return Err(crate::i18n::pick("插件没有名字", "The plugin has no name").into());
        }
        if self.protocol != PROTOCOL {
            let protocol = self.protocol;
            return Err(tr!(
                "这个插件需要另一个版本的应用（插件协议 {protocol}，应用支持 {PROTOCOL}）",
                "This plugin needs a different version of the app (plugin protocol {protocol}; this app supports {PROTOCOL})"
            ));
        }
        if let Some(min) = &self.min_app_version {
            if older(app_version, min) {
                return Err(tr!(
                    "这个插件需要 Shadowing {min} 或更新的版本",
                    "This plugin needs Shadowing {min} or later"
                ));
            }
        }
        self.program_path()?;
        for importer in &self.contributes.importers {
            if importer.matches.is_empty() {
                let title = &importer.title;
                return Err(tr!(
                    "“{title}” 没有写能导入哪些链接",
                    "“{title}” doesn't say which links it can import"
                ));
            }
            if let Some(bad) = importer.matches.iter().find(|p| split_url(p).is_none()) {
                return Err(tr!(
                    "链接规则 “{bad}” 要以 https:// 或 http:// 开头",
                    "The link pattern “{bad}” must start with https:// or http://"
                ));
            }
        }
        for setting in &self.contributes.settings {
            setting.check()?;
        }
        Ok(())
    }

    /// The program for this computer, relative to the plugin folder (never outside it).
    pub fn program_path(&self) -> Result<PathBuf, String> {
        let rel = program_for(&self.main, platforms()).ok_or_else(unsupported)?;
        let path = PathBuf::from(rel);
        // No `:` either: a drive (`C:`) or a Windows file's hidden stream (`run:x`).
        let inside = !rel.is_empty()
            && !rel.contains(':')
            && path
                .components()
                .all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
        if !inside {
            return Err(tr!(
                "插件程序的路径 “{rel}” 不在插件文件夹里",
                "The plugin's program path “{rel}” isn't inside the plugin folder"
            ));
        }
        Ok(path)
    }

    /// The first importer that takes this link.
    pub fn importer_for(&self, url: &str) -> Option<&Importer> {
        self.contributes
            .importers
            .iter()
            .find(|i| i.matches.iter().any(|p| matches(p, url)))
    }
}

/// "0.8.1" < "0.9.0"; missing parts count as 0, anything after `-` is ignored.
fn older(version: &str, than: &str) -> bool {
    let parts = |v: &str| -> Vec<u64> {
        v.split('-')
            .next()
            .unwrap_or("")
            .split('.')
            .map(|p| p.trim().parse().unwrap_or(0))
            .collect()
    };
    let (a, b) = (parts(version), parts(than));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (
            a.get(i).copied().unwrap_or(0),
            b.get(i).copied().unwrap_or(0),
        );
        if x != y {
            return x < y;
        }
    }
    false
}

/// `https://host/rest` → (scheme, lowercase host, rest starting with `/`, `?` or empty).
fn split_url(url: &str) -> Option<(&str, String, &str)> {
    let (scheme, after) = url.split_once("://")?;
    if scheme != "https" && scheme != "http" {
        return None;
    }
    let end = after.find(['/', '?', '#']).unwrap_or(after.len());
    let host = &after[..end];
    if host.is_empty() {
        return None;
    }
    Some((scheme, host.to_ascii_lowercase(), &after[end..]))
}

/// Like a browser extension's match pattern: `https://*.youtube.com/watch?*`
/// takes youtube.com and any subdomain; `*` in the rest matches anything.
pub fn matches(pattern: &str, url: &str) -> bool {
    let (Some((ps, ph, pr)), Some((us, uh, ur))) = (split_url(pattern), split_url(url.trim()))
    else {
        return false;
    };
    let host_ok = match ph.strip_prefix("*.") {
        Some(base) => uh == base || uh.ends_with(&format!(".{base}")),
        None => uh == ph,
    };
    ps == us && host_ok && glob(pr, if ur.is_empty() { "/" } else { ur })
}

/// `*` matches any run of characters (including none); everything else is literal.
fn glob(pattern: &str, text: &str) -> bool {
    let (p, t): (Vec<char>, Vec<char>) = (pattern.chars().collect(), text.chars().collect());
    let (mut pi, mut ti) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while ti < t.len() {
        if pi < p.len() && p[pi] == '*' {
            star = Some((pi, ti));
            pi += 1;
        } else if pi < p.len() && p[pi] == t[ti] {
            pi += 1;
            ti += 1;
        } else if let Some((sp, st)) = star {
            pi = sp + 1;
            ti = st + 1;
            star = Some((sp, st + 1));
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|&c| c == '*')
}

#[cfg(test)]
#[path = "manifest_tests.rs"]
mod tests;
