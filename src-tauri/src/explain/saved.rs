//! Answers kept between runs: one file per track in app data (`explanations/`),
//! next to the transcripts. An answer belongs to the words it was asked about,
//! so it is only given back (and kept) while its sentence still says the same.

use super::Explanation;
use crate::store;
use crate::transcript::{self, Sentence};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Answers for different sentences arrive at once; each saves by reading and rewriting the file.
static WRITING: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Saved {
    pub index: usize,
    /// The sentence as it was asked.
    pub text: String,
    pub explanation: Explanation,
}

#[derive(Serialize, Deserialize)]
struct File {
    version: u32,
    /// Guards against a hash collision between two tracks.
    audio: String,
    answers: Vec<Saved>,
}

fn path(dir: &Path, audio: &str) -> PathBuf {
    transcript::stored_path(dir, audio)
}

fn still_current(answer: &Saved, sentences: &[Sentence]) -> bool {
    sentences.get(answer.index).map(|s| &s.text) == Some(&answer.text)
}

/// The track's answers that still match its sentences.
pub fn load(dir: &Path, audio: &str, sentences: &[Sentence]) -> Vec<Saved> {
    let Ok(text) = std::fs::read_to_string(path(dir, audio)) else {
        return Vec::new();
    };
    let Ok(file) = serde_json::from_str::<File>(&text) else {
        return Vec::new();
    };
    if file.audio != audio {
        return Vec::new();
    }
    file.answers
        .into_iter()
        .filter(|a| still_current(a, sentences))
        .collect()
}

/// Keeps `answer` (replacing an older one for the sentence) and drops answers
/// for sentences that have since changed.
pub fn save(dir: &Path, audio: &str, sentences: &[Sentence], answer: Saved) -> std::io::Result<()> {
    let _writing = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let mut answers = load(dir, audio, sentences);
    answers.retain(|a| a.index != answer.index);
    answers.push(answer);
    let file = File {
        version: 1,
        audio: audio.to_string(),
        answers,
    };
    store::write_atomic(&path(dir, audio), &serde_json::to_vec(&file)?)
}

/// Replaces all of a track's answers (a practice pack brings its own).
pub fn save_all(dir: &Path, audio: &str, answers: Vec<Saved>) -> std::io::Result<()> {
    let _writing = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let file = File {
        version: 1,
        audio: audio.to_string(),
        answers,
    };
    store::write_atomic(&path(dir, audio), &serde_json::to_vec(&file)?)
}

pub fn remove(dir: &Path, audio: &str) -> std::io::Result<()> {
    match std::fs::remove_file(path(dir, audio)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}
