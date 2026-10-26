//! Takes kept between runs, in app data: `recordings/<track hash>/` holds a
//! WAV per take and per paragraph reading (`wav.rs`: one channel when the
//! original and you come one after the other, else left the original as heard,
//! right you) and `takes.json` listing them, newest last. A sentence of a
//! reading shadowed along the original has no file of its own: it's a window
//! onto the reading's (`Take::source`). Nothing is written beside the audio
//! files; a take outlives later edits to its sentence (it keeps the text it
//! was recorded against).

use super::take::{in_turns, Mode};
use super::wav;
use crate::store::write_atomic;
use crate::transcript::fnv1a;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Takes may finish while another is deleted; each change rewrites the list.
pub(super) static WRITING: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Take {
    pub id: String,
    /// Unix ms.
    pub created: u64,
    /// The part of the track practised (seconds).
    pub start: f64,
    pub end: f64,
    /// The sentence as it read then ("" for an A–B loop).
    pub text: String,
    pub mode: Mode,
    pub rate: f64,
    /// Length of the stored file (seconds), and where each voice is in it.
    pub duration: f64,
    pub original: (f64, f64),
    pub mine: (f64, f64),
    /// Shadowing: how far behind the original you were.
    pub lag_ms: Option<i32>,
    /// Loudness outlines for drawing (`PEAKS_PER_SEC` values a second).
    pub peaks: Peaks,
    /// The paragraph reading this sentence was cut from, if any.
    #[serde(default)]
    pub group: Option<String>,
    /// Its audio is part of that reading's file (none: a file of its own).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
    /// Heard through Bluetooth earphones: `lag_ms` is too large by their unknown delay.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bluetooth: bool,
    /// Where in the track (seconds) the original in the file begins (at `original.0`): a
    /// video's picture follows a take played back with it. None for older takes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_at: Option<f64>,
    /// 配音: said along with the picture, the original silent.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dub: bool,
}

/// Where a take's audio is in a reading's file: `duration` seconds from `from`
/// (the take's own times count from there).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub reading: String,
    pub from: f64,
}

/// A paragraph read (or shadowed) in one go. Its file holds the whole of it
/// (left: the original as heard, silent for 自己读; right: you); each sentence
/// was also kept as its own take, linked by `group`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub id: String,
    pub created: u64,
    /// The stretch of the track read (seconds).
    pub start: f64,
    pub end: f64,
    pub mode: Mode,
    pub rate: f64,
    /// Length of the stored file.
    pub duration: f64,
    pub parts: Vec<ReadPart>,
    /// The original's length at the speed compared against, and yours (first word to last).
    pub original_secs: f64,
    pub mine_secs: f64,
    pub lag_ms: Option<i32>,
    /// Your voice's loudness outline over the whole file.
    pub peaks: Vec<u8>,
    /// Heard through Bluetooth earphones (see `Take::bluetooth`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bluetooth: bool,
}

/// One sentence of a reading.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadPart {
    /// The sentence in the track.
    pub start: f64,
    pub end: f64,
    /// Where you said it in the reading's file.
    pub mine: (f64, f64),
    /// Its own take (none when it wasn't said).
    pub take: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Peaks {
    pub original: Vec<u8>,
    pub mine: Vec<u8>,
}

pub const PEAKS_PER_SEC: u32 = 50;

#[derive(Serialize, Deserialize)]
struct File {
    version: u32,
    /// Guards against a hash collision between two tracks.
    audio: String,
    takes: Vec<Take>,
    #[serde(default)]
    readings: Vec<Reading>,
}

pub fn dir(root: &Path, audio: &str) -> PathBuf {
    root.join("recordings")
        .join(format!("{:016x}", fnv1a(audio.as_bytes())))
}

pub fn wav_path(root: &Path, audio: &str, id: &str) -> PathBuf {
    dir(root, audio).join(format!("{id}.wav"))
}

/// The track's list; empty when there's none. One that can't be read (damaged,
/// or written by a newer version) is kept aside as `takes.corrupt-<ms>.json`
/// rather than overwritten by the next take.
fn load(root: &Path, audio: &str) -> File {
    let empty = || File {
        version: 1,
        audio: audio.to_string(),
        takes: Vec::new(),
        readings: Vec::new(),
    };
    let path = dir(root, audio).join("takes.json");
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return empty(),
        Err(_) => Vec::new(), // can't be read: kept aside below
    };
    match serde_json::from_slice::<File>(&bytes) {
        Ok(f) if f.audio == audio => f,
        _ => {
            // Each one kept: a later damaged list doesn't replace an earlier one.
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_millis());
            let aside = path.with_file_name(format!("takes.corrupt-{stamp}.json"));
            eprintln!("{} unreadable; kept as {}", path.display(), aside.display());
            let _ = fs::rename(&path, aside);
            empty()
        }
    }
}

pub fn take_gone() -> &'static str {
    crate::i18n::pick("这条录音不见了", "Couldn't find this recording")
}

pub fn reading_gone() -> &'static str {
    crate::i18n::pick("这次朗读不见了", "Couldn't find this reading")
}

/// Ids come from the webview: only ones this app makes (digits, `-`) name a file.
fn valid(id: &str) -> Result<(), String> {
    let ok = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    ok.then_some(()).ok_or_else(|| take_gone().to_string())
}

pub fn list(root: &Path, audio: &str) -> Vec<Take> {
    load(root, audio).takes
}

pub fn readings(root: &Path, audio: &str) -> Vec<Reading> {
    load(root, audio).readings
}

fn write(root: &Path, audio: &str, file: &File) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(file).map_err(|e| e.to_string())?;
    write_atomic(&dir(root, audio).join("takes.json"), &json)
        .map_err(|e| tr!("录音没有保存：{e}", "Couldn't save the recording: {e}"))
}

/// `apart`: the two lanes never overlap (one channel holds them).
fn write_wav(
    root: &Path,
    audio: &str,
    id: &str,
    (l, r): (&[f32], &[f32]),
    apart: bool,
) -> Result<(), String> {
    write_atomic(&wav_path(root, audio, id), &wav::encode(l, r, apart))
        .map_err(|e| tr!("录音没有保存：{e}", "Couldn't save the recording: {e}"))
}

/// Stores the take's audio, then lists it.
pub fn add(
    root: &Path,
    audio: &str,
    take: Take,
    original: &[f32],
    mine: &[f32],
) -> Result<(), String> {
    let _w = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    write_wav(root, audio, &take.id, (original, mine), in_turns(take.mode))?;
    let mut file = load(root, audio);
    file.takes.push(take);
    write(root, audio, &file)
}

/// A take's audio: (left, right).
pub type Sound = (Vec<f32>, Vec<f32>);

/// Stores a reading's audio and its sentences' takes (those with audio of their own), then lists them all.
pub fn add_reading(
    root: &Path,
    audio: &str,
    reading: Reading,
    whole: &Sound,
    takes: Vec<(Take, Option<Sound>)>,
) -> Result<(), String> {
    let _w = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    // 自己读 played nothing: only you, one channel.
    let alone = reading.mode == Mode::Read;
    write_wav(root, audio, &reading.id, (&whole.0, &whole.1), alone)?;
    for (t, sound) in &takes {
        if let Some((l, r)) = sound {
            write_wav(root, audio, &t.id, (l, r), in_turns(t.mode))?;
        }
    }
    let mut file = load(root, audio);
    file.takes.extend(takes.into_iter().map(|t| t.0));
    file.readings.push(reading);
    write(root, audio, &file)
}

pub fn delete(root: &Path, audio: &str, id: &str) -> Result<(), String> {
    valid(id)?;
    let _w = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let mut file = load(root, audio);
    let Some(gone) = file.takes.iter().position(|t| t.id == id) else {
        return Err(take_gone().into());
    };
    let own_file = file.takes.remove(gone).source.is_none();
    for r in &mut file.readings {
        for p in &mut r.parts {
            if p.take.as_deref() == Some(id) {
                p.take = None;
            }
        }
    }
    write(root, audio, &file)?;
    if own_file {
        let _ = fs::remove_file(wav_path(root, audio, id));
    }
    Ok(())
}

/// Deletes a reading and the sentence takes cut from it.
pub fn delete_reading(root: &Path, audio: &str, id: &str) -> Result<(), String> {
    valid(id)?;
    let _w = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let mut file = load(root, audio);
    if !file.readings.iter().any(|r| r.id == id) {
        return Err(reading_gone().into());
    }
    let gone: Vec<String> = file
        .takes
        .iter()
        .filter(|t| t.group.as_deref() == Some(id))
        .map(|t| t.id.clone())
        .collect();
    file.takes.retain(|t| t.group.as_deref() != Some(id));
    file.readings.retain(|r| r.id != id);
    write(root, audio, &file)?;
    for g in gone.iter().map(String::as_str).chain([id]) {
        let _ = fs::remove_file(wav_path(root, audio, g));
    }
    Ok(())
}

#[cfg(test)]
#[path = "saved_tests.rs"]
mod tests;
