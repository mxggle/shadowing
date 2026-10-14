//! 跟读录音: say a sentence after the original (or along with it) and compare.
//!
//! A take is a session on its own thread: the microphone and a tap of the
//! engine's output run from `begin` to `finish`. The webview plays the
//! original (`player_play_range`), says when your turn starts (`turn`), and
//! gets level events and, once you've stopped speaking, `recorder:auto`.
//! `finish` builds the take (echo removed, trimmed; `take.rs`) and stores it
//! (`saved.rs`). Takes play back as engine clips (`playback.rs`).

pub mod commands;
mod devices;
mod echo;
mod mic;
mod playback;
#[cfg(test)]
mod real_tests;
mod saved;
mod take;
mod vad;

use crate::audio::tap::{self, TapRx};
use crate::audio::Player;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use take::Raw;
use tauri::{AppHandle, Emitter};
use vad::Rules;

pub use saved::Take;
pub use take::Mode;
pub use vad::Stop;

/// Longest take, whatever happens.
const MAX_TAKE_SECS: f64 = 120.0;
/// A microphone that delivers only exact zeros this long is blocked (no permission).
const SILENT_MIC_SECS: f64 = 1.5;
const LEVEL_EVERY: Duration = Duration::from_millis(33);
const ERR_BLOCKED: &str =
    "麦克风没有声音：请在“系统设置 → 隐私与安全性 → 麦克风”里允许 Shadowing，然后再试";

/// What the take is of, sent by the webview at `begin`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub audio: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub mode: Mode,
    pub rate: f64,
}

/// Where a take's live signals go (the webview in the app, a recorder in tests).
pub trait Signals: Send + 'static {
    fn level(&self, level: &Level);
    /// You've stopped speaking (or never started): the take may be finished.
    fn auto(&self, stop: Stop);
    fn error(&self, message: &str);
}

impl Signals for AppHandle {
    fn level(&self, level: &Level) {
        let _ = self.emit("recorder:level", level);
    }
    fn auto(&self, stop: Stop) {
        let _ = self.emit("recorder:auto", stop);
    }
    fn error(&self, message: &str) {
        let _ = self.emit("recorder:error", message);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Level {
    /// 0–1 (−60 dB … 0 dB), the loudest frame since the last event.
    level: f32,
    speaking: bool,
    /// Seconds since your turn began (0 before).
    secs: f64,
}

enum Msg {
    Turn(Rules),
    Stop,
}

struct Session {
    meta: Meta,
    tx: Sender<Msg>,
    done: Receiver<Result<Raw, String>>,
}

#[derive(Default)]
pub struct Recorder {
    session: Mutex<Option<Session>>,
}

impl Recorder {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Session>> {
        self.session.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Opens the microphone and starts copying the output; returns once the mic
    /// delivers, with the microphone's name.
    pub fn begin(&self, out: impl Signals, player: &Player, meta: Meta) -> Result<String, String> {
        self.cancel(player);
        let (tap, tap_rx) = tap::tap(4.0);
        let (tx, rx) = mpsc::channel();
        let (done_tx, done) = mpsc::channel();
        let (ready_tx, ready) = mpsc::channel();
        thread::Builder::new()
            .name("record-take".into())
            .spawn(move || run(out, tap_rx, rx, ready_tx, done_tx))
            .map_err(|e| e.to_string())?;
        let name = match ready.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(name)) => name,
            Ok(Err(e)) => return Err(e),
            Err(_) => {
                let _ = tx.send(Msg::Stop);
                return Err("麦克风没有响应".into());
            }
        };
        player.set_tap(Some(tap))?;
        *self.lock() = Some(Session { meta, tx, done });
        Ok(name)
    }

    /// The original has finished: from now on the take may stop by itself.
    pub fn turn(&self) {
        if let Some(s) = self.lock().as_ref() {
            let _ = s.tx.send(Msg::Turn(rules(&s.meta)));
        }
    }

    fn end(&self, player: &Player) -> Option<(Meta, Result<Raw, String>)> {
        let s = self.lock().take()?;
        let _ = s.tx.send(Msg::Stop);
        let raw = s
            .done
            .recv_timeout(Duration::from_secs(3))
            .unwrap_or_else(|_| Err("录音没有结束".into()));
        let _ = player.set_tap(None);
        Some((s.meta, raw))
    }

    pub fn cancel(&self, player: &Player) {
        self.end(player);
    }

    /// Stops; builds and keeps the take. `Ok(None)` if nothing was being recorded.
    pub fn finish(&self, player: &Player, root: &Path) -> Result<Option<Take>, String> {
        let Some((meta, raw)) = self.end(player) else {
            return Ok(None);
        };
        let built = take::build(&raw?, meta.mode).ok_or("没听到你的声音，再试一次？")?;
        let created = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64);
        let t = Take {
            id: created.to_string(),
            created,
            start: meta.start,
            end: meta.end,
            text: meta.text,
            mode: meta.mode,
            rate: meta.rate,
            duration: built.original.len().max(built.mine.len()) as f64 / take::RATE as f64,
            original: built.original_span,
            mine: built.mine_span,
            lag_ms: built.lag_ms,
            peaks: saved::Peaks {
                original: take::peaks(&built.original, saved::PEAKS_PER_SEC),
                mine: take::peaks(&built.mine, saved::PEAKS_PER_SEC),
            },
        };
        saved::add(root, &meta.audio, t.clone(), &built.original, &built.mine)?;
        Ok(Some(t))
    }
}

/// When a take stops by itself: after the sentence's own length (at this speed) and then some.
fn rules(meta: &Meta) -> Rules {
    let said = (meta.end - meta.start).max(0.5) / meta.rate.clamp(0.5, 2.0);
    match meta.mode {
        Mode::Listen => Rules {
            pause_secs: 0.8,
            wait_secs: 5.0,
            max_secs: (said * 2.0 + 3.0).max(6.0),
            speaking: false,
        },
        Mode::Shadow => Rules {
            pause_secs: 0.7,
            wait_secs: 3.0,
            max_secs: 4.0,
            speaking: true,
        },
    }
}

fn run(
    out: impl Signals,
    mut tap_rx: TapRx,
    rx: Receiver<Msg>,
    ready: Sender<Result<String, String>>,
    done: Sender<Result<Raw, String>>,
) {
    let mut mic = match mic::open(4.0) {
        Ok(m) => m,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    let opened = Instant::now();
    while mic.first_at.load(Relaxed) == 0 {
        if opened.elapsed() > Duration::from_secs(2) {
            let _ = ready.send(Err("麦克风没有响应".into()));
            return;
        }
        thread::sleep(Duration::from_millis(5));
    }
    let _ = ready.send(Ok(mic.name.clone()));
    let frame = (mic.rate as f64 * vad::FRAME_SECS) as usize;
    let (mut buf, mut levels) = (Vec::<f32>::new(), Vec::<f32>::new());
    let (mut marks, mut played) = (Vec::new(), Vec::new());
    let (mut turn, mut rules_now, mut stopped) = (None::<usize>, None::<Rules>, false);
    let (mut last_emit, mut loudest, mut sound) = (Instant::now(), f32::MIN, false);
    let mut error = None;
    loop {
        match rx.recv_timeout(Duration::from_millis(10)) {
            Ok(Msg::Turn(r)) => {
                turn.get_or_insert(levels.len());
                rules_now = Some(r);
            }
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        while let Ok(v) = mic.samples.pop() {
            sound |= v != 0.0;
            buf.push(v);
        }
        while let Ok(m) = tap_rx.marks.pop() {
            marks.push(m);
        }
        while let Ok(v) = tap_rx.samples.pop() {
            played.push(v);
        }
        while (levels.len() + 1) * frame <= buf.len() {
            let l = vad::level(&buf[levels.len() * frame..][..frame]);
            loudest = loudest.max(l);
            levels.push(l);
        }
        let secs = buf.len() as f64 / mic.rate as f64;
        if mic.failed.load(Relaxed) {
            error = Some("麦克风断开了".to_string());
        } else if secs > SILENT_MIC_SECS && !sound {
            error = Some(ERR_BLOCKED.to_string());
        }
        if let Some(e) = error.as_ref() {
            out.error(e);
            break;
        }
        let stop = match (turn, rules_now) {
            _ if secs > MAX_TAKE_SECS => Some(Stop::Long),
            (Some(t), Some(r)) => vad::verdict(&levels, t, &r),
            _ => None,
        };
        if let Some(stop) = stop.filter(|_| !stopped) {
            stopped = true;
            out.auto(stop);
        }
        if last_emit.elapsed() >= LEVEL_EVERY && loudest > f32::MIN {
            out.level(&Level {
                level: ((loudest + 60.0) / 60.0).clamp(0.0, 1.0),
                speaking: loudest > vad::threshold(&levels),
                secs: turn.map_or(0.0, |t| (levels.len() - t) as f64 * vad::FRAME_SECS),
            });
            last_emit = Instant::now();
            loudest = f32::MIN;
        }
    }
    drop(mic.stream);
    let _ = done.send(match error {
        Some(e) => Err(e),
        None => Ok(Raw {
            mic_at: mic.first_at.load(Relaxed),
            turn: turn.map_or(0, |t| t * frame),
            mic: buf,
            mic_rate: mic.rate,
            marks,
            played,
        }),
    });
}
