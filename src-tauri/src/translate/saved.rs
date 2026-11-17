//! Translations kept between runs: one file per track in app data (`translations/`), next to
//! the transcripts. Each belongs to a sentence's text in one language, so a corrected sentence
//! is translated again, and cutting or joining sentences needs nothing moved. Translations of
//! text no longer in the transcript are dropped whenever the file is written.

use crate::store;
use crate::transcript::{self, Sentence, Translations};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const VERSION: u32 = 1;

/// Batches for one track may finish close together; each saves by reading and rewriting the file.
static WRITING: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Kept {
    pub text: String,
    /// The language code it is in ("zh-Hans", "en"…).
    pub lang: String,
    /// "" when the sentence is already in that language.
    pub translation: String,
}

#[derive(Serialize, Deserialize)]
struct File {
    version: u32,
    /// Guards against a hash collision between two tracks.
    audio: String,
    kept: Vec<Kept>,
}

fn path(dir: &Path, audio: &str) -> PathBuf {
    transcript::stored_path(dir, audio)
}

fn read(dir: &Path, audio: &str) -> Vec<Kept> {
    let Ok(text) = std::fs::read_to_string(path(dir, audio)) else {
        return Vec::new();
    };
    match serde_json::from_str::<File>(&text) {
        Ok(file) if file.audio == audio && file.version == VERSION => file.kept,
        _ => Vec::new(),
    }
}

fn texts(sentences: &[Sentence]) -> HashSet<&str> {
    sentences.iter().map(|s| s.text.as_str()).collect()
}

/// The track's sentences' translations in `lang` (text → translation, "" for one already in it).
pub fn load(dir: &Path, audio: &str, sentences: &[Sentence], lang: &str) -> Translations {
    let texts = texts(sentences);
    read(dir, audio)
        .into_iter()
        .filter(|k| k.lang == lang && texts.contains(k.text.as_str()))
        .map(|k| (k.text, k.translation))
        .collect()
}

/// Keeps `found` (text, translation) in `lang`, replacing older ones for the same text, and drops
/// those of text the sentences no longer have.
pub fn save(
    dir: &Path,
    audio: &str,
    sentences: &[Sentence],
    lang: &str,
    found: Vec<(String, String)>,
) -> std::io::Result<()> {
    let _writing = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let texts = texts(sentences);
    let mut kept = read(dir, audio);
    kept.retain(|k| {
        texts.contains(k.text.as_str())
            && !(k.lang == lang && found.iter().any(|(t, _)| *t == k.text))
    });
    kept.extend(found.into_iter().map(|(text, translation)| Kept {
        text,
        lang: lang.to_string(),
        translation,
    }));
    let file = File {
        version: VERSION,
        audio: audio.to_string(),
        kept,
    };
    store::write_atomic(&path(dir, audio), &serde_json::to_vec(&file)?)
}

/// A non-empty translation of `text`, in the interface language when there is one.
pub fn any(dir: &Path, audio: &str, text: &str) -> Option<String> {
    let ui = crate::i18n::current();
    let mut found: Vec<Kept> = read(dir, audio)
        .into_iter()
        .filter(|k| k.text == text && !k.translation.is_empty())
        .collect();
    found.sort_by_key(|k| !k.lang.starts_with(ui));
    found.into_iter().next().map(|k| k.translation)
}

pub fn remove(dir: &Path, audio: &str) -> std::io::Result<()> {
    match std::fs::remove_file(path(dir, audio)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}
