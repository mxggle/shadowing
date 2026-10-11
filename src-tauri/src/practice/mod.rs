//! Practice time: how long the learner actually practised, measured from what the
//! player does (in Rust, so playback in the background counts and nothing depends
//! on the WebView being awake) plus activity pings from the window. The rules are
//! in `clock.rs`; sessions are kept in `practice.json` beside state.json and
//! summed per day by the frontend (in local time).

mod clock;

use crate::audio::{EventSink, Status};
use crate::store::Saver;
use clock::{Clock, Session};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// While a session runs, write it at most this often (a crash loses at most this much).
const SAVE_EVERY_MS: u64 = 30_000;

#[derive(Default, Serialize, Deserialize)]
struct Log {
    sessions: Vec<Session>,
}

pub struct Practice {
    clock: Mutex<(Clock, u64)>, // with the time of the last save
    version: AtomicU64,
    saver: Saver<Log>,
}

impl Practice {
    pub fn open(data_dir: &Path) -> Self {
        let path = data_dir.join("practice.json");
        Self {
            clock: Mutex::new((Clock::new(load(&path)), 0)),
            version: AtomicU64::new(0),
            saver: Saver::new(path),
        }
    }

    fn status(&self, status: &Status) {
        let now = now_ms();
        let mut guard = self.clock.lock().unwrap_or_else(|e| e.into_inner());
        let ended = guard
            .0
            .status(now, status.seq, status.path.as_deref(), status.playing);
        self.save_if_due(&mut guard, now, ended);
    }

    fn activity(&self) {
        let now = now_ms();
        let mut guard = self.clock.lock().unwrap_or_else(|e| e.into_inner());
        guard.0.activity(now);
        self.save_if_due(&mut guard, now, false);
    }

    fn save_if_due(&self, guard: &mut (Clock, u64), now: u64, ended: bool) {
        let due = guard.0.is_open() && now.saturating_sub(guard.1) >= SAVE_EVERY_MS;
        if ended || due {
            guard.1 = now;
            let version = self.version.fetch_add(1, Ordering::SeqCst) + 1;
            let log = Log {
                sessions: guard.0.sessions(),
            };
            self.saver.later(version, log);
        }
    }

    /// On quit: writes the running session too (it counts as finished next time).
    pub fn flush(&self) {
        let guard = self.clock.lock().unwrap_or_else(|e| e.into_inner());
        let log = Log {
            sessions: guard.0.sessions(),
        };
        let version = self.version.fetch_add(1, Ordering::SeqCst) + 1;
        if let Err(e) = self.saver.now(version, &log) {
            eprintln!("practice.json not saved: {e}");
        }
    }
}

/// A missing file is an empty log; a corrupt one is kept aside, not deleted.
fn load(path: &Path) -> Vec<Session> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    match serde_json::from_str::<Log>(&text) {
        Ok(log) => log
            .sessions
            .into_iter()
            .filter(|s| s.end >= s.start && s.played <= s.end - s.start)
            .collect(),
        Err(err) => {
            eprintln!("practice.json unreadable ({err}); starting a new log");
            let _ = fs::rename(path, path.with_extension("corrupt.json"));
            Vec::new()
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Passes player events on, letting the practice clock see every status first.
pub struct Watch<S> {
    pub inner: S,
    pub practice: Arc<Practice>,
}

impl<S: EventSink> EventSink for Watch<S> {
    fn status(&self, status: &Status) {
        self.practice.status(status);
        self.inner.status(status);
    }
    fn ended(&self, path: &str) {
        self.inner.ended(path);
    }
    fn error(&self, path: Option<&str>, message: &str) {
        self.inner.error(path, message);
    }
}

/// The learner did something in the window; sent at most every few seconds.
#[tauri::command]
pub fn practice_ping(practice: State<Arc<Practice>>) {
    practice.activity();
}

/// Sessions oldest first, including the one running now; with `since` (Unix ms),
/// only those still going at or after it (today's, for the goal in the top bar).
#[tauri::command]
pub fn practice_log(practice: State<Arc<Practice>>, since: Option<u64>) -> Vec<Session> {
    let guard = practice.clock.lock().unwrap_or_else(|e| e.into_inner());
    let mut sessions = guard.0.sessions();
    sessions.retain(|s| s.end >= since.unwrap_or(0));
    sessions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_and_loaded_with_bad_entries_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("practice.json");
        assert!(load(&path).is_empty());
        let good = Session {
            audio: "/a.mp3".into(),
            start: 1000,
            end: 61_000,
            played: 30_000,
        };
        let bad = Session {
            played: 90_000,
            ..good.clone()
        };
        let saver = Saver::new(path.clone());
        saver
            .now(
                1,
                &Log {
                    sessions: vec![good.clone(), bad],
                },
            )
            .unwrap();
        assert_eq!(load(&path), vec![good]);

        fs::write(&path, "{oops").unwrap();
        assert!(load(&path).is_empty());
        assert!(dir.path().join("practice.corrupt.json").exists());
    }
}
