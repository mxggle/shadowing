//! Shadowing plugin: YouTube 导入. Speaks the app's plugin protocol (JSON-RPC
//! 2.0, one message per line on stdin / stdout; see docs/plugin-plan.md) and
//! does the work with yt-dlp, which it downloads and keeps up to date itself.

mod fetch;
mod mux;
mod platform;
mod run;
mod tools;
mod video;
mod ytdlp;

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};

pub const CANCELLED: &str = "已取消";

/// One line to the app.
fn send(msg: Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{msg}");
    let _ = out.flush();
}

/// A `progress` note: what is happening, and bytes done of total (0 = unknown).
pub fn progress(message: &str, done: u64, total: u64) {
    send(json!({
        "jsonrpc": "2.0",
        "method": "progress",
        "params": { "message": message, "done": done, "total": total },
    }));
}

pub struct Ctx {
    pub data: PathBuf,
    pub cancel: Arc<AtomicBool>,
}

impl Ctx {
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

fn handle(
    ctx: &mut Option<Ctx>,
    cancel: &Arc<AtomicBool>,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    if method == "initialize" {
        let data = params["dataDir"]
            .as_str()
            .map(PathBuf::from)
            .or_else(|| std::env::current_dir().ok())
            .ok_or("没有数据文件夹")?;
        std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        *ctx = Some(Ctx {
            data,
            cancel: cancel.clone(),
        });
        return Ok(json!({ "name": "YouTube 导入", "version": env!("CARGO_PKG_VERSION") }));
    }
    let ctx = ctx.as_ref().ok_or("还没有 initialize")?;
    let url = params["url"].as_str().unwrap_or_default();
    match method {
        "import/resolve" => ytdlp::resolve(ctx, url),
        "import/run" => {
            let out = params["outDir"].as_str().ok_or("没有给下载到哪里")?;
            let subtitles = params["subtitles"].as_str();
            // The picture too, at most this tall (apps before it never ask).
            let video = params["video"].as_u64();
            ytdlp::download(ctx, url, &PathBuf::from(out), subtitles, video)
        }
        other => Err(format!("这个插件不认识 “{other}”")),
    }
}

fn main() {
    let cancel = Arc::new(AtomicBool::new(false));
    let (tx, requests) = mpsc::channel::<Value>();
    // Reads ahead so `$/cancel` is seen while a request is being worked on.
    std::thread::spawn({
        let cancel = cancel.clone();
        move || {
            for line in std::io::stdin().lock().lines() {
                let Ok(line) = line else { break };
                let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if msg["method"] == "$/cancel" {
                    cancel.store(true, Ordering::Relaxed);
                } else if tx.send(msg).is_err() {
                    break;
                }
            }
        }
    });

    let mut ctx = None;
    for msg in requests {
        let (Some(id), Some(method)) = (msg.get("id").cloned(), msg["method"].as_str()) else {
            continue;
        };
        cancel.store(false, Ordering::Relaxed);
        let reply = match handle(&mut ctx, &cancel, method, &msg["params"]) {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(message) => {
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": 1, "message": message } })
            }
        };
        send(reply);
    }
}
