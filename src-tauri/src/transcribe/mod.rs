//! A track's audio → transcript, via the transcription service chosen in
//! settings. One job at a time on its own thread; progress and the result go
//! out as `transcribe:status` events, and the transcript is saved like an
//! imported one.

mod chunk;
mod cloud;
mod pcm;
pub mod sentences;
#[cfg(test)]
mod tests;

use crate::ai::secrets::Secrets;
use crate::ai::Target;
use crate::transcript::{self, Sentence, Source, Transcript};
use crate::{library, AppState};
use chunk::ChunkPlan;
use pcm::RATE;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
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

pub struct Job<'a> {
    pub audio: &'a Path,
    pub target: &'a Target,
    pub model: &'a str,
    pub language: Option<&'a str>,
    pub plan: ChunkPlan,
    pub cancel: &'a AtomicBool,
}

/// Pieces quieter than this (RMS) are not worth a request.
const SILENT_RMS: f32 = 1e-4;

/// Decode → cut into pieces at pauses → upload each → sentences.
/// `progress(done, total)` is called in seconds of audio.
pub fn run(job: &Job, mut progress: impl FnMut(f64, f64)) -> Result<Vec<Sentence>, String> {
    let mut pcm = pcm::Pcm16k::open(job.audio)?;
    let total = pcm.duration.unwrap_or(0.0);
    let endpoint = job.target.endpoint();
    let max = job.plan.max_samples();
    let mut buf: Vec<f32> = Vec::with_capacity(max + 4096);
    let mut sent = 0usize;
    let mut more = true;
    let mut pieces = Vec::new();
    let mut prompt = String::new();
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
        let piece: Vec<f32> = buf.drain(..cut).collect();
        let start = sent as f64 / f64::from(RATE);
        sent += piece.len();
        if job.cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        let rms = (piece.iter().map(|s| s * s).sum::<f32>() / piece.len().max(1) as f32).sqrt();
        if rms > SILENT_RMS {
            let req = cloud::Request {
                model: job.model,
                language: job.language,
                prompt: &prompt,
            };
            let wav = pcm::wav_bytes(&piece);
            let verbose = tauri::async_runtime::block_on(async {
                tokio::select! {
                    r = cloud::transcribe(&endpoint, &req, &wav) => r,
                    _ = cancelled(job.cancel) => Err(CANCELLED.into()),
                }
            })?;
            let text: String = verbose.segments.iter().map(|s| s.text.as_str()).collect();
            prompt = cloud::tail_prompt(&text);
            pieces.push((start, verbose));
        }
        let done = sent as f64 / f64::from(RATE);
        progress(done, total.max(done));
    }

    let sentences = sentences::build(pieces);
    if sentences.is_empty() {
        return Err("没有识别出语音".into());
    }
    Ok(sentences)
}

async fn cancelled(flag: &AtomicBool) {
    while !flag.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Starts transcribing a track with the service chosen in settings.
/// `language`: ISO-639-1 code, or "" to let the model detect it.
#[tauri::command]
pub fn transcribe_start(
    app: AppHandle,
    state: State<AppState>,
    secrets: State<Secrets>,
    jobs: State<Jobs>,
    path: String,
    language: String,
) -> Result<(), String> {
    let root = state.root().ok_or("尚未选择文件夹")?;
    let audio = library::resolve_inside(&root, Path::new(&path))
        .filter(|p| library::is_audio(p))
        .ok_or("无法访问此文件")?;
    let choice = state.read(|d| d.ai.transcribe.clone());
    let provider = choice.provider.ok_or("还没有设置转写服务")?;
    if choice.model.is_empty() {
        return Err("还没有选择转写模型".into());
    }
    let target = Target::resolve(&state, &secrets, &provider)?;
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
    let origin = format!("{} · {}", target.preset.name, choice.model);
    let language = Some(language.trim().to_string()).filter(|l| !l.is_empty());

    let spawned = std::thread::Builder::new()
        .name("transcribe".into())
        .spawn(move || {
            let emit = |status: Status| drop(app.emit("transcribe:status", status));
            let job = Job {
                audio: &audio,
                target: &target,
                model: &choice.model,
                language: language.as_deref(),
                plan: chunk::CLOUD,
                cancel: &cancel,
            };
            let result = run(&job, |done, total| {
                emit(Status::Running {
                    path: path.clone(),
                    done,
                    total,
                })
            });
            let status = match result {
                Ok(sentences) => {
                    let transcript = Transcript {
                        source: Source::Transcribed,
                        origin,
                        sentences,
                    };
                    match transcript::save(&dir, &key, &transcript) {
                        Ok(()) => Status::Done {
                            path: path.clone(),
                            transcript,
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
