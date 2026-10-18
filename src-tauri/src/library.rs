//! Folder scanning: finds playable audio files under an approved root.

use serde::Serialize;
use std::cmp::Ordering;
use std::path::{Component, Path, PathBuf, Prefix};
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
    /// Directory relative to the folder root ("" for top level), parts joined by "/".
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
    let root = canonical(root)?;
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
                .map(slashed)
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

/// The absolute path with links resolved. On Windows as `C:\Music`, not `\\?\C:\Music`
/// (kept only where the short form would mean another file, e.g. paths over 260 characters).
pub fn canonical(path: &Path) -> std::io::Result<PathBuf> {
    dunce::canonicalize(path)
}

/// A relative directory with "/" between its parts on every platform (the UI splits on it).
fn slashed(dir: &Path) -> String {
    let parts: Vec<_> = dir
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect();
    parts.join("/")
}

/// Returns the canonical path if it lies inside `root` (blocks `..` and symlink escapes).
pub fn resolve_inside(root: &Path, requested: &Path) -> Option<PathBuf> {
    let canonical = canonical(requested).ok()?;
    inside(root, &canonical).then_some(canonical)
}

/// Whether canonical `path` is `root` or lies under it, whole component by component
/// (`/Music` doesn't hold `/Musicals`). Names must match exactly, as canonical paths
/// spell them the way the disk does. On Windows a drive or share may come as `C:` or
/// `\\?\C:`, `\\nas\share` or `\\?\UNC\nas\share`, in any case: those are the same place.
pub fn inside(root: &Path, path: &Path) -> bool {
    if root.as_os_str().is_empty() {
        return false;
    }
    let mut path = path.components();
    root.components()
        .all(|r| path.next().is_some_and(|p| same(r, p)))
}

fn same(a: Component, b: Component) -> bool {
    match (a, b) {
        (Component::Prefix(pa), Component::Prefix(pb)) => {
            match (volume(pa.kind()), volume(pb.kind())) {
                (Some(va), Some(vb)) => va == vb,
                _ => pa == pb,
            }
        }
        _ => a == b,
    }
}

/// A drive or network share however it was written; None for other prefixes (devices).
fn volume(prefix: Prefix) -> Option<String> {
    match prefix {
        Prefix::Disk(d) | Prefix::VerbatimDisk(d) => {
            Some(format!("{}:", char::from(d.to_ascii_uppercase())))
        }
        Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => Some(format!(
            "//{}/{}",
            server.to_string_lossy().to_lowercase(),
            share.to_string_lossy().to_lowercase()
        )),
        _ => None,
    }
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
        fs::create_dir_all(root.join("Unit 2/Part 1")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        for f in [
            "10.mp3",
            "2.M4A",
            "notes.txt",
            "Unit 2/a.wav",
            "Unit 2/Part 1/b.flac",
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
        assert_eq!(names, ["/2", "/10", "Unit 2/a", "Unit 2/Part 1/b"]);
    }

    #[test]
    fn resolve_blocks_escape() {
        let dir = tempfile::tempdir().unwrap();
        let root = canonical(dir.path()).unwrap();
        fs::create_dir_all(root.join("in")).unwrap();
        fs::write(root.join("in/a.mp3"), b"x").unwrap();
        let inner = root.join("in");
        assert!(resolve_inside(&inner, &inner.join("a.mp3")).is_some());
        assert!(resolve_inside(&inner, &inner.join("../in/a.mp3")).is_some());
        fs::write(root.join("out.mp3"), b"x").unwrap();
        assert!(resolve_inside(&inner, &inner.join("../out.mp3")).is_none());
        fs::create_dir_all(root.join("into")).unwrap();
        fs::write(root.join("into/b.mp3"), b"x").unwrap();
        assert!(resolve_inside(&inner, &root.join("into/b.mp3")).is_none());
        assert!(resolve_inside(&inner, &inner.join("missing.mp3")).is_none());
    }

    #[test]
    fn inside_compares_whole_components() {
        let root = Path::new("/m/Music");
        assert!(inside(root, Path::new("/m/Music/a.mp3")));
        assert!(inside(root, Path::new("/m/Music/Unit 2/a.mp3")));
        assert!(inside(root, root));
        assert!(!inside(root, Path::new("/m/Musicals/a.mp3")));
        assert!(!inside(root, Path::new("/m/music/a.mp3")));
        assert!(!inside(root, Path::new("/m")));
        assert!(!inside(Path::new(""), Path::new("/m")));
    }

    #[cfg(windows)]
    #[test]
    fn inside_treats_spellings_of_a_windows_drive_or_share_alike() {
        let yes = |root: &str, path: &str| inside(Path::new(root), Path::new(path));
        assert!(yes(r"C:\Music", r"\\?\C:\Music\a.mp3"));
        assert!(yes(r"\\?\C:\Music", r"c:\Music\a.mp3"));
        assert!(yes(r"\\NAS\Share\Music", r"\\?\UNC\nas\share\Music\a.mp3"));
        assert!(!yes(r"C:\Music", r"D:\Music\a.mp3"));
        assert!(!yes(r"C:\Music", r"C:\Musicals\a.mp3"));
        assert!(!yes(r"C:\Music", r"\\nas\share\Music\a.mp3"));
        assert!(!yes(r"\\nas\share", r"\\nas\other\a.mp3"));
        assert!(!yes(r"\\nas\share", r"\\other\share\a.mp3"));
        // Another kind of prefix only matches itself.
        assert!(!yes(r"\\.\COM1", r"C:\a.mp3"));
    }

    #[cfg(windows)]
    #[test]
    fn canonical_paths_have_no_verbatim_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let c = canonical(dir.path()).unwrap();
        assert!(!c.to_string_lossy().starts_with(r"\\?\"), "{c:?}");
        assert_eq!(scan(dir.path()).unwrap().root, c.to_string_lossy());
    }
}
