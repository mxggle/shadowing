//! How much room recordings take (shown in the settings), and clearing those
//! of audio files that are gone. Each track's folder in `recordings/` names
//! its audio in `takes.json`; a folder whose list can't be read is left alone.

use super::saved::WRITING;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path};

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    /// All recordings, in bytes.
    pub bytes: u64,
    /// Of audio files that are gone (moved or deleted): how many, and their recordings' bytes.
    pub missing_tracks: usize,
    pub missing_bytes: u64,
}

#[derive(Deserialize)]
struct Owner {
    audio: String,
}

/// Each track folder: its size, and whether its audio is gone.
fn folders(root: &Path) -> Vec<(std::path::PathBuf, u64, bool)> {
    let Ok(dirs) = fs::read_dir(root.join("recordings")) else {
        return Vec::new();
    };
    dirs.flatten()
        .filter(|d| d.file_type().is_ok_and(|t| t.is_dir()))
        .map(|d| {
            let dir = d.path();
            let bytes = fs::read_dir(&dir)
                .map(|files| {
                    files
                        .flatten()
                        .filter_map(|f| f.metadata().ok())
                        .filter(|m| m.is_file())
                        .map(|m| m.len())
                        .sum()
                })
                .unwrap_or(0);
            let owner = fs::read_to_string(dir.join("takes.json"))
                .ok()
                .and_then(|t| serde_json::from_str::<Owner>(&t).ok());
            let missing = owner.is_some_and(|o| gone(Path::new(&o.audio)));
            (dir, bytes, missing)
        })
        .collect()
}

pub fn space(root: &Path) -> Space {
    folders(root)
        .into_iter()
        .fold(Space::default(), |mut s, (_, bytes, missing)| {
            s.bytes += bytes;
            if missing {
                s.missing_tracks += 1;
                s.missing_bytes += bytes;
            }
            s
        })
}

/// Deletes the recordings of audio files that are gone; returns what's left.
pub fn clear_missing(root: &Path) -> Result<Space, String> {
    let _w = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    for (dir, _, missing) in folders(root) {
        if missing {
            fs::remove_dir_all(&dir).map_err(|e| format!("录音没有删掉：{e}"))?;
        }
    }
    Ok(space(root))
}

/// The audio file is gone — not merely on a disk that isn't connected now, or
/// somewhere it can't be looked at (no permission): only "not found" counts.
fn gone(audio: &Path) -> bool {
    if !matches!(audio.try_exists(), Ok(false)) {
        return false;
    }
    let mut parts = audio.components();
    match (parts.next(), parts.next(), parts.next()) {
        (Some(Component::RootDir), Some(Component::Normal(v)), Some(Component::Normal(disk)))
            if v == "Volumes" =>
        {
            Path::new("/Volumes").join(disk).exists()
        }
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(root: &Path, name: &str, audio: &Path, bytes: usize) {
        let dir = root.join("recordings").join(name);
        fs::create_dir_all(&dir).unwrap();
        let list = serde_json::json!({ "version": 1, "audio": audio, "takes": [] });
        fs::write(dir.join("takes.json"), list.to_string()).unwrap();
        fs::write(dir.join("1.wav"), vec![0u8; bytes]).unwrap();
    }

    #[test]
    fn counts_and_clears_only_what_is_gone() {
        let root = tempfile::tempdir().unwrap();
        let here = root.path().join("here.mp3");
        fs::write(&here, b"x").unwrap();
        track(root.path(), "a", &here, 1000);
        track(root.path(), "b", &root.path().join("moved.mp3"), 3000);
        // On a disk that isn't plugged in: not gone.
        track(
            root.path(),
            "c",
            Path::new("/Volumes/No Such Disk 7f3a/x.mp3"),
            500,
        );
        let list = |n: &str| {
            fs::metadata(root.path().join("recordings").join(n).join("takes.json"))
                .unwrap()
                .len()
        };
        let all = 4500 + list("a") + list("b") + list("c");
        let s = space(root.path());
        assert_eq!((s.bytes, s.missing_tracks), (all, 1));
        assert_eq!(s.missing_bytes, 3000 + list("b"));
        let after = clear_missing(root.path()).unwrap();
        assert_eq!(
            (after.bytes, after.missing_tracks),
            (all - s.missing_bytes, 0)
        );
        assert!(
            root.path().join("recordings/a").exists() && root.path().join("recordings/c").exists()
        );
        assert!(!root.path().join("recordings/b").exists());
    }

    #[test]
    fn nothing_recorded_is_nothing() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(space(root.path()), Space::default());
    }
}
