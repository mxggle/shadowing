//! First-run guide: what the learner chose and has done, plus the bundled
//! sample clips used for the hands-on practice and the AI setup test.

use crate::library::{self, Track};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Guide {
    /// The welcome screen was answered (or skipped).
    pub welcomed: bool,
    /// "ja", "en" or "other": picks the sample clip and the default language.
    pub language: String,
    /// The practice on the sample was finished or skipped.
    pub practiced: bool,
    /// Contextual tips already shown once.
    pub tips: Vec<String>,
}

#[tauri::command]
pub fn guide_save(state: State<AppState>, guide: Guide) -> Result<(), String> {
    state.update(|d| d.guide = guide)
}

/// Where the bundled samples live (inside the .app, or beside the debug binary).
///
/// Tauri only treats a binary as a dev build when its folder sits under a directory
/// literally named `target`, so with a custom `CARGO_TARGET_DIR` (e.g. `shared-target`)
/// `resource_dir` points into a missing `Contents/Resources`. Debug builds therefore
/// also look beside the binary and in the source tree.
pub fn samples_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = vec![app.path().resource_dir().ok()?.join("samples")];
    if cfg!(debug_assertions) {
        if let Some(beside) = std::env::current_exe()
            .ok()
            .and_then(|exe| Some(exe.parent()?.join("samples")))
        {
            candidates.push(beside);
        }
        candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("samples"));
    }
    candidates
        .into_iter()
        .find_map(|dir| dir.canonicalize().ok())
}

/// The sample clip for a learning language; anything but Japanese gets English.
pub fn sample_in(dir: &Path, language: &str) -> Option<Track> {
    let sub = if language == "ja" { "ja" } else { "en" };
    library::scan(&dir.join(sub))
        .ok()?
        .tracks
        .into_iter()
        .next()
}

#[tauri::command]
pub fn sample_track(state: State<AppState>, language: String) -> Result<Track, String> {
    state
        .samples
        .as_deref()
        .and_then(|dir| sample_in(dir, &language))
        .ok_or_else(|| "找不到示例音频，请重新安装应用".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_samples_have_a_clip_and_its_subtitles() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("samples");
        for (language, expected) in [
            ("ja", "ごんぎつね"),
            ("en", "The Tale of Peter Rabbit"),
            ("other", "The Tale of Peter Rabbit"),
        ] {
            let track = sample_in(&dir, language).unwrap();
            assert_eq!(track.name, expected);
            let srt = Path::new(&track.path).with_extension("srt");
            let sentences = crate::subtitles::parse(
                &crate::subtitles::decode(&std::fs::read(srt).unwrap()).unwrap(),
            )
            .unwrap();
            assert!(sentences.len() >= 4, "{language}: {}", sentences.len());
            // Sentences in order, inside the ~30 s clip, none longer than the 15 s cap.
            for pair in sentences.windows(2) {
                assert!(pair[0].end <= pair[1].start + 1e-9);
            }
            for s in &sentences {
                assert!(
                    s.start < s.end && s.end < 33.0 && s.end - s.start < 15.0,
                    "{s:?}"
                );
            }
        }
    }
}
