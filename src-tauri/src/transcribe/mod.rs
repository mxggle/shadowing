//! A track's audio → transcript, with the service chosen in settings (a cloud
//! Whisper API, or whisper.cpp on this Mac). One job at a time on its own
//! thread; progress and the result go out as `transcribe:status` events, and
//! the transcript is saved like an imported one.

pub mod chunk;
pub mod cloud;
pub mod commands;
mod doubt;
mod long;
pub mod pcm;
pub mod sentences;
pub(crate) mod snap;
#[cfg(test)]
mod tests;

use crate::transcript::{Sentence, Transcript};
use chunk::ChunkPlan;
use pcm::RATE;
use sentences::Verbose;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub const CANCELLED: &str = "已取消";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Transcribe,
    Speakers,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Status {
    /// `done` / `total` in seconds of audio (total is 0 when unknown).
    Running {
        path: String,
        step: Step,
        done: f64,
        total: f64,
    },
    Done {
        path: String,
        transcript: Transcript,
        /// False for a trial run (the setup wizard's test on the sample).
        saved: bool,
    },
    Failed {
        path: String,
        message: String,
    },
    Cancelled {
        path: String,
    },
}

/// One piece of 16 kHz mono audio to transcribe.
pub struct Piece<'a> {
    pub samples: &'a [f32],
    /// ISO-639-1 ("ja", "en"); None lets the model detect it.
    pub language: Option<&'a str>,
    /// The end of the previous piece, so the model keeps context and spelling.
    pub prompt: &'a str,
    pub cancel: &'a Arc<AtomicBool>,
}

/// How far into the current piece the transcriber is, 0–1.
pub type PieceProgress = Arc<dyn Fn(f64) + Send + Sync>;

/// A cloud API or the local engine: one piece in, Whisper-style output out.
pub trait Transcriber {
    fn transcribe(&mut self, piece: &Piece, progress: PieceProgress) -> Result<Verbose, String>;

    /// The language spoken (ISO-639-1), if this transcriber can tell before transcribing.
    fn detect_language(&mut self, _samples: &[f32]) -> Option<String> {
        None
    }
}

pub struct Job<'a> {
    pub audio: &'a Path,
    pub language: Option<&'a str>,
    pub plan: ChunkPlan,
    pub cancel: Arc<AtomicBool>,
}

/// Pieces quieter than this (RMS) are not worth transcribing.
const SILENT_RMS: f32 = 1e-4;

/// Decode → cut into pieces at pauses → transcribe each → sentences.
/// `progress(done, total)` is called in seconds of audio.
pub fn run(
    job: &Job,
    transcriber: &mut dyn Transcriber,
    progress: Arc<dyn Fn(f64, f64) + Send + Sync>,
) -> Result<Vec<Sentence>, String> {
    let mut pcm = pcm::Pcm16k::open(job.audio)?;
    let total = pcm.duration.unwrap_or(0.0);
    let max = job.plan.max_samples();
    let mut buf: Vec<f32> = Vec::with_capacity(max + 4096);
    let mut sent = 0usize;
    let mut more = true;
    let mut pieces = Vec::new();
    let mut language = job.language.map(str::to_string);
    let mut prompt = cloud::style_prompt(job.language);
    let mut meter = snap::Meter::default();
    progress(0.0, total);

    while more || !buf.is_empty() {
        while more && buf.len() < max {
            more = pcm.read_into(&mut buf)?;
        }
        let cut = if more {
            job.plan.cut(&buf[..max])
        } else {
            buf.len()
        };
        let samples: Vec<f32> = buf.drain(..cut).collect();
        meter.push(&samples);
        let start = sent as f64 / f64::from(RATE);
        sent += samples.len();
        let end = sent as f64 / f64::from(RATE);
        if job.cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len().max(1) as f32).sqrt();
        if rms > SILENT_RMS {
            if language.is_none() && pieces.is_empty() {
                // Knowing the language picks a punctuated example prompt; without
                // one, Whisper tends to leave Japanese and English unpunctuated.
                language = transcriber.detect_language(&samples);
                prompt = cloud::style_prompt(language.as_deref());
            }
            let piece = Piece {
                samples: &samples,
                language: language.as_deref(),
                prompt: &prompt,
                cancel: &job.cancel,
            };
            let overall = progress.clone();
            let total = total.max(end);
            let within: PieceProgress =
                Arc::new(move |f| overall(start + (end - start) * f, total));
            let verbose = transcriber.transcribe(&piece, within)?;
            let text: String = verbose.segments.iter().map(|s| s.text.as_str()).collect();
            prompt = cloud::tail_prompt(&text);
            pieces.push((start, verbose));
        }
        progress(end, total.max(end));
    }

    let mut sentences = sentences::build(pieces, &meter.db);
    if sentences.is_empty() {
        return Err("没有识别出语音".into());
    }
    snap::snap(&mut sentences, &meter.db);
    Ok(sentences)
}
