//! 连续录: while the sentence loops, it's said again and again with the mic
//! left open. Before each time after the first, `round` takes the time just
//! said out of the take and, if it has your voice, keeps it aside. Stopping
//! keeps the time you're on, or the one kept aside (`pick`): when you asked
//! for the one before, or the time you're on has nothing of yours.

use super::session::Msg;
use super::take::{self, Built};
use super::Recorder;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::mpsc;
use std::time::Duration;

const STOPPED: &str = "录音已经停了，再录一次吧";
const STOPPED_EN: &str = "The recording has stopped. Record again.";

impl Recorder {
    /// Another time through: the mic stays open and the take starts afresh.
    /// Returns whether the time just said had your voice (if not, the one kept
    /// aside before stays). Fails once the take has stopped (too long, an error).
    pub fn round(&self) -> Result<bool, String> {
        let (tx, rx) = mpsc::channel();
        let (mode, id) = {
            let session = self.lock();
            let s = session
                .as_ref()
                .ok_or(crate::i18n::pick(STOPPED, STOPPED_EN))?;
            s.tx.send(Msg::Round(tx))
                .map_err(|_| crate::i18n::pick(STOPPED, STOPPED_EN))?;
            (s.meta.mode, s.id)
        };
        let raw = rx
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| crate::i18n::pick(STOPPED, STOPPED_EN))?;
        // Removing the echo takes a moment: the lock isn't held meanwhile.
        let Ok(built) = take::build(&raw, mode) else {
            return Ok(false);
        };
        if let Some(s) = self.lock().as_mut().filter(|s| s.id == id) {
            s.kept = Some(built);
        }
        Ok(true)
    }

    pub(super) fn next_id(&self) -> u64 {
        self.ids.fetch_add(1, Relaxed)
    }
}

/// What stopping keeps: the time you're on (`now`), unless you asked for the
/// one before (`previous`) or it has nothing of yours; then the one kept aside.
pub fn pick<E>(
    now: impl FnOnce() -> Result<Built, E>,
    kept: Option<Built>,
    previous: bool,
) -> Result<Built, E> {
    match kept {
        Some(kept) if previous => Ok(kept),
        Some(kept) => Ok(now().unwrap_or(kept)),
        None => now(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn built(secs: f64) -> Built {
        Built {
            original: vec![],
            mine: vec![],
            original_span: (0.0, 1.0),
            mine_span: (0.0, secs),
            lag_ms: None,
        }
    }
    fn nothing() -> Result<Built, &'static str> {
        Err(take::NOTHING)
    }
    /// Which one was kept, by how long you spoke in it.
    fn secs(r: Result<Built, &'static str>) -> Result<f64, &'static str> {
        r.map(|b| b.mine_span.1)
    }

    #[test]
    fn the_time_you_are_on_unless_you_asked_for_the_one_before() {
        assert_eq!(
            secs(pick(|| Ok(built(2.0)), Some(built(1.0)), false)),
            Ok(2.0)
        );
        assert_eq!(
            secs(pick(|| Ok(built(2.0)), Some(built(1.0)), true)),
            Ok(1.0)
        );
    }

    #[test]
    fn nothing_of_yours_now_keeps_the_one_before() {
        assert_eq!(secs(pick(nothing, Some(built(1.0)), false)), Ok(1.0));
    }

    #[test]
    fn with_nothing_kept_aside_it_is_the_time_you_are_on() {
        assert_eq!(secs(pick(nothing, None, true)), Err(take::NOTHING));
        assert_eq!(secs(pick(|| Ok(built(2.0)), None, true)), Ok(2.0));
    }

    #[test]
    fn asking_for_the_one_before_does_not_build_this_one() {
        let mut built_now = false;
        let _ = pick(
            || {
                built_now = true;
                nothing()
            },
            Some(built(1.0)),
            true,
        );
        assert!(
            !built_now,
            "removing the echo of a time nobody keeps is wasted"
        );
    }
}
