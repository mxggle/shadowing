//! Who is speaking. Each sentence gets a voice fingerprint from a small
//! speaker-embedding model (3D-Speaker CAM++, run on the CPU with tract), and
//! sentences with alike voices are grouped (`cluster.rs`). Best effort: when
//! the model can't be had, the transcript simply has no speakers.

mod cluster;
mod fbank;

use crate::local::download::{self, Spec};
use crate::transcribe::cancelled_error;
use crate::transcribe::pcm::{Pcm16k, RATE};
use crate::transcript::Sentence;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tract_onnx::prelude::*;

/// 3D-Speaker's CAM++ (Apache-2.0; trained on 200k Chinese and English
/// speakers, works for other languages too) as exported to ONNX by sherpa-onnx.
const URL: &str = "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/0743f301363dec56491a490f6d6cbc9d67f9a3bf/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx";
const FILE: &str = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx";
const SIZE: u64 = 28_281_164;
const SHA256: &str = "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2";

/// Shortest sentence worth a fingerprint, and the most of a long one listened to.
const MIN_SECS: f64 = 0.3;
const MAX_SECS: f64 = 8.0;
/// Sentences are fingerprinted in batches of about this much audio, spread over the CPU cores.
const BATCH_SECS: f64 = 120.0;

/// Labels `sentences` with speakers, downloading the model (28 MB, checked)
/// into `dir` the first time. Errors other than cancelling leave them unlabelled.
pub fn find(
    dir: &Path,
    audio: &Path,
    sentences: &mut [Sentence],
    cancel: &AtomicBool,
    progress: impl Fn(f64),
) -> Result<(), String> {
    let found = model(dir, cancel)
        .and_then(|file| Voices::load(&file))
        .and_then(|voices| label(&voices, audio, sentences, cancel, progress));
    match found {
        Err(_) if cancel.load(Ordering::Relaxed) => Err(cancelled_error()),
        Err(e) => {
            eprintln!("speakers not identified: {e}");
            Ok(())
        }
        Ok(()) => Ok(()),
    }
}

fn model(dir: &Path, cancel: &AtomicBool) -> Result<PathBuf, String> {
    let dest = dir.join(FILE);
    if !dest.is_file() {
        let spec = Spec {
            url: URL,
            dest: &dest,
            size: SIZE,
            sha256: SHA256,
        };
        tauri::async_runtime::block_on(download::download(&spec, cancel, |_, _| {}))?;
    }
    Ok(dest)
}

pub struct Voices(Arc<TypedRunnableModel>);

impl Voices {
    pub fn load(file: &Path) -> Result<Self, String> {
        let load = || -> TractResult<Arc<TypedRunnableModel>> {
            let model = tract_onnx::onnx().model_for_path(file)?;
            let frames = model.symbols.sym("T");
            let input = f32::fact([1.to_dim(), frames.to_dim(), fbank::BINS.to_dim()]);
            model
                .with_input_fact(0, input.into())?
                .into_optimized()?
                .into_runnable()
        };
        load().map(Self).map_err(|e| {
            tr!(
                "说话人识别模型无法加载：{e}",
                "Couldn't load the speaker model: {e}"
            )
        })
    }

    /// A voice fingerprint for a stretch of 16 kHz speech.
    fn fingerprint(&self, samples: &[f32]) -> Option<Vec<f32>> {
        let rows = fbank::fbank(samples);
        if rows.is_empty() {
            return None;
        }
        let flat: Vec<f32> = rows.iter().flatten().copied().collect();
        let input =
            tract_ndarray::Array3::from_shape_vec((1, rows.len(), fbank::BINS), flat).ok()?;
        let out = self.0.run(tvec!(input.into_tensor().into())).ok()?;
        let view = out[0].to_plain_array_view::<f32>().ok()?;
        Some(view.iter().copied().collect())
    }
}

/// Fills in `speaker` on each sentence (left `None` when only one voice is
/// heard). Decodes the audio again, a little at a time. `progress(done)` in
/// seconds of audio.
pub fn label(
    voices: &Voices,
    audio: &Path,
    sentences: &mut [Sentence],
    cancel: &AtomicBool,
    progress: impl Fn(f64),
) -> Result<(), String> {
    let at = |t: f64| (t.max(0.0) * f64::from(RATE)) as usize;
    let mut pcm = Pcm16k::open(audio)?;
    let mut buf: Vec<f32> = Vec::new();
    let mut buf_at = 0; // sample index of buf[0]
    let mut more = true;
    let mut prints: Vec<Option<Vec<f32>>> = vec![None; sentences.len()];
    let mut batch: Vec<(usize, Vec<f32>)> = Vec::new();
    let mut batched = 0;
    for (i, s) in sentences.iter().enumerate() {
        let len = s.end - s.start;
        if len >= MIN_SECS {
            // The middle of a long sentence is enough to know the voice.
            let trim = (len - MAX_SECS).max(0.0) / 2.0;
            let (a, b) = (at(s.start + trim), at(s.end - trim));
            // Sentence starts never go back, so the audio before this one can go.
            let gone = a.saturating_sub(buf_at).min(buf.len());
            buf.drain(..gone);
            buf_at += gone;
            while more && buf_at + buf.len() < b {
                more = pcm.read_into(&mut buf)?;
            }
            let lo = a.saturating_sub(buf_at).min(buf.len());
            let hi = b.saturating_sub(buf_at).min(buf.len());
            batch.push((i, buf[lo..hi].to_vec()));
            batched += hi - lo;
        }
        let last = i + 1 == sentences.len();
        if batched as f64 >= BATCH_SECS * f64::from(RATE) || (last && !batch.is_empty()) {
            if cancel.load(Ordering::Relaxed) {
                return Err(cancelled_error());
            }
            fingerprint_all(voices, &mut batch, &mut prints);
            batched = 0;
            progress(s.end);
        }
    }
    let secs: Vec<f64> = sentences.iter().map(|s| s.end - s.start).collect();
    for (s, who) in sentences.iter_mut().zip(cluster::assign(&prints, &secs)) {
        s.speaker = who;
    }
    Ok(())
}

/// Runs the model on every queued sentence, one thread per core.
fn fingerprint_all(
    voices: &Voices,
    batch: &mut Vec<(usize, Vec<f32>)>,
    prints: &mut [Option<Vec<f32>>],
) {
    let workers = std::thread::available_parallelism().map_or(4, |n| n.get().min(8));
    let queued = &*batch;
    let done: Vec<(usize, Option<Vec<f32>>)> = std::thread::scope(|scope| {
        let threads: Vec<_> = (0..workers)
            .map(|w| {
                scope.spawn(move || {
                    queued
                        .iter()
                        .skip(w)
                        .step_by(workers)
                        .map(|(i, samples)| (*i, voices.fingerprint(samples)))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        threads
            .into_iter()
            .flat_map(|t| t.join().unwrap_or_default())
            .collect()
    });
    for (i, print) in done {
        prints[i] = print;
    }
    batch.clear();
}
