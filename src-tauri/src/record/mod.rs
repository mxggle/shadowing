//! 跟读录音: say a sentence after the original (or along with it) and compare.
//!
//! A take is a session on its own thread: the microphone and a tap of the
//! engine's output run from `begin` to `finish`. The webview plays the
//! original (`player_play_range`), says when your turn starts (`turn`), and
//! gets level events and, once you've stopped speaking, `recorder:auto`.
//! `finish` builds the take (echo removed, trimmed; `take.rs`) and stores it
//! (`saved.rs`). Takes play back as engine clips (`playback.rs`). Recording
//! while the sentence loops, it's said again and again: `round` before each
//! time (`rounds.rs`). `pause` holds a take where it is, the original too, and
//! goes on from there (`hold.rs`).
//!
//! A paragraph is one session too (`Meta::sentences`): read on your own
//! (`Mode::Read`, the highlight follows your voice: `follow.rs`) or along with
//! the original; `reading.rs` cuts it into a take per sentence.

mod along;
pub mod commands;
mod devices;
mod echo;
mod follow;
mod hold;
mod mic;
mod original;
mod playback;
mod reading;
// Manual, macOS only (`say` plays the learner).
#[cfg(all(test, target_os = "macos"))]
mod real_tests;
mod replay;
mod rounds;
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
use std::sync::atomic::AtomicU64;
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
    /// 配音 (a video): said along (`Mode::Shadow`) with the original silent and the picture
    /// showing: the speakers are muted for the take, the recorder still gets the original.
    #[serde(default)]
    pub dub: bool,
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
    /// The take paused (true) or went on: no levels come while it's paused.
    fn held(&self, _on: bool) {}
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
    id: u64,
    meta: Meta,
    file: PathBuf,
    tx: Sender<Msg>,
    done: Receiver<Result<Raw, String>>,
    /// Said again and again: the last time before this one with your voice (`rounds.rs`).
    kept: Option<take::Built>,
    /// Paused (`pause`).
    held: bool,
}

#[derive(Default)]
pub struct Recorder {
    session: Mutex<Option<Session>>,
    ids: AtomicU64,
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
                return Err(
                    crate::i18n::pick("麦克风没有响应", "The microphone isn't responding").into(),
                );
            }
        };
        player.set_tap(Some(tap))?;
        if meta.dub {
            player.set_muted(true)?;
        }
        *self.lock() = Some(Session {
            id: self.next_id(),
            meta,
            file,
            tx,
            done,
            kept: None,
            held: false,
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

    fn end(&self, player: &Player) -> Option<(Session, Result<Raw, String>)> {
        let s = self.lock().take()?;
        let _ = s.tx.send(Msg::Stop);
        let raw = s
            .done
            .recv_timeout(Duration::from_secs(3))
            .unwrap_or_else(|_| {
                Err(crate::i18n::pick("录音没有结束", "The recording didn't finish").into())
            });
        let _ = player.set_tap(None);
        let _ = player.set_muted(false);
        if s.held {
            let _ = player.pause(); // the original held for it won't go on: as if it was paused
        }
        Some((s, raw))
    }

    pub fn cancel(&self, player: &Player) {
        self.end(player);
    }

    /// Stops; builds and keeps the take (or the reading). Empty if nothing was being recorded.
    /// Said again and again, `previous` keeps the time before this one (`rounds.rs`).
    pub fn finish(&self, player: &Player, root: &Path, previous: bool) -> Result<Finished, String> {
        let Some((
            Session {
                meta, file, kept, ..
            },
            raw,
        )) = self.end(player)
        else {
            return Ok(Finished::default());
        };
        let created = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64);
        if !meta.sentences.is_empty() {
            let raw = raw?;
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
        let now = || {
            take::build_heard(raw.as_ref().map_err(Clone::clone)?, meta.mode, !meta.dub)
                .map_err(String::from)
        };
        let built = rounds::pick(now, kept, previous)?;
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
            original_at: built.original_at,
            dub: meta.dub,
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
            along: false,
        },
        Mode::Shadow if paragraph => Rules {
            pause_secs: 1.0,
            wait_secs: 3.0,
            max_secs: 6.0,
            along: true,
        },
        Mode::Listen => Rules {
            pause_secs: 0.8,
            wait_secs: 5.0,
            max_secs: (said * 2.0 + 3.0).max(6.0),
            along: false,
        },
        // Once the original has finished, only your last words (you're a
        // little behind it, more so in a long sentence).
        Mode::Shadow => Rules {
            pause_secs: 0.6,
            wait_secs: 3.0,
            max_secs: (2.0 + said * 0.1).min(3.5),
            along: true,
        },
    }
}
