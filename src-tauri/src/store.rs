//! Small JSON file holding everything the app remembers between launches.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub rate: f64,
    /// What happens when a track plays to its end.
    pub play_mode: PlayMode,
    /// Read from files written before `play_mode` existed; never written back.
    #[serde(skip_serializing)]
    auto_advance: Option<bool>,
    /// Seconds jumped by ← → and the rewind/forward buttons.
    pub seek_step: f64,
    /// Last language picked for transcription ("" = detect).
    pub transcribe_language: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            rate: 1.0,
            play_mode: PlayMode::Next,
            auto_advance: None,
            seek_step: 5.0,
            transcribe_language: String::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlayMode {
    /// Stop at the end of the track.
    Once,
    /// Play the folder in order, stop after the last track.
    Next,
    /// Play the folder in order, then start over.
    List,
    /// Repeat the current track.
    One,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub position: f64,
    pub duration: f64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Persisted {
    pub folder: Option<PathBuf>,
    pub last_track: Option<String>,
    pub settings: Settings,
    /// Keyed by absolute track path.
    pub progress: HashMap<String, Progress>,
    pub ai: crate::ai::AiConfig,
    pub guide: crate::guide::Guide,
}

impl Persisted {
    /// Missing or unreadable files start fresh; a corrupt file is kept aside, not deleted.
    pub fn load(path: &Path) -> Self {
        let Ok(text) = fs::read_to_string(path) else {
            return Self::default();
        };
        let mut state: Self = serde_json::from_str(&text).unwrap_or_else(|err| {
            eprintln!("state file unreadable ({err}); starting fresh");
            let _ = fs::rename(path, path.with_extension("corrupt.json"));
            Self::default()
        });
        // The old on/off "continuous play" switch: off meant stop after each track.
        if state.settings.auto_advance.take() == Some(false) {
            state.settings.play_mode = PlayMode::Once;
        }
        state
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        write_atomic(path, &serde_json::to_vec_pretty(self)?)
    }
}

/// Temp file + rename, so a crash never leaves half a file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        assert_eq!(Persisted::load(&path).settings.rate, 1.0);

        let mut s = Persisted::default();
        s.settings.rate = 0.8;
        s.progress.insert(
            "/a.mp3".into(),
            Progress {
                position: 12.5,
                duration: 60.0,
                updated_at: 1,
            },
        );
        s.save(&path).unwrap();
        let loaded = Persisted::load(&path);
        assert_eq!(loaded.settings.rate, 0.8);
        assert_eq!(loaded.progress["/a.mp3"].position, 12.5);
    }

    #[test]
    fn older_files_get_new_setting_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, r#"{"settings":{"rate":0.8}}"#).unwrap();
        let s = Persisted::load(&path).settings;
        assert_eq!(
            (s.rate, s.play_mode, s.seek_step),
            (0.8, PlayMode::Next, 5.0)
        );
    }

    #[test]
    fn old_continuous_play_switch_becomes_a_play_mode() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, r#"{"settings":{"autoAdvance":false}}"#).unwrap();
        let loaded = Persisted::load(&path);
        assert_eq!(loaded.settings.play_mode, PlayMode::Once);
        // Saved back without the old field.
        loaded.save(&path).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains(r#""playMode": "once""#) && !text.contains("autoAdvance"));
        fs::write(
            &path,
            r#"{"settings":{"autoAdvance":true,"playMode":"one"}}"#,
        )
        .unwrap();
        assert_eq!(Persisted::load(&path).settings.play_mode, PlayMode::One);
    }

    #[test]
    fn corrupt_file_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, "{not json").unwrap();
        assert!(Persisted::load(&path).folder.is_none());
        assert!(dir.path().join("state.corrupt.json").exists());
    }
}
