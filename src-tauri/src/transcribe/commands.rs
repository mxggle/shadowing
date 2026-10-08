//! The `transcribe_*` commands: one job at a time on its own thread, with the
//! service chosen in settings, then who is speaking (`speakers`).

use super::{chunk, cloud, run, Job, Status, Step, CANCELLED};
use crate::ai::secrets::Secrets;
use crate::ai::Target;
use crate::transcript::{self, Source, Transcript};
use crate::{local, AppState};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Jobs(Mutex<Option<Running>>);

struct Running {
    path: String,
    cancel: Arc<AtomicBool>,
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
    let models = local::models_dir(&state);
    let language = Some(language.trim().to_string()).filter(|l| !l.is_empty());

    let spawned = std::thread::Builder::new()
        .name("transcribe".into())
        .spawn(move || {
            let emit = {
                let app = app.clone();
                move |status: Status| drop(app.emit("transcribe:status", status))
            };
            let progress = |step| {
                let (emit, path) = (emit.clone(), path.clone());
                Arc::new(move |done, total| {
                    emit(Status::Running {
                        path: path.clone(),
                        step,
                        done,
                        total,
                    })
                })
            };
            let job = Job {
                audio: &audio,
                language: language.as_deref(),
                plan: chunk::DEFAULT,
                cancel: cancel.clone(),
            };
            let transcribing = progress(Step::Transcribe);
            let result = match backend {
                Backend::Cloud(target) => {
                    let mut t = cloud::Cloud::new(&target, &choice.model);
                    run(&job, &mut t, transcribing)
                }
                Backend::Local(file) => local::whisper::Whisper::load(&file, &choice.model)
                    .and_then(|mut t| run(&job, &mut t, transcribing)),
            };
            // A trial run only shows that transcription works; skip the extra wait.
            let result = result.and_then(|mut sentences| {
                if keep {
                    let total = sentences.last().map_or(0.0, |s| s.end);
                    let finding = progress(Step::Speakers);
                    finding(0.0, total);
                    crate::speakers::find(&models, &audio, &mut sentences, &cancel, |done| {
                        finding(done, total)
                    })?;
                }
                Ok(sentences)
            });
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
