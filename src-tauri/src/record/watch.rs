//! A clip's progress for the webview: `recorder:clip` events while it plays,
//! and one when it's over, saying whether it played to its end (only then does
//! listening on go to the next sentence). Listening to your takes is practice:
//! the practice clock hears of it too.

use crate::audio::Player;
use crate::practice::{Doing, Practice};
use serde::Serialize;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// How long a clip may take to start: the engine picks it up at its next
/// callback, and the output, idle for a while, may first have to wake up.
const START_SECS: f64 = 2.0;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipStatus {
    clip: u64,
    secs: f64,
    playing: bool,
    /// Played to its end; false while playing and when it was stopped.
    ended: bool,
}

/// Reports the clip (of a take of `audio`) until it ends or another replaces it.
pub fn watch(app: AppHandle, clip: u64, audio: String) {
    use tauri::Manager;
    let player = app.state::<Player>();
    let practice = |doing| {
        if let Some(p) = app.try_state::<Arc<Practice>>() {
            p.busy(&audio, doing);
        }
    };
    let asked = Instant::now();
    let mut started = false;
    loop {
        let waited = asked.elapsed().as_secs_f64() >= START_SECS;
        let seen = seen(
            clip,
            player.clip(),
            player.clip_finished(clip),
            started,
            waited,
        );
        let (playing, secs, ended) = match seen {
            Seen::Starting => {
                thread::sleep(Duration::from_millis(10));
                continue;
            }
            Seen::Playing(secs) => (true, secs, false),
            Seen::Over { ended } => (false, 0.0, ended),
        };
        started = true;
        let _ = app.emit(
            "recorder:clip",
            ClipStatus {
                clip,
                secs,
                playing,
                ended,
            },
        );
        if !playing {
            practice(Doing::Paused);
            return;
        }
        practice(Doing::Playing);
        thread::sleep(Duration::from_millis(33));
    }
}

#[derive(Debug, PartialEq)]
enum Seen {
    /// Not picked up by the engine yet.
    Starting,
    Playing(f64),
    /// `ended`: played to its end (not stopped, replaced, or never started).
    Over {
        ended: bool,
    },
}

/// Where clip `clip` is, from the clip the engine is playing (`now`, with ids
/// counting up), whether `clip` played to its end, whether it was seen
/// playing before, and whether it has had long enough to start.
fn seen(clip: u64, now: Option<(u64, f64)>, finished: bool, started: bool, waited: bool) -> Seen {
    match now {
        Some((id, secs)) if id == clip => Seen::Playing(secs),
        _ if finished => Seen::Over { ended: true },
        Some((id, _)) if id > clip => Seen::Over { ended: false },
        _ if started || waited => Seen::Over { ended: false },
        _ => Seen::Starting,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clip_not_started_yet_isnt_over() {
        // The output waking up: nothing playing yet, or still the clip before.
        assert_eq!(seen(5, None, false, false, false), Seen::Starting);
        assert_eq!(seen(5, Some((4, 1.0)), false, false, false), Seen::Starting);
        assert_eq!(
            seen(5, Some((5, 0.2)), false, false, false),
            Seen::Playing(0.2)
        );
        // Gone once it had started: played out, or stopped.
        assert_eq!(seen(5, None, true, true, false), Seen::Over { ended: true });
        assert_eq!(
            seen(5, None, false, true, false),
            Seen::Over { ended: false }
        );
        // Replaced by a newer one, or never picked up at all.
        assert_eq!(
            seen(5, Some((6, 0.0)), false, false, false),
            Seen::Over { ended: false }
        );
        assert_eq!(
            seen(5, None, false, false, true),
            Seen::Over { ended: false }
        );
        // Too short to be seen playing, but it did play out.
        assert_eq!(
            seen(5, None, true, false, false),
            Seen::Over { ended: true }
        );
    }
}
