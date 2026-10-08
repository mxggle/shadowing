//! A track's audio → transcript, with the service chosen in settings (a cloud
//! Whisper API, or whisper.cpp on this Mac). One job at a time on its own
//! thread; progress and the result go out as `transcribe:status` events, and
//! the transcript is saved like an imported one.

pub mod chunk;
pub mod cloud;
pub mod pcm;
pub mod sentences;
mod snap;
#[cfg(test)]
mod tests;

use crate::ai::secrets::Secrets;
use crate::ai::Target;
use crate::transcript::{self, Sentence, Source, Transcript};
use crate::{local, AppState};
use chunk::ChunkPlan;
use pcm::RATE;
use sentences::Verbose;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

pub const CANCELLED: &str = "已取消";

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

#[derive(Default)]
pub struct Jobs(Mutex<Option<Running>>);

struct Running {
    path: String,
    cancel: Arc<AtomicBool>,
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
            let piece = Piece {
                samples: &samples,
                language: job.language,
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

    let mut sentences = sentences::build(pieces);
    if sentences.is_empty() {
        return Err("没有识别出语音".into());
    }
    snap::snap(&mut sentences, &meter.db);
    Ok(sentences)
}

enum Backend {
    Cloud(Target),
    Local(PathBuf),
}

/// Starts transcribing a track with the service chosen in settings.
/// `language`: ISO-639-1 code, or "" to let the model detect it.
/// `keep`: save the result as the track's transcript (false for a trial run).
#[tauri::command]
pub fn transcribe_start(
    app: AppHandle,
    state: State<AppState>,
    secrets: State<Secrets>,
    jobs: State<Jobs>,
    path: String,
    language: String,
    keep: bool,
) -> Result<(), String> {
    let audio = state.audio(&path)?;
    let choice = state.read(|d| d.ai.transcribe.clone());
    let provider = choice.provider.ok_or("还没有设置转写服务")?;
    if choice.model.is_empty() {
        return Err("还没有选择转写模型".into());
    }
    let (backend, origin) = if provider == local::PROVIDER {
        let file = local::model_file(&state, &choice.model).ok_or("这个模型还没有下载完")?;
        (Backend::Local(file), format!("本机 · {}", choice.model))
    } else {
        let target = Target::resolve(&state, &secrets, &provider)?;
        let origin = format!("{} · {}", target.preset.name, choice.model);
        (Backend::Cloud(target), origin)
    };
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut current = jobs.0.lock().unwrap();
        if current.is_some() {
            return Err("已经有一个音频在转写，请等它完成".into());
        }
        *current = Some(Running {
            path: path.clone(),
            cancel: cancel.clone(),
        });
    }
    let key = audio.to_string_lossy().into_owned();
    let dir = state.data_dir().join("transcripts");
    let language = Some(language.trim().to_string()).filter(|l| !l.is_empty());

    let spawned = std::thread::Builder::new()
        .name("transcribe".into())
        .spawn(move || {
            let emit = {
                let app = app.clone();
                move |status: Status| drop(app.emit("transcribe:status", status))
            };
            let progress = {
                let (emit, path) = (emit.clone(), path.clone());
                Arc::new(move |done, total| {
                    emit(Status::Running {
                        path: path.clone(),
                        done,
                        total,
                    })
                })
            };
            let job = Job {
                audio: &audio,
                language: language.as_deref(),
                plan: chunk::DEFAULT,
                cancel,
            };
            let result = match backend {
                Backend::Cloud(target) => {
                    let mut t = cloud::Cloud::new(&target, &choice.model);
                    run(&job, &mut t, progress)
                }
                Backend::Local(file) => local::whisper::Whisper::load(&file)
                    .and_then(|mut t| run(&job, &mut t, progress)),
            };
            let status = match result {
                Ok(sentences) => {
                    let transcript = Transcript {
                        source: Source::Transcribed,
                        origin,
                        sentences,
                    };
                    let saved = if keep {
                        transcript::save(&dir, &key, &transcript)
                    } else {
                        Ok(())
                    };
                    match saved {
                        Ok(()) => Status::Done {
                            path: path.clone(),
                            transcript,
                            saved: keep,
                        },
                        Err(e) => Status::Failed {
                            path: path.clone(),
                            message: format!("字幕保存失败：{e}"),
                        },
                    }
                }
                Err(m) if m == CANCELLED => Status::Cancelled { path: path.clone() },
                Err(message) => Status::Failed {
                    path: path.clone(),
                    message,
                },
            };
            // Free the slot before announcing, so the UI can start the next one straight away.
            app.state::<Jobs>().0.lock().unwrap().take();
            emit(status);
        });
    if let Err(e) = spawned {
        jobs.0.lock().unwrap().take();
        return Err(e.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn transcribe_cancel(jobs: State<Jobs>) {
    if let Some(job) = jobs.0.lock().unwrap().as_ref() {
        job.cancel.store(true, Ordering::Relaxed);
    }
}

/// The track being transcribed, if any (for a UI that was reloaded mid-job).
#[tauri::command]
pub fn transcribe_running(jobs: State<Jobs>) -> Option<String> {
    jobs.0.lock().unwrap().as_ref().map(|j| j.path.clone())
}
