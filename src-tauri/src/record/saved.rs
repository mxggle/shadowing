//! Takes kept between runs, in app data: `recordings/<track hash>/` holds a
//! stereo WAV per take (left the original as heard, right you) and
//! `takes.json` listing them, newest last. Nothing is written beside the
//! audio files; a take outlives later edits to its sentence (it keeps the text
//! it was recorded against).

use super::take::{Mode, RATE};
use crate::store::write_atomic;
use crate::transcript::fnv1a;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Takes may finish while another is deleted; each change rewrites the list.
static WRITING: Mutex<()> = Mutex::new(());

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
}

pub fn dir(root: &Path, audio: &str) -> PathBuf {
    root.join("recordings")
        .join(format!("{:016x}", fnv1a(audio.as_bytes())))
}

pub fn wav_path(root: &Path, audio: &str, id: &str) -> PathBuf {
    dir(root, audio).join(format!("{id}.wav"))
}

pub fn list(root: &Path, audio: &str) -> Vec<Take> {
    let Ok(text) = fs::read_to_string(dir(root, audio).join("takes.json")) else {
        return Vec::new();
    };
    match serde_json::from_str::<File>(&text) {
        Ok(f) if f.audio == audio => f.takes,
        _ => Vec::new(),
    }
}

fn write(root: &Path, audio: &str, takes: Vec<Take>) -> Result<(), String> {
    let file = File {
        version: 1,
        audio: audio.to_string(),
        takes,
    };
    let json = serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?;
    write_atomic(&dir(root, audio).join("takes.json"), &json)
        .map_err(|e| format!("录音没有保存：{e}"))
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
    write_atomic(
        &wav_path(root, audio, &take.id),
        &stereo_wav(original, mine),
    )
    .map_err(|e| format!("录音没有保存：{e}"))?;
    let mut takes = list(root, audio);
    takes.push(take);
    write(root, audio, takes)
}

pub fn delete(root: &Path, audio: &str, id: &str) -> Result<(), String> {
    let _w = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let mut takes = list(root, audio);
    takes.retain(|t| t.id != id);
    write(root, audio, takes)?;
    let _ = fs::remove_file(wav_path(root, audio, id));
    Ok(())
}

/// 16-bit stereo WAV at `RATE`: left `l`, right `r` (the shorter one padded).
pub fn stereo_wav(l: &[f32], r: &[f32]) -> Vec<u8> {
    let frames = l.len().max(r.len());
    let data_len = (frames * 4) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&2u16.to_le_bytes()); // stereo
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 4).to_le_bytes());
    out.extend_from_slice(&4u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    let pcm = |x: Option<&f32>| {
        ((x.copied().unwrap_or(0.0).clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes()
    };
    for i in 0..frames {
        out.extend_from_slice(&pcm(l.get(i)));
        out.extend_from_slice(&pcm(r.get(i)));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::decode::Decoder;

    fn take(id: &str) -> Take {
        Take {
            id: id.into(),
            created: 1,
            start: 1.0,
            end: 2.5,
            text: "こんにちは".into(),
            mode: Mode::Listen,
            rate: 0.85,
            duration: 0.5,
            original: (0.0, 0.2),
            mine: (0.25, 0.5),
            lag_ms: None,
            peaks: Peaks {
                original: vec![1, 2],
                mine: vec![3],
            },
        }
    }

    #[test]
    fn add_list_delete() {
        let root = tempfile::tempdir().unwrap();
        let audio = "/music/a.mp3";
        assert!(list(root.path(), audio).is_empty());
        let (l, r) = (vec![0.5; 16_000], vec![-0.25; 8_000]);
        add(root.path(), audio, take("t1"), &l, &r).unwrap();
        add(root.path(), audio, take("t2"), &l, &r).unwrap();
        assert_eq!(
            list(root.path(), audio)
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            ["t1", "t2"]
        );
        assert!(list(root.path(), "/music/b.mp3").is_empty(), "per track");

        // The file reads back: stereo, 32 kHz, left and right as written.
        let mut d = Decoder::open(&wav_path(root.path(), audio, "t1")).unwrap();
        assert_eq!((d.sample_rate, d.channels), (RATE, 2));
        let mut buf = vec![0.0; 2 * 4];
        d.read(&mut buf).unwrap();
        assert!((buf[0] - 0.5).abs() < 1e-3 && (buf[1] + 0.25).abs() < 1e-3);

        delete(root.path(), audio, "t1").unwrap();
        assert_eq!(list(root.path(), audio).len(), 1);
        assert!(!wav_path(root.path(), audio, "t1").exists());
    }
}
