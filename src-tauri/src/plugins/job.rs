//! One download (`import/run`): the plugin writes into a staging folder, then
//! the audio is moved into the open folder and the subtitles kept (accept.rs).

use super::accept::{self, Made};
use super::import::{open, progress_of, Status};
use super::manifest::Importer;
use super::rpc::CANCELLED;
use super::Installed;
use crate::transcript::{self, Source};
use crate::AppState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Deserialize)]
struct RunResult {
    #[serde(default)]
    title: String,
    files: Vec<Made>,
}

pub struct Job {
    pub plugin: Installed,
    pub importer: Importer,
    pub url: String,
    pub title: String,
    pub subtitles: Option<String>,
    /// The open folder, and the subfolder of it the audio goes in.
    pub root: PathBuf,
    pub folder: String,
    /// Where the plugin writes; emptied afterwards.
    pub staging: PathBuf,
    pub cancel: Arc<AtomicBool>,
}

impl Job {
    pub fn run(&self, app: &AppHandle) -> Status {
        let _ = std::fs::remove_dir_all(&self.staging);
        let result = std::fs::create_dir_all(&self.staging)
            .map_err(|e| e.to_string())
            .and_then(|_| self.download(app))
            .and_then(|(title, picked)| self.keep(app, &title, picked));
        let _ = std::fs::remove_dir_all(&self.staging);
        let title = self.title.clone();
        match result {
            Ok(done) => done,
            Err(e) if e == CANCELLED => Status::Cancelled { title },
            Err(message) => Status::Failed { title, message },
        }
    }

    /// The plugin's title for what it downloaded (else the one shown before), and its files.
    fn download(&self, app: &AppHandle) -> Result<(String, accept::Picked), String> {
        let mut process = open(app, &self.plugin, &self.cancel)?;
        let mut notify = |method: &str, params: &Value| {
            if let Some((message, done, total)) = progress_of(method, params) {
                let title = self.title.clone();
                let status = Status::Downloading {
                    title,
                    message,
                    done,
                    total,
                };
                let _ = app.emit("import:status", status);
            }
        };
        let params = json!({
            "url": self.url,
            "importer": self.importer.id,
            "outDir": self.staging,
            "subtitles": self.subtitles,
        });
        let answer = process.call("import/run", params, &self.cancel, &mut notify)?;
        let result: RunResult = serde_json::from_value(answer).map_err(|e| {
            crate::tr!(
                "插件的回答看不懂：{e}",
                "Couldn’t read the plugin’s answer: {e}"
            )
        })?;
        let title = Some(result.title)
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| self.title.clone());
        Ok((title, accept::pick(&self.staging, &result.files)?))
    }

    /// Moves the audio in; subtitles become the track's imported transcript (removable,
    /// unlike a file next to the audio, so the learner can transcribe instead).
    fn keep(&self, app: &AppHandle, title: &str, picked: accept::Picked) -> Result<Status, String> {
        let state = app.state::<AppState>();
        let dest = accept::place(&picked.audio, &self.root, &self.folder, title)?;
        let audio = state.audio(&dest.to_string_lossy())?;
        let key = audio.to_string_lossy().into_owned();
        let mut subtitles = false;
        if let Some((file, lang)) = picked.subtitle {
            // The audio is in; subtitles that won't read are only a missed extra.
            if let Ok(mut t) = transcript::read_subtitle(&file, Source::Imported) {
                let via = &self.importer.title;
                t.origin = match lang.as_str() {
                    "" => format!("{via} 字幕"),
                    lang => format!("{via} 字幕 · {lang}"),
                };
                let dir = state.data_dir().join("transcripts");
                subtitles = !t.sentences.is_empty() && transcript::save(&dir, &key, &t).is_ok();
            }
        }
        Ok(Status::Done {
            title: title.to_string(),
            path: key,
            subtitles,
        })
    }
}
