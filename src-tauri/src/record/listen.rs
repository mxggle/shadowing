//! 等我说完 (跟读停顿): in the pause after a sentence the microphone listens until you've
//! said it (you speak, then go quiet) and the pause ends. Nothing is kept: the levels decide and
//! are dropped. The track is paused meanwhile, so there's no original to take out.
//!
//! One listening at a time; `listen_start` ends any before it, and its answer comes as a
//! `listen:done` event naming the `id` the webview gave it (an answer for an older one is ignored).

use super::{mic, vad};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Quiet after speech that means you've said it.
const PAUSE_SECS: f64 = 0.6;
/// Whatever is going on, stop listening after this long.
const LONGEST_SECS: f64 = 60.0;
/// A microphone that delivers only exact zeros this long is blocked (no permission).
const SILENT_SECS: f64 = 1.5;
const POLL: Duration = Duration::from_millis(20);
/// The speech threshold is re-estimated this often (frames).
const THRESHOLD_EVERY: usize = 10;

#[derive(Default)]
pub struct Listener(Mutex<Option<Arc<AtomicBool>>>);

impl Listener {
    fn stop(&self) {
        if let Some(quit) = self.0.lock().unwrap_or_else(|e| e.into_inner()).take() {
            quit.store(true, Relaxed);
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Done {
    id: u64,
    /// You said it ("pause"), said nothing for `wait_secs` ("nothing"), or went on too long ("long").
    stop: Option<vad::Stop>,
    /// The microphone failed; the pause then waits for a key.
    error: Option<String>,
}

/// Starts listening; returns once the microphone is open (or why it isn't). `wait_secs`: how
/// long to wait for you to start before giving up (the pause then waits for a key).
#[tauri::command]
pub fn listen_start(
    app: AppHandle,
    listener: State<'_, Listener>,
    id: u64,
    wait_secs: f64,
) -> Result<(), String> {
    listener.stop();
    let quit = Arc::new(AtomicBool::new(false));
    *listener.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(quit.clone());
    let (opened, open_rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("listen".into())
        .spawn(move || {
            // The stream isn't Send everywhere: it lives and dies on this thread.
            let mic = match mic::open(1.0) {
                Ok(mic) => {
                    let _ = opened.send(Ok(()));
                    mic
                }
                Err(e) => {
                    let _ = opened.send(Err(e));
                    return;
                }
            };
            let (stop, error) = listen(mic, wait_secs, &quit);
            if !quit.load(Relaxed) {
                let _ = app.emit("listen:done", Done { id, stop, error });
            }
        })
        .map_err(|e| e.to_string())?;
    open_rx.recv().map_err(|e| e.to_string())?
}

/// Stops listening (the pause ended some other way); nothing is reported.
#[tauri::command]
pub fn listen_stop(listener: State<'_, Listener>) {
    listener.stop();
}

/// Reads the microphone until the verdict, `quit` or a failure.
fn listen(
    mut mic: mic::Mic,
    wait_secs: f64,
    quit: &AtomicBool,
) -> (Option<vad::Stop>, Option<String>) {
    let rules = vad::Rules {
        pause_secs: PAUSE_SECS,
        wait_secs: wait_secs.clamp(1.0, LONGEST_SECS),
        max_secs: LONGEST_SECS,
        along: false,
    };
    let frame = (mic.rate as usize / 100).max(1);
    let mut buf: Vec<f32> = Vec::new();
    let mut levels: Vec<f32> = Vec::new();
    let mut threshold = vad::threshold(&[]);
    let mut sound = false;
    while !quit.load(Relaxed) {
        std::thread::sleep(POLL);
        if mic.failed.load(Relaxed) {
            return (
                None,
                Some(crate::i18n::pick("麦克风断开了", "The microphone was disconnected").into()),
            );
        }
        while let Ok(v) = mic.samples.pop() {
            sound |= v != 0.0;
            buf.push(v);
        }
        while buf.len() >= frame {
            levels.push(vad::level(&buf[..frame]));
            buf.drain(..frame);
            if levels.len().is_multiple_of(THRESHOLD_EVERY) {
                threshold = vad::threshold(&levels);
            }
        }
        if !sound && levels.len() as f64 * vad::FRAME_SECS >= SILENT_SECS {
            return (None, Some(blocked().into()));
        }
        if let Some(stop) = vad::verdict(&levels, 0, &rules, threshold) {
            return (Some(stop), None);
        }
    }
    (None, None)
}

fn blocked() -> &'static str {
    crate::i18n::pick(
        "麦克风没有声音：「等我说完」要用麦克风听你说完没有。请在系统的隐私设置里允许 Shadowing 使用麦克风",
        "No sound from the microphone. “Until I've said it” uses the microphone to hear when you're done; allow Shadowing to use it in the system's privacy settings.",
    )
}
