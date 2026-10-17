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
    /// Platform ("darwin-arm64") → program inside the plugin folder.
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
/// plugin is a program running on this Mac.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Permissions {
    #[serde(default)]
    pub network: Vec<String>,
    #[serde(default)]
    pub runs: String,
}

pub fn platform() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "darwin-arm64"
    } else {
        "darwin-x86_64"
    }
}

impl Manifest {
    pub fn read(dir: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(dir.join("manifest.json"))
            .map_err(|_| "文件夹里没有 manifest.json，不是一个插件".to_string())?;
        let manifest: Manifest =
            serde_json::from_str(&text).map_err(|e| format!("manifest.json 写得不对：{e}"))?;
        manifest.check(env!("CARGO_PKG_VERSION"))?;
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
            return Err(format!("插件 id “{}” 只能用小写字母、数字和 -", self.id));
        }
        if self.name.trim().is_empty() {
            return Err("插件没有名字".into());
        }
        if self.protocol != PROTOCOL {
            return Err(format!(
                "这个插件需要另一个版本的应用（插件协议 {}，应用支持 {PROTOCOL}）",
                self.protocol
            ));
        }
        if let Some(min) = &self.min_app_version {
            if older(app_version, min) {
                return Err(format!("这个插件需要 Shadowing {min} 或更新的版本"));
            }
        }
        self.program_path()?;
        for importer in &self.contributes.importers {
            if importer.matches.is_empty() {
                return Err(format!("“{}” 没有写能导入哪些链接", importer.title));
            }
            if let Some(bad) = importer.matches.iter().find(|p| split_url(p).is_none()) {
                return Err(format!("链接规则 “{bad}” 要以 https:// 或 http:// 开头"));
            }
        }
        Ok(())
    }

    /// The program for this Mac, relative to the plugin folder (never outside it).
    pub fn program_path(&self) -> Result<PathBuf, String> {
        let rel = self
            .main
            .get(platform())
            .ok_or("这个插件不支持这台 Mac（没有对应芯片的程序）")?;
        let path = PathBuf::from(rel);
        let inside = !rel.is_empty()
            && path
                .components()
                .all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
        if !inside {
            return Err(format!("插件程序的路径 “{rel}” 不在插件文件夹里"));
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
mod tests {
    use super::*;

    fn manifest(json: &str) -> Manifest {
        serde_json::from_str(json).unwrap()
    }

    fn youtube() -> Manifest {
        manifest(&format!(
            r#"{{"id":"youtube","name":"YouTube 导入","version":"0.1.0","protocol":1,
            "main":{{"{}":"bin/shadowing-youtube"}},
            "contributes":{{"importers":[{{"id":"video","title":"YouTube",
              "match":["https://*.youtube.com/watch?*","https://youtu.be/*","https://*.youtube.com/shorts/*"]}}]}}}}"#,
            platform()
        ))
    }

    #[test]
    fn matches_youtube_links_and_nothing_else() {
        let m = youtube();
        for url in [
            "https://www.youtube.com/watch?v=FFMoTdeD1aM",
            "https://youtube.com/watch?v=FFMoTdeD1aM&t=30s",
            "https://m.youtube.com/watch?v=FFMoTdeD1aM",
            "https://music.youtube.com/watch?v=x",
            "https://youtu.be/FFMoTdeD1aM?si=abc",
            "https://www.youtube.com/shorts/abc",
            "  https://WWW.YouTube.com/watch?v=x  ",
        ] {
            assert!(m.importer_for(url).is_some(), "{url}");
        }
        for url in [
            "https://www.youtube.com/",
            "https://www.youtube.com/playlist?list=x",
            "https://notyoutube.com/watch?v=x",
            "https://youtube.com.evil.example/watch?v=x",
            "https://evil.example/https://youtu.be/x",
            "ftp://youtu.be/x",
            "youtu.be/x",
            "",
        ] {
            assert!(m.importer_for(url).is_none(), "{url}");
        }
    }

    #[test]
    fn glob_handles_several_stars() {
        assert!(glob("/a*b*c", "/aXXbYYc"));
        assert!(glob("/*", "/"));
        assert!(glob("*", ""));
        assert!(!glob("/a*b", "/aXXc"));
        assert!(glob("/watch?*", "/watch?v=1"));
        assert!(!glob("/watch?*", "/watchv=1"));
    }

    #[test]
    fn checks_id_protocol_version_and_program() {
        let app = "0.8.1";
        assert!(youtube().check(app).is_ok());

        let mut m = youtube();
        m.id = "../evil".into();
        assert!(m.check(app).unwrap_err().contains("id"));

        let mut m = youtube();
        m.protocol = 2;
        assert!(m.check(app).unwrap_err().contains("协议"));

        let mut m = youtube();
        m.min_app_version = Some("0.9.0".into());
        assert!(m.check(app).unwrap_err().contains("0.9.0"));
        m.min_app_version = Some("0.8.1".into());
        assert!(m.check(app).is_ok());

        for bad in ["../bin/x", "/usr/bin/true", ""] {
            let mut m = youtube();
            m.main.insert(platform().into(), bad.into());
            assert!(m.check(app).unwrap_err().contains("路径"), "{bad}");
        }

        let mut m = youtube();
        m.main.clear();
        assert!(m.check(app).unwrap_err().contains("不支持"));

        let mut m = youtube();
        m.contributes.importers[0].matches = vec!["youtube.com/*".into()];
        assert!(m.check(app).unwrap_err().contains("https://"));
    }

    #[test]
    fn compares_versions() {
        assert!(older("0.8.1", "0.9.0"));
        assert!(older("0.8.1", "0.8.10"));
        assert!(!older("0.10.0", "0.9.9"));
        assert!(!older("1.0", "1.0.0"));
        assert!(!older("0.9.0-beta", "0.9.0"));
    }
}
