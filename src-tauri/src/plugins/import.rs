//! 从链接导入: finds the plugin that takes a link, asks it what the link is
//! (`import/resolve`), then has it download into a staging folder
//! (`import/run`) and moves the result into the open folder (accept.rs).
//! One import at a time; progress goes out as `import:status`.

use super::accept::{self, Made};
use super::manifest::Importer;
use super::rpc::{Process, CANCELLED};
use super::{importer_for, Installed};
use crate::transcript::{self, Source};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// The import running now (resolving or downloading), to cancel it.
#[derive(Default)]
pub struct Imports(Mutex<Option<Arc<AtomicBool>>>);

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Status {
    /// Finding out what the link is (the first time also fetching the plugin's tools).
    Resolving {
        message: String,
        done: u64,
        total: u64,
    },
    Downloading {
        title: String,
        message: String,
        done: u64,
        total: u64,
    },
    Done {
        title: String,
        path: String,
        subtitles: bool,
    },
    Failed {
        title: String,
        message: String,
    },
    Cancelled {
        title: String,
    },
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
    pub lang: String,
    #[serde(default)]
    pub name: String,
}

/// What a link is, for the confirmation before downloading.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub title: String,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub uploader: Option<String>,
    /// The language spoken, when the site says.
    #[serde(default)]
    pub language: Option<String>,
    /// Subtitles people wrote (not automatic captions).
    #[serde(default)]
    pub subtitles: Vec<SubtitleTrack>,
    /// Filled in by the app: the plugin's name and the importer's title.
    #[serde(default)]
    pub plugin: String,
    #[serde(default)]
    pub via: String,
}

#[derive(Deserialize)]
struct RunResult {
    #[serde(default)]
    title: String,
    files: Vec<Made>,
}

/// Claims the one import slot; `None` while another import runs.
fn claim(imports: &Imports) -> Option<Arc<AtomicBool>> {
    let mut slot = imports.0.lock().unwrap();
    if slot.is_some() {
        return None;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *slot = Some(cancel.clone());
    Some(cancel)
}

fn release(app: &AppHandle) {
    *app.state::<Imports>().0.lock().unwrap() = None;
}

const BUSY: &str = "正在导入另一个链接，请等它完成";

fn no_plugin(url: &str) -> String {
    if url.contains("youtube.com") || url.contains("youtu.be") {
        "还没有能导入 YouTube 链接的插件。在 设置 → 插件 里安装 YouTube 导入插件。".into()
    } else {
        "没有能导入这个链接的插件".into()
    }
}

/// Starts the plugin in its `data/` folder and says hello.
fn open(app: &AppHandle, plugin: &Installed, cancel: &AtomicBool) -> Result<Process, String> {
    let data = plugin.data_dir();
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let mut process = Process::spawn(&plugin.program()?, &data)?;
    let params = json!({
        "protocol": super::manifest::PROTOCOL,
        "appVersion": app.package_info().version.to_string(),
        "dataDir": data,
    });
    process.call("initialize", params, cancel, &mut |_, _| {})?;
    Ok(process)
}

/// `progress` notes as (message, done, total).
fn progress_of(method: &str, params: &Value) -> Option<(String, u64, u64)> {
    if method == "log" {
        if cfg!(debug_assertions) {
            println!("[plugin log] {params}");
        }
        return None;
    }
    (method == "progress").then(|| {
        let text = params["message"].as_str().unwrap_or_default().to_string();
        let n = |key: &str| params[key].as_u64().unwrap_or(0);
        (text, n("done"), n("total"))
    })
}

/// Text on the clipboard when it looks like one web link (⌘V outside a text field).
#[tauri::command(async)]
pub fn import_clipboard() -> Option<String> {
    let out = std::process::Command::new("/usr/bin/pbpaste")
        .output()
        .ok()?;
    let text = String::from_utf8(out.stdout).ok()?;
    let text = text.trim();
    let link = (text.starts_with("https://") || text.starts_with("http://"))
        && text.len() < 2048
        && !text.contains(char::is_whitespace);
    link.then(|| text.to_string())
}

#[tauri::command(async)]
pub fn import_resolve(
    app: AppHandle,
    state: State<AppState>,
    imports: State<Imports>,
    url: String,
) -> Result<Resolved, String> {
    let url = url.trim().to_string();
    let (plugin, importer) = importer_for(&state, &url).ok_or_else(|| no_plugin(&url))?;
    let cancel = claim(&imports).ok_or(BUSY)?;
    let result = (|| {
        let mut process = open(&app, &plugin, &cancel)?;
        let mut notify = |method: &str, params: &Value| {
            if let Some((message, done, total)) = progress_of(method, params) {
                let _ = app.emit(
                    "import:status",
                    Status::Resolving {
                        message,
                        done,
                        total,
                    },
                );
            }
        };
        let answer = process.call(
            "import/resolve",
            json!({ "url": url, "importer": importer.id }),
            &cancel,
            &mut notify,
        )?;
        let mut resolved: Resolved =
            serde_json::from_value(answer).map_err(|e| format!("插件的回答看不懂：{e}"))?;
        resolved.plugin = plugin.manifest.name.clone();
        resolved.via = importer.title.clone();
        Ok(resolved)
    })();
    release(&app);
    result
}

/// Downloads in the background; the outcome arrives as `import:status`.
/// `subtitles`: language of the subtitles to bring along, if any.
/// `folder`: subfolder of the open folder to put the audio in ("" = the folder itself).
#[tauri::command]
pub fn import_start(
    app: AppHandle,
    state: State<AppState>,
    imports: State<Imports>,
    url: String,
    title: String,
    subtitles: Option<String>,
    folder: String,
) -> Result<(), String> {
    let root = state
        .root()
        .ok_or("请先打开一个文件夹，导入的音频会放在里面")?;
    let url = url.trim().to_string();
    let (plugin, importer) = importer_for(&state, &url).ok_or_else(|| no_plugin(&url))?;
    let cancel = claim(&imports).ok_or(BUSY)?;
    let staging = super::root(&state).join(".jobs").join(format!(
        "{}-{}",
        plugin.manifest.id,
        crate::now_secs()
    ));
    let job = Job {
        plugin,
        importer,
        url,
        title,
        subtitles,
        root,
        folder,
        staging,
        cancel,
    };
    let spawned = std::thread::Builder::new().name("import".into()).spawn({
        let app = app.clone();
        move || {
            let status = job.run(&app);
            release(&app);
            let _ = app.emit("import:status", status);
        }
    });
    if let Err(e) = spawned {
        release(&app);
        return Err(e.to_string());
    }
    Ok(())
}

struct Job {
    plugin: Installed,
    importer: Importer,
    url: String,
    title: String,
    subtitles: Option<String>,
    /// The open folder, and the subfolder of it the audio goes in.
    root: PathBuf,
    folder: String,
    /// Where the plugin writes; emptied afterwards.
    staging: PathBuf,
    cancel: Arc<AtomicBool>,
}

impl Job {
    fn run(&self, app: &AppHandle) -> Status {
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
        let result: RunResult =
            serde_json::from_value(answer).map_err(|e| format!("插件的回答看不懂：{e}"))?;
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

#[tauri::command]
pub fn import_cancel(imports: State<Imports>) {
    if let Some(cancel) = imports.0.lock().unwrap().as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
}
