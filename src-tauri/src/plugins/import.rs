//! 从链接导入: finds the plugin that takes a link, asks it what the link is
//! (`import/resolve`), then has it download into a staging folder
//! (`import/run`) and moves the result into the open folder (accept.rs).
//! One link read and one download at a time; progress goes out as `import:status`.

use super::job::Job;
use super::rpc::Process;
use super::{importer_for, Installed};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// What runs now, to cancel it. Reading a link (the confirmation sheet) and one
/// download can run side by side; more downloads wait in the page's queue.
#[derive(Default)]
pub struct Imports {
    resolving: Mutex<Option<Arc<AtomicBool>>>,
    downloading: Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(Clone, Copy)]
enum Slot {
    Resolving,
    Downloading,
}

impl Imports {
    fn slot(&self, slot: Slot) -> &Mutex<Option<Arc<AtomicBool>>> {
        match slot {
            Slot::Resolving => &self.resolving,
            Slot::Downloading => &self.downloading,
        }
    }

    /// Takes the slot; `None` while something else holds it.
    fn claim(&self, slot: Slot) -> Option<Arc<AtomicBool>> {
        let mut held = self.slot(slot).lock().unwrap();
        if held.is_some() {
            return None;
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *held = Some(cancel.clone());
        Some(cancel)
    }

    fn release(&self, slot: Slot) {
        *self.slot(slot).lock().unwrap() = None;
    }
}

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

const READING: &str = "正在读取另一个链接，请稍等";
const DOWNLOADING: &str = "正在下载另一个链接，请等它下载完";

fn no_plugin(url: &str) -> String {
    if url.contains("youtube.com") || url.contains("youtu.be") {
        "还没有能导入 YouTube 链接的插件。在 设置 → 插件 里安装 YouTube 导入插件。".into()
    } else {
        "没有能导入这个链接的插件".into()
    }
}

/// Starts the plugin in its `data/` folder and says hello.
pub(super) fn open(
    app: &AppHandle,
    plugin: &Installed,
    cancel: &AtomicBool,
) -> Result<Process, String> {
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
pub(super) fn progress_of(method: &str, params: &Value) -> Option<(String, u64, u64)> {
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
    as_link(&String::from_utf8(out.stdout).ok()?)
}

/// One web link and nothing else (a copied paragraph that mentions a link isn't one).
fn as_link(text: &str) -> Option<String> {
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
    let cancel = imports.claim(Slot::Resolving).ok_or(READING)?;
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
    imports.release(Slot::Resolving);
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
    let cancel = imports.claim(Slot::Downloading).ok_or(DOWNLOADING)?;
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
            app.state::<Imports>().release(Slot::Downloading);
            let _ = app.emit("import:status", status);
        }
    });
    if let Err(e) = spawned {
        imports.release(Slot::Downloading);
        return Err(e.to_string());
    }
    Ok(())
}

/// `what`: "resolve" (the link being read) or "download".
#[tauri::command]
pub fn import_cancel(imports: State<Imports>, what: String) {
    let slot = if what == "resolve" {
        Slot::Resolving
    } else {
        Slot::Downloading
    };
    if let Some(cancel) = imports.slot(slot).lock().unwrap().as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::as_link;

    #[test]
    fn only_a_lone_link_counts() {
        let url = "https://youtu.be/FFMoTdeD1aM?si=x";
        assert_eq!(as_link(&format!("  {url}\n")).as_deref(), Some(url));
        assert_eq!(as_link("see https://youtu.be/x"), None);
        assert_eq!(as_link("https://youtu.be/x and more"), None);
        assert_eq!(as_link("youtu.be/x"), None);
        assert_eq!(as_link(""), None);
    }
}
