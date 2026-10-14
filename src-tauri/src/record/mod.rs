//! 跟读录音: say a sentence after the original (or along with it) and compare.
//!
//! A take is a session on its own thread: the microphone and a tap of the
//! engine's output run from `begin` to `finish`. The webview plays the
//! original (`player_play_range`), says when your turn starts (`turn`), and
//! gets level events and, once you've stopped speaking, `recorder:auto`.
//! `finish` builds the take (echo removed, trimmed; `take.rs`) and stores it
//! (`saved.rs`). Takes play back as engine clips (`playback.rs`).
//!
//! A paragraph is one session too (`Meta::sentences`): read on your own
//! (`Mode::Read`, the highlight follows your voice: `follow.rs`) or along with
//! the original; `reading.rs` cuts it into a take per sentence.

pub mod commands;
mod devices;
mod echo;
mod follow;
mod mic;
mod original;
mod playback;
mod reading;
#[cfg(test)]
mod real_tests;
mod replay;
mod saved;
mod segment;
mod session;
mod space;
mod take;
mod vad;
mod watch;
mod wav;

use crate::audio::tap;
use crate::audio::Player;
use serde::{Deserialize, Serialize};
use session::Msg;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use take::Raw;
use tauri::{AppHandle, Emitter};
use vad::Rules;

pub use saved::{Reading, Take};
pub use take::Mode;
pub use vad::Stop;

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
    /// A paragraph: its sentences, in order (empty for a single sentence).
    #[serde(default)]
    pub sentences: Vec<Sentence>,
    /// Set at `begin`: the original plays through Bluetooth earphones.
    #[serde(skip)]
    pub bluetooth: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Sentence {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// What `finish` kept: the take, or a paragraph's reading and its sentences' takes.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    pub takes: Vec<Take>,
    pub reading: Option<Reading>,
}

/// Where a take's live signals go (the webview in the app, a recorder in tests).
pub trait Signals: Send + 'static {
    fn level(&self, level: &Level);
    /// You've stopped speaking (or never started): the take may be finished.
    fn auto(&self, stop: Stop);
    /// Reading on your own: the sentence you're on now.
    fn sentence(&self, index: usize);
    fn error(&self, message: &str);
    /// The microphone has closed.
    fn ended(&self) {}
}

impl Signals for AppHandle {
    fn level(&self, level: &Level) {
        let _ = self.emit("recorder:level", level);
    }
    fn auto(&self, stop: Stop) {
        let _ = self.emit("recorder:auto", stop);
    }
    fn sentence(&self, index: usize) {
        let _ = self.emit("recorder:sentence", index);
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

struct Session {
    meta: Meta,
    file: PathBuf,
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
    /// `file` is the track's checked path (a paragraph read on your own takes the original from it).
    pub fn begin(
        &self,
        out: impl Signals,
        player: &Player,
        mut meta: Meta,
        file: PathBuf,
    ) -> Result<String, String> {
        self.cancel(player);
        meta.bluetooth = devices::bluetooth_output();
        let (tap, tap_rx) = tap::tap(4.0);
        let (tx, rx) = mpsc::channel();
        let (done_tx, done) = mpsc::channel();
        let (ready_tx, ready) = mpsc::channel();
        let plan = session::Plan::of(&meta);
        thread::Builder::new()
            .name("record-take".into())
            .spawn(move || session::run(out, plan, tap_rx, rx, ready_tx, done_tx))
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
        *self.lock() = Some(Session {
            meta,
            file,
            tx,
            done,
        });
        Ok(name)
    }

    /// Reading on your own: on to the next (+1) or back to the previous (−1) sentence by hand.
    pub fn step(&self, by: i32) {
        if let Some(s) = self.lock().as_ref() {
            let _ = s.tx.send(Msg::Step(by));
        }
    }

    /// The original has finished: from now on the take may stop by itself.
    pub fn turn(&self) {
        if let Some(s) = self.lock().as_ref() {
            let _ = s.tx.send(Msg::Turn(rules(&s.meta)));
        }
    }

    fn end(&self, player: &Player) -> Option<(Meta, PathBuf, Result<Raw, String>)> {
        let s = self.lock().take()?;
        let _ = s.tx.send(Msg::Stop);
        let raw = s
            .done
            .recv_timeout(Duration::from_secs(3))
            .unwrap_or_else(|_| Err("录音没有结束".into()));
        let _ = player.set_tap(None);
        Some((s.meta, s.file, raw))
    }

    pub fn cancel(&self, player: &Player) {
        self.end(player);
    }

    /// Stops; builds and keeps the take (or the reading). Empty if nothing was being recorded.
    pub fn finish(&self, player: &Player, root: &Path) -> Result<Finished, String> {
        let Some((meta, file, raw)) = self.end(player) else {
            return Ok(Finished::default());
        };
        let raw = raw?;
        let created = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64);
        if !meta.sentences.is_empty() {
            let id = created.to_string();
            let built = reading::build(&raw, &meta, &file, &id, created)?;
            let takes: Vec<Take> = built.takes.iter().map(|t| t.0.clone()).collect();
            saved::add_reading(
                root,
                &meta.audio,
                built.reading.clone(),
                &built.whole,
                built.takes,
            )?;
            return Ok(Finished {
                takes,
                reading: Some(built.reading),
            });
        }
        let built = take::build(&raw, meta.mode)?;
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
            group: None,
            source: None,
            bluetooth: meta.bluetooth,
        };
        saved::add(root, &meta.audio, t.clone(), &built.original, &built.mine)?;
        Ok(Finished {
            takes: vec![t],
            reading: None,
        })
    }
}

/// When a take stops by itself: after the sentence's own length (at this speed) and then some.
fn rules(meta: &Meta) -> Rules {
    let said = (meta.end - meta.start).max(0.5) / meta.rate.clamp(0.5, 2.0);
    let paragraph = !meta.sentences.is_empty();
    match meta.mode {
        // Reading on your own ends after the last sentence (`follow.rs`); this is a backstop.
        Mode::Read => Rules {
            pause_secs: 4.0,
            wait_secs: 10.0,
            max_secs: said * 3.0 + 10.0,
            speaking: false,
        },
        Mode::Shadow if paragraph => Rules {
            pause_secs: 1.0,
            wait_secs: 3.0,
            max_secs: 6.0,
            speaking: true,
        },
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
