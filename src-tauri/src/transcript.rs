//! Per-track transcripts. A transcript saved in app data wins; otherwise a
//! subtitle file next to the audio (`ep1.srt`, `ep1.ja.vtt`) is picked up.

use crate::{library, store, subtitles, AppState};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sentence {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// Chosen in the import dialog and saved in app data.
    Imported,
    /// Found next to the audio file; read fresh each time, never copied.
    Sidecar,
    /// Made by a transcription service and saved in app data.
    Transcribed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub source: Source,
    /// File name it came from, or "Groq · whisper-large-v3".
    pub origin: String,
    pub sentences: Vec<Sentence>,
}

#[derive(Serialize, Deserialize)]
struct StoredFile {
    version: u32,
    /// Guards against a hash collision between two tracks.
    audio: String,
    transcript: Transcript,
}

const SUBTITLE_EXTENSIONS: &[&str] = &["srt", "vtt"];

pub fn read_subtitle(path: &Path, source: Source) -> Result<Transcript, String> {
    let bytes = fs::read(path).map_err(|e| format!("无法读取字幕文件：{e}"))?;
    let sentences = subtitles::parse(&subtitles::decode(&bytes)?)?;
    let origin = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Transcript {
        source,
        origin,
        sentences,
    })
}

/// FNV-1a: stable across Rust versions, unlike `DefaultHasher`.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3)
    })
}

fn stored_path(dir: &Path, audio: &str) -> PathBuf {
    dir.join(format!("{:016x}.json", fnv1a(audio.as_bytes())))
}

pub fn load(dir: &Path, audio: &str) -> Option<Transcript> {
    let text = fs::read_to_string(stored_path(dir, audio)).ok()?;
    let file: StoredFile = serde_json::from_str(&text).ok()?;
    (file.audio == audio).then_some(file.transcript)
}

pub fn save(dir: &Path, audio: &str, transcript: &Transcript) -> std::io::Result<()> {
    let file = StoredFile {
        version: 1,
        audio: audio.to_string(),
        transcript: transcript.clone(),
    };
    store::write_atomic(&stored_path(dir, audio), &serde_json::to_vec(&file)?)
}

pub fn remove(dir: &Path, audio: &str) -> std::io::Result<()> {
    match fs::remove_file(stored_path(dir, audio)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// `stem.srt` beats `stem.<lang>.srt`; the language tag must look like one.
pub fn find_sidecar(audio: &Path) -> Option<PathBuf> {
    let stem = audio.file_stem()?.to_str()?;
    let mut found: Vec<(bool, String, PathBuf)> = fs::read_dir(audio.parent()?)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let (base, ext) = name.rsplit_once('.')?;
            if !SUBTITLE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()) {
                return None;
            }
            let tag = base.strip_prefix(stem)?;
            let exact = tag.is_empty();
            let lang = tag.strip_prefix('.').unwrap_or("-");
            // "ja", "en-US", "zh-Hans"; not "5" (that is "ep1.5.srt" for "ep1.5.mp3").
            let lang_ok = (2..=10).contains(&lang.len())
                && lang.starts_with(|c: char| c.is_ascii_alphabetic())
                && lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
            (exact || lang_ok).then(|| (!exact, name, entry.path()))
        })
        .collect();
    found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| library::natural_cmp(&a.1, &b.1)));
    found.into_iter().next().map(|(_, _, path)| path)
}

/// Canonical audio path inside the approved folder, plus the transcripts dir.
fn authorize(state: &AppState, path: &str) -> Result<(PathBuf, String, PathBuf), String> {
    let root = state.root().ok_or("尚未选择文件夹")?;
    let audio = library::resolve_inside(&root, Path::new(path))
        .filter(|p| library::is_audio(p))
        .ok_or("无法访问此文件")?;
    let key = audio.to_string_lossy().into_owned();
    Ok((audio, key, state.data_dir().join("transcripts")))
}

#[tauri::command]
pub fn transcript_get(state: State<AppState>, path: String) -> Result<Option<Transcript>, String> {
    let (audio, key, dir) = authorize(&state, &path)?;
    if let Some(t) = load(&dir, &key) {
        return Ok(Some(t));
    }
    let root = state.root().ok_or("尚未选择文件夹")?;
    Ok(find_sidecar(&audio)
        .and_then(|p| library::resolve_inside(&root, &p))
        .and_then(|p| read_subtitle(&p, Source::Sidecar).ok()))
}

/// Native picker for an SRT/VTT file; the choice is saved for this track.
#[tauri::command]
pub async fn transcript_import(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<Transcript>, String> {
    let (audio, key, dir) = authorize(&state, &path)?;
    let mut picker = app
        .dialog()
        .file()
        .set_title("选择字幕文件")
        .add_filter("字幕 (SRT / VTT)", SUBTITLE_EXTENSIONS);
    if let Some(parent) = audio.parent() {
        picker = picker.set_directory(parent);
    }
    let Some(picked) = picker.blocking_pick_file() else {
        return Ok(None);
    };
    let file = picked.into_path().map_err(|e| e.to_string())?;
    let transcript = read_subtitle(&file, Source::Imported)?;
    save(&dir, &key, &transcript).map_err(|e| e.to_string())?;
    Ok(Some(transcript))
}

/// Asks first; returns what the track falls back to (a sidecar, or nothing).
#[tauri::command]
pub async fn transcript_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<Transcript>, String> {
    let (audio, key, dir) = authorize(&state, &path)?;
    let confirmed = app
        .dialog()
        .message("之后可以重新导入。")
        .title("移除这个音频的字幕？")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "移除".into(),
            "取消".into(),
        ))
        .blocking_show();
    if confirmed {
        remove(&dir, &key).map_err(|e| e.to_string())?;
    }
    let root = state.root().ok_or("尚未选择文件夹")?;
    Ok(load(&dir, &key).or_else(|| {
        find_sidecar(&audio)
            .and_then(|p| library::resolve_inside(&root, &p))
            .and_then(|p| read_subtitle(&p, Source::Sidecar).ok())
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transcript(text: &str) -> Transcript {
        Transcript {
            source: Source::Imported,
            origin: "a.srt".into(),
            sentences: vec![Sentence {
                start: 1.0,
                end: 2.0,
                text: text.into(),
            }],
        }
    }

    #[test]
    fn save_load_remove_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load(dir.path(), "/m/a.mp3").is_none());
        save(dir.path(), "/m/a.mp3", &transcript("hi")).unwrap();
        assert_eq!(
            load(dir.path(), "/m/a.mp3").unwrap().sentences[0].text,
            "hi"
        );
        assert!(load(dir.path(), "/m/b.mp3").is_none());
        remove(dir.path(), "/m/a.mp3").unwrap();
        remove(dir.path(), "/m/a.mp3").unwrap(); // already gone is fine
        assert!(load(dir.path(), "/m/a.mp3").is_none());
    }

    #[test]
    fn sidecar_prefers_exact_name_then_language_tags() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let audio = d.join("ep1.mp3");
        for f in [
            "ep1.mp3",
            "ep1.5.mp3",
            "ep10.srt",
            "ep1.notes.txt",
            "ep1.5.srt",
        ] {
            fs::write(d.join(f), b"x").unwrap();
        }
        assert!(find_sidecar(&audio).is_none());
        fs::write(d.join("ep1.ja.vtt"), b"x").unwrap();
        assert_eq!(find_sidecar(&audio).unwrap(), d.join("ep1.ja.vtt"));
        fs::write(d.join("ep1.SRT"), b"x").unwrap();
        assert_eq!(find_sidecar(&audio).unwrap(), d.join("ep1.SRT"));
        assert!(find_sidecar(&d.join("ep2.mp3")).is_none());
    }

    #[test]
    fn reads_subtitle_with_origin() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lesson.srt");
        fs::write(&path, "1\n00:00:00,500 --> 00:00:01,000\nこんにちは\n").unwrap();
        let t = read_subtitle(&path, Source::Sidecar).unwrap();
        assert_eq!((t.origin.as_str(), t.sentences.len()), ("lesson.srt", 1));
    }
}
