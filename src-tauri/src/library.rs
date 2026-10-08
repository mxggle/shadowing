//! Folder scanning: finds playable audio files under an approved root.

use serde::Serialize;
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Formats WKWebView can play natively on macOS.
pub const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "m4b", "aac", "wav", "flac", "aif", "aiff", "caf",
];

const MAX_DEPTH: usize = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    /// Absolute canonical path; also the stable id for progress.
    pub path: String,
    /// File name without extension.
    pub name: String,
    /// Directory relative to the folder root ("" for top level).
    pub rel_dir: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderListing {
    pub root: String,
    pub name: String,
    pub tracks: Vec<Track>,
}

pub fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

pub fn scan(root: &Path) -> std::io::Result<FolderListing> {
    let root = root.canonicalize()?;
    let mut tracks: Vec<Track> = WalkDir::new(&root)
        .follow_links(false)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !is_hidden(&e.file_name().to_string_lossy()))
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && is_audio(e.path()))
        .map(|e| {
            let path = e.path().to_path_buf();
            let rel_dir = path
                .parent()
                .and_then(|p| p.strip_prefix(&root).ok())
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            Track {
                name: path
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                size: e.metadata().map(|m| m.len()).unwrap_or(0),
                path: path.to_string_lossy().into_owned(),
                rel_dir,
            }
        })
        .collect();
    tracks.sort_by(|a, b| {
        natural_cmp(&a.rel_dir, &b.rel_dir).then_with(|| natural_cmp(&a.name, &b.name))
    });
    Ok(FolderListing {
        name: root
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.to_string_lossy().into_owned()),
        root: root.to_string_lossy().into_owned(),
        tracks,
    })
}

/// Returns the canonical path if it lies inside `root` (blocks `..` and symlink escapes).
pub fn resolve_inside(root: &Path, requested: &Path) -> Option<PathBuf> {
    let canonical = requested.canonicalize().ok()?;
    canonical.starts_with(root).then_some(canonical)
}

/// Case-insensitive natural order: "Track 2" < "Track 10".
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut s = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        s.push(c);
                        it.next();
                    }
                    s
                };
                let (na, nb) = (take(&mut a), take(&mut b));
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(x), Some(y)) => {
                let ord = x.to_lowercase().cmp(y.to_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                a.next();
                b.next();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn natural_order() {
        let mut v = vec!["Track 10", "track 2", "Track 1", "Track 02b", "Intro"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, ["Intro", "Track 1", "track 2", "Track 02b", "Track 10"]);
    }

    #[test]
    fn scan_filters_and_sorts() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("Unit 2")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        for f in [
            "10.mp3",
            "2.M4A",
            "notes.txt",
            "Unit 2/a.wav",
            ".hidden/x.mp3",
        ] {
            fs::write(root.join(f), b"x").unwrap();
        }
        let listing = scan(root).unwrap();
        let names: Vec<_> = listing
            .tracks
            .iter()
            .map(|t| format!("{}/{}", t.rel_dir, t.name))
            .collect();
        assert_eq!(names, ["/2", "/10", "Unit 2/a"]);
    }

    #[test]
    fn resolve_blocks_escape() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir_all(root.join("in")).unwrap();
        fs::write(root.join("in/a.mp3"), b"x").unwrap();
        let inner = root.join("in");
        assert!(resolve_inside(&inner, &inner.join("a.mp3")).is_some());
        assert!(resolve_inside(&inner, &inner.join("../in/a.mp3")).is_some());
        fs::write(root.join("out.mp3"), b"x").unwrap();
        assert!(resolve_inside(&inner, &inner.join("../out.mp3")).is_none());
    }
}
