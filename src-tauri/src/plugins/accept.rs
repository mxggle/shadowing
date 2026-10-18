//! What an import brought back. The plugin only writes into a staging folder
//! in app data; the app checks each file there and moves the audio into the
//! learner's folder itself, so a plugin never touches that folder.

use crate::library;
use serde::Deserialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const MAX_AUDIO: u64 = 4 << 30;
const MAX_SUBTITLE: u64 = 20 << 20;
/// Bytes of a file name before the extension, leaving room for “ (12)” and “.m4a”.
const MAX_NAME_BYTES: usize = 180;

/// One file in the plugin's answer to `import/run`.
#[derive(Debug, Deserialize)]
pub struct Made {
    /// Relative to the staging folder (or absolute inside it).
    pub path: String,
    /// "audio" or "subtitle".
    pub kind: String,
    #[serde(default)]
    pub lang: Option<String>,
}

pub struct Picked {
    pub audio: PathBuf,
    /// A subtitle file (still in staging) and its language.
    pub subtitle: Option<(PathBuf, String)>,
}

/// A regular file inside `staging` (not a link out of it), no bigger than `max`.
fn inside(staging: &Path, path: &str, max: u64) -> Option<PathBuf> {
    let path = Path::new(path);
    let full = if path.is_absolute() {
        path.to_path_buf()
    } else {
        staging.join(path)
    };
    let meta = fs::symlink_metadata(&full).ok()?;
    if !meta.file_type().is_file() || meta.len() > max {
        return None;
    }
    let canonical = full.canonicalize().ok()?;
    canonical
        .starts_with(staging.canonicalize().ok()?)
        .then_some(canonical)
}

fn has_extension(path: &Path, allowed: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| allowed.contains(&e.to_ascii_lowercase().as_str()))
}

pub fn pick(staging: &Path, made: &[Made]) -> Result<Picked, String> {
    let audio = made
        .iter()
        .filter(|m| m.kind == "audio")
        .filter_map(|m| inside(staging, &m.path, MAX_AUDIO))
        .find(|p| library::is_audio(p))
        .ok_or(crate::i18n::pick(
            "插件没有下载到能播放的音频",
            "The plugin didn't download any playable audio",
        ))?;
    let subtitle = made.iter().filter(|m| m.kind == "subtitle").find_map(|m| {
        let path = inside(staging, &m.path, MAX_SUBTITLE)?;
        has_extension(&path, &["srt", "vtt"]).then(|| (path, m.lang.clone().unwrap_or_default()))
    });
    Ok(Picked { audio, subtitle })
}

/// A file or folder name from a title: no `/` `:` or other characters that some
/// disks refuse, not hidden (the folder list skips hidden files), not too long.
pub fn safe_name(title: &str) -> String {
    let replaced: String = title
        .chars()
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let mut name = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    name = name.trim_start_matches(['.', ' ']).to_string();
    if name.len() > MAX_NAME_BYTES {
        let mut cut = MAX_NAME_BYTES;
        while !name.is_char_boundary(cut) {
            cut -= 1;
        }
        name.truncate(cut);
    }
    let name = name.trim_end_matches(['.', ' ']).to_string();
    if name.is_empty() {
        crate::i18n::pick("未命名", "Untitled").into()
    } else {
        name
    }
}

/// `dir/stem.ext`, or `dir/stem (2).ext` and so on when that is taken.
pub fn free_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut n = 1;
    loop {
        let name = match n {
            1 => format!("{stem}.{ext}"),
            _ => format!("{stem} ({n}).{ext}"),
        };
        let path = dir.join(name);
        if fs::symlink_metadata(&path).is_err() {
            return path;
        }
        n += 1;
    }
}

/// Rename, or copy and delete when the folder is on another disk.
fn move_file(from: &Path, to: &Path) -> io::Result<()> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to)?;
    fs::remove_file(from)
}

/// Moves the audio into `root` (or its subfolder `folder`), named after `title`.
pub fn place(audio: &Path, root: &Path, folder: &str, title: &str) -> Result<PathBuf, String> {
    let folder = folder.trim();
    let dir = if folder.is_empty() {
        root.to_path_buf()
    } else {
        root.join(safe_name(folder))
    };
    fs::create_dir_all(&dir)
        .map_err(|e| tr!("无法创建文件夹：{e}", "Couldn't create the folder: {e}"))?;
    let ext = audio
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("m4a")
        .to_ascii_lowercase();
    let dest = free_path(&dir, &safe_name(title), &ext);
    move_file(audio, &dest).map_err(|e| {
        tr!(
            "无法把音频放进文件夹：{e}",
            "Couldn't move the audio into the folder: {e}"
        )
    })?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn made(path: &str, kind: &str) -> Made {
        Made {
            path: path.into(),
            kind: kind.into(),
            lang: Some("ja".into()),
        }
    }

    #[test]
    fn names_from_titles() {
        assert_eq!(
            safe_name("日本語練習／中級【～によって】会話"),
            "日本語練習／中級【～によって】会話"
        );
        assert_eq!(safe_name("AC/DC: Live?  \"Best\"\n"), "AC DC Live Best");
        assert_eq!(safe_name("...hidden"), "hidden");
        assert_eq!(safe_name("  ..  "), "未命名");
        assert_eq!(safe_name("ends with dots..."), "ends with dots");
        let long = safe_name(&"あ".repeat(100));
        assert!(long.len() <= MAX_NAME_BYTES && long.chars().all(|c| c == 'あ'));
    }

    #[test]
    fn free_path_counts_up() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(free_path(tmp.path(), "a", "m4a"), tmp.path().join("a.m4a"));
        fs::write(tmp.path().join("a.m4a"), "").unwrap();
        fs::write(tmp.path().join("a (2).m4a"), "").unwrap();
        assert_eq!(
            free_path(tmp.path(), "a", "m4a"),
            tmp.path().join("a (3).m4a")
        );
    }

    #[test]
    fn picks_only_files_inside_staging() {
        let tmp = tempfile::tempdir().unwrap();
        let staging = tmp.path().join("job");
        fs::create_dir_all(&staging).unwrap();
        fs::write(tmp.path().join("secret.m4a"), "outside").unwrap();
        std::os::unix::fs::symlink(tmp.path().join("secret.m4a"), staging.join("link.m4a"))
            .unwrap();
        fs::write(staging.join("notes.txt"), "x").unwrap();
        fs::write(staging.join("audio.ja.vtt"), "WEBVTT").unwrap();

        let escapes = [
            made("link.m4a", "audio"),
            made("../secret.m4a", "audio"),
            made(&tmp.path().join("secret.m4a").to_string_lossy(), "audio"),
            made("notes.txt", "audio"),
            made("missing.m4a", "audio"),
        ];
        assert!(pick(&staging, &escapes).is_err());

        fs::write(staging.join("audio.m4a"), "aac").unwrap();
        let ok = [
            made("notes.txt", "subtitle"),
            made("audio.ja.vtt", "subtitle"),
            made("audio.m4a", "audio"),
        ];
        let picked = pick(&staging, &ok).unwrap();
        assert!(picked.audio.ends_with("audio.m4a"));
        let (sub, lang) = picked.subtitle.unwrap();
        assert!(sub.ends_with("audio.ja.vtt"));
        assert_eq!(lang, "ja");
    }

    #[test]
    fn places_into_a_subfolder_without_overwriting() {
        let tmp = tempfile::tempdir().unwrap();
        let (staging, root) = (tmp.path().join("job"), tmp.path().join("lib"));
        fs::create_dir_all(&staging).unwrap();
        fs::create_dir_all(root.join("YouTube")).unwrap();
        fs::write(root.join("YouTube/会話.m4a"), "old").unwrap();
        fs::write(staging.join("audio.M4A"), "new").unwrap();

        let dest = place(&staging.join("audio.M4A"), &root, " YouTube ", "会話").unwrap();
        assert_eq!(dest, root.join("YouTube/会話 (2).m4a"));
        assert_eq!(fs::read_to_string(&dest).unwrap(), "new");
        assert_eq!(
            fs::read_to_string(root.join("YouTube/会話.m4a")).unwrap(),
            "old"
        );

        // `..` can't climb out of the folder.
        fs::write(staging.join("b.m4a"), "b").unwrap();
        let dest = place(&staging.join("b.m4a"), &root, "../..", "b").unwrap();
        assert!(dest.starts_with(&root), "{dest:?}");
    }
}
