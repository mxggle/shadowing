//! Per-track transcripts. A transcript saved in app data wins; otherwise a
//! subtitle file next to the audio (`ep1.srt`, `ep1.ja.vtt`) is picked up.

use crate::sections::{self, Section};
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
    /// Who says it (0 = the first voice heard), when a transcription found more than one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<u8>,
    /// Parts of `text` the transcriber was unsure of, to underline: [start, end)
    /// in UTF-16 units (as JavaScript counts them).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unsure: Vec<[u32; 2]>,
    /// When each character (each word, in languages written with spaces) is
    /// said, to light the playing sentence up as it goes: [UTF-16 offset,
    /// seconds]. Only transcription knows them (see `timing`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub times: crate::timing::Times,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// Saved in app data from a subtitle file: chosen in the import dialog,
    /// or an edited copy of the one next to the audio.
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
    /// Some sentence text was corrected by hand.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub edited: bool,
    /// Where each section starts; at least one (from sentence 0) once loaded.
    /// Files saved before sections existed get them worked out on load.
    #[serde(default)]
    pub sections: Vec<Section>,
}

impl Transcript {
    pub fn new(source: Source, origin: String, sentences: Vec<Sentence>) -> Self {
        let sections = sections::split(&sentences);
        Transcript {
            source,
            origin,
            sentences,
            edited: false,
            sections,
        }
    }

    /// Sections that fit the sentences, found afresh when there are none.
    fn with_sections(mut self) -> Self {
        self.sections = if self.sections.is_empty() {
            sections::split(&self.sentences)
        } else {
            sections::normalize(std::mem::take(&mut self.sections), self.sentences.len())
        };
        self
    }

    /// Changed by the learner: the copy in app data is now the app's own, and
    /// the file beside the audio stays untouched.
    pub(crate) fn own(&mut self) {
        if self.source == Source::Sidecar {
            self.source = Source::Imported;
        }
    }
}

/// New text for one sentence; its times and speaker stay as they are (the
/// times of its characters move with them).
#[derive(Debug, Deserialize)]
pub struct Edit {
    pub index: usize,
    pub text: String,
    /// Underlines that still apply to the new text (the app works out where
    /// they moved to); none when left out.
    #[serde(default)]
    pub unsure: Vec<[u32; 2]>,
}

#[derive(Serialize, Deserialize)]
struct StoredFile {
    version: u32,
    /// Guards against a hash collision between two tracks.
    audio: String,
    transcript: Transcript,
}

const SUBTITLE_EXTENSIONS: &[&str] = &["srt", "vtt"];

/// The page asked about sentences the saved transcript no longer has.
pub(crate) fn stale() -> &'static str {
    crate::i18n::pick(
        "字幕已经变了，请重新打开这个音频",
        "The subtitles have changed. Open this audio again.",
    )
}

pub(crate) fn no_transcript() -> &'static str {
    crate::i18n::pick("这个音频没有字幕", "This audio has no subtitles")
}

pub fn read_subtitle(path: &Path, source: Source) -> Result<Transcript, String> {
    let bytes = fs::read(path).map_err(|e| {
        tr!(
            "无法读取字幕文件：{e}",
            "Couldn't read the subtitle file: {e}"
        )
    })?;
    let sentences = subtitles::parse(&subtitles::decode(&bytes)?)?;
    let origin = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Transcript::new(source, origin, sentences))
}

/// FNV-1a: stable across Rust versions, unlike `DefaultHasher`.
pub(crate) fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3)
    })
}

pub(crate) fn stored_path(dir: &Path, audio: &str) -> PathBuf {
    dir.join(format!("{:016x}.json", fnv1a(audio.as_bytes())))
}

pub fn load(dir: &Path, audio: &str) -> Option<Transcript> {
    let text = fs::read_to_string(stored_path(dir, audio)).ok()?;
    let file: StoredFile = serde_json::from_str(&text).ok()?;
    (file.audio == audio).then(|| file.transcript.with_sections())
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

/// Canonical audio path (approved folder or bundled samples), plus the transcripts dir.
pub(crate) fn authorize(
    state: &AppState,
    path: &str,
) -> Result<(PathBuf, String, PathBuf), String> {
    let audio = state.audio(path)?;
    let key = audio.to_string_lossy().into_owned();
    Ok((audio, key, state.data_dir().join("transcripts")))
}

/// What a track shows: the transcript saved for it, else a subtitle file next to it.
pub(crate) fn current(state: &AppState, audio: &Path, dir: &Path, key: &str) -> Option<Transcript> {
    load(dir, key).or_else(|| {
        find_sidecar(audio)
            .and_then(|p| state.allowed(&p))
            .and_then(|p| read_subtitle(&p, Source::Sidecar).ok())
    })
}

/// The transcript a track shows, for an audio path the app may read.
pub fn for_track(state: &AppState, path: &str) -> Result<Option<Transcript>, String> {
    let (audio, key, dir) = authorize(state, path)?;
    Ok(current(state, &audio, &dir, &key))
}

#[tauri::command]
pub fn transcript_get(state: State<AppState>, path: String) -> Result<Option<Transcript>, String> {
    for_track(&state, &path)
}

/// Puts corrected text into sentences, all or nothing. Line breaks become
/// spaces; a sentence can't be emptied (its time would be left without words).
fn apply_edits(transcript: &mut Transcript, edits: &[Edit]) -> Result<(), String> {
    let mut texts = Vec::with_capacity(edits.len());
    for edit in edits {
        if edit.index >= transcript.sentences.len() {
            return Err(stale().into());
        }
        let lines: Vec<&str> = edit
            .text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        if lines.is_empty() {
            return Err(crate::i18n::pick("句子不能为空", "A sentence can't be empty").into());
        }
        texts.push(lines.join(" "));
    }
    for (edit, text) in edits.iter().zip(texts) {
        let length = text.encode_utf16().count() as u32;
        let sentence = &mut transcript.sentences[edit.index];
        sentence.unsure = edit
            .unsure
            .iter()
            .copied()
            .filter(|&[a, b]| a < b && b <= length)
            .collect();
        sentence.times = crate::timing::follow(&sentence.text, &text, &sentence.times);
        sentence.text = text;
    }
    if !edits.is_empty() {
        transcript.own();
        transcript.edited = true;
    }
    Ok(())
}

/// Corrected text for some sentences, saved in app data (never into a subtitle file).
#[tauri::command]
pub fn transcript_edit(
    state: State<AppState>,
    path: String,
    edits: Vec<Edit>,
) -> Result<Transcript, String> {
    let (audio, key, dir) = authorize(&state, &path)?;
    let mut transcript = current(&state, &audio, &dir, &key).ok_or(no_transcript())?;
    apply_edits(&mut transcript, &edits)?;
    save(&dir, &key, &transcript)
        .map_err(|e| tr!("无法保存修改：{e}", "Couldn't save the changes: {e}"))?;
    Ok(transcript)
}

/// New sections (split, merged or renamed in the list), saved in app data.
#[tauri::command]
pub fn transcript_sections(
    state: State<AppState>,
    path: String,
    sections: Vec<Section>,
) -> Result<Transcript, String> {
    let (audio, key, dir) = authorize(&state, &path)?;
    let mut transcript = current(&state, &audio, &dir, &key).ok_or(no_transcript())?;
    transcript.sections = sections::normalize(sections, transcript.sentences.len());
    transcript.own();
    save(&dir, &key, &transcript)
        .map_err(|e| tr!("无法保存分段：{e}", "Couldn't save the sections: {e}"))?;
    Ok(transcript)
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
        .set_title(crate::i18n::pick("选择字幕文件", "Choose a subtitle file"))
        .add_filter(
            crate::i18n::pick("字幕 (SRT / VTT)", "Subtitles (SRT / VTT)"),
            SUBTITLE_EXTENSIONS,
        );
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
    let mut message = match find_sidecar(&audio).and_then(|p| state.allowed(&p)) {
        Some(_) => crate::i18n::pick(
            "会换回音频旁的字幕文件。",
            "The subtitle file next to the audio will be used again.",
        ),
        None => crate::i18n::pick(
            "之后可以重新导入。",
            "You can import subtitles again later.",
        ),
    }
    .to_string();
    if load(&dir, &key).is_some_and(|t| t.edited) {
        message.push_str(crate::i18n::pick(
            "你做的修改不会保留。",
            " Your changes won't be kept.",
        ));
    }
    let confirmed = app
        .dialog()
        .message(message)
        .title(crate::i18n::pick(
            "移除这个音频的字幕？",
            "Remove this audio's subtitles?",
        ))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            crate::i18n::pick("移除", "Remove").into(),
            crate::i18n::pick("取消", "Cancel").into(),
        ))
        .blocking_show();
    if confirmed {
        remove(&dir, &key).map_err(|e| e.to_string())?;
        crate::explain::forget(&state, &key);
    }
    Ok(current(&state, &audio, &dir, &key))
}

#[cfg(test)]
#[path = "transcript_tests.rs"]
mod tests;
