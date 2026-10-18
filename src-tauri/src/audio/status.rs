//! Control-side shared state: the command queue into the engine, the current
//! track with "shadow" status (used until the engine has applied queued
//! commands), and the status thread.

use super::engine::{Cmd, Shared, Trash, EV_CHANGED, EV_ENDED};
use super::output::OutMsg;
use super::{EventSink, Status};
use crate::i18n::pick;
use rtrb::{Consumer, Producer};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

const STATUS_PERIOD: Duration = Duration::from_millis(33);

/// Command queue into the engine, shared with the loop loader.
pub struct CmdTx {
    tx: Mutex<Producer<Cmd>>,
    sent: AtomicU64,
    out: Mutex<Sender<OutMsg>>,
}

impl CmdTx {
    pub fn new(tx: Producer<Cmd>, out: Sender<OutMsg>) -> Self {
        Self {
            tx: Mutex::new(tx),
            sent: AtomicU64::new(0),
            out: Mutex::new(out),
        }
    }

    pub fn send(&self, cmd: Cmd) -> Result<(), String> {
        let mut tx = self
            .tx
            .lock()
            .map_err(|_| pick("播放器不可用", "The player isn’t available"))?;
        tx.push(cmd).map_err(|_| {
            pick(
                "播放器繁忙，请稍后再试",
                "The player is busy. Try again in a moment.",
            )
        })?;
        self.sent.fetch_add(1, Relaxed);
        drop(tx);
        if let Ok(out) = self.out.lock() {
            let _ = out.send(OutMsg::Wake);
        }
        Ok(())
    }
}

pub struct Track {
    pub id: u64,
    pub path: String,
    pub file: PathBuf,
    pub sr: u32,
    pub total: u64,
    pub duration: f64,
}

pub struct Ctl {
    pub track: Option<Track>,
    pub shadow_time: f64,
    pub shadow_playing: bool,
    pub shadow_repeats: u32,
    /// Held for a recording (`Player::hold`), and nothing since has moved the track.
    pub held: bool,
    pub rate: f64,
    pub seq: u64,
}

impl Default for Ctl {
    fn default() -> Self {
        Self {
            track: None,
            shadow_time: 0.0,
            shadow_playing: false,
            shadow_repeats: 0,
            held: false,
            rate: 1.0,
            seq: 0,
        }
    }
}

pub fn lock(ctl: &Mutex<Ctl>) -> MutexGuard<'_, Ctl> {
    ctl.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn snapshot(cmd: &CmdTx, shared: &Shared, ctl: &mut Ctl) -> (Status, bool) {
    ctl.seq += 1;
    let seq = ctl.seq;
    let Some(t) = ctl.track.as_ref() else {
        return (
            Status {
                path: None,
                time: 0.0,
                duration: 0.0,
                playing: false,
                repeats: 0,
                seq,
            },
            true,
        );
    };
    let caught_up = shared.applied.load(Relaxed) >= cmd.sent.load(Relaxed)
        && shared.session.load(Relaxed) == t.id;
    if caught_up {
        ctl.shadow_time = shared.time();
        ctl.shadow_playing = shared.playing();
        ctl.shadow_repeats = shared.repeats();
    }
    let status = Status {
        path: Some(t.path.clone()),
        time: ctl.shadow_time,
        duration: t.duration,
        playing: ctl.shadow_playing,
        repeats: ctl.shadow_repeats,
        seq,
    };
    (status, caught_up)
}

/// Status thread: frees retired buffers and emits status (~30 Hz while
/// playing, immediately on engine events such as loop wraps and track end).
pub fn spawn(
    cmd: &Arc<CmdTx>,
    shared: &Arc<Shared>,
    ctl: &Arc<Mutex<Ctl>>,
    sink: &Arc<dyn EventSink>,
    mut trash: Consumer<Trash>,
) {
    let (cmd, shared, ctl, sink) = (cmd.clone(), shared.clone(), ctl.clone(), sink.clone());
    let _ = thread::Builder::new()
        .name("audio-status".into())
        .spawn(move || {
            let mut last = Instant::now();
            loop {
                thread::sleep(Duration::from_millis(8));
                while trash.pop().is_ok() {} // frees sessions/regions off the audio thread
                                             // Only consume events once the engine has applied every queued
                                             // command (it clears them on Load), so they belong to `status.path`.
                let (status, caught_up) = snapshot(&cmd, &shared, &mut lock(&ctl));
                if !caught_up {
                    continue;
                }
                let events = shared.take_events();
                let periodic = status.playing && last.elapsed() >= STATUS_PERIOD;
                if events & (EV_CHANGED | EV_ENDED) != 0 || periodic {
                    sink.status(&status);
                    last = Instant::now();
                }
                if events & EV_ENDED != 0 {
                    if let Some(p) = status.path.as_deref() {
                        sink.ended(p);
                    }
                }
            }
        });
}
