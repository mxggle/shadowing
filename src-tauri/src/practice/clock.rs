//! Which stretches of time count as practice: a pure state machine fed with
//! player status and the learner's activity (Unix ms timestamps).
//!
//! The rules (also explained on the 学习记录 page):
//! - A session starts when audio starts playing and belongs to that one audio.
//! - It keeps counting while the audio plays, and across a pause as long as
//!   something happens again within `IDLE_MS` (playing again, a key, a click):
//!   pausing to say the sentence or to read an explanation is practice.
//! - A longer silence ends the session at the last activity; none of the silence
//!   counts (walked away, Mac asleep). Activity alone never starts a session.
//! - Sessions with less than `MIN_PLAYED_MS` of playback are dropped
//!   (a track opened by mistake).

use serde::{Deserialize, Serialize};

pub const IDLE_MS: u64 = 90_000;
pub const MIN_PLAYED_MS: u64 = 5_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// Absolute path of the audio.
    pub audio: String,
    /// Unix ms of the first and the last activity; all of it counts.
    pub start: u64,
    pub end: u64,
    /// Ms of that time the audio was playing (wall clock, whatever the speed).
    pub played: u64,
}

struct Open {
    session: Session,
    playing: bool,
}

impl Open {
    /// Counts the time since the last activity, unless it was too long (or the clock went back).
    fn extend(&mut self, now: u64) -> bool {
        match now.checked_sub(self.session.end) {
            Some(gap) if gap <= IDLE_MS => {
                if self.playing {
                    self.session.played += gap;
                }
                self.session.end = now;
                true
            }
            _ => false,
        }
    }
}

#[derive(Default)]
pub struct Clock {
    /// Finished sessions, oldest first.
    pub done: Vec<Session>,
    open: Option<Open>,
    /// Latest player status applied; statuses from two threads can arrive out of order.
    seq: u64,
}

impl Clock {
    pub fn new(done: Vec<Session>) -> Self {
        Self {
            done,
            ..Default::default()
        }
    }

    /// A player status. Returns true when a session ended (worth saving now).
    pub fn status(&mut self, now: u64, seq: u64, audio: Option<&str>, playing: bool) -> bool {
        if seq < self.seq {
            return false;
        }
        self.seq = seq;
        let mut ended = false;
        if let Some(open) = &mut self.open {
            if audio == Some(open.session.audio.as_str()) && open.extend(now) {
                open.playing = playing;
                return false;
            }
            ended = self.close();
        }
        if let (true, Some(audio)) = (playing, audio) {
            self.open = Some(Open {
                session: Session {
                    audio: audio.into(),
                    start: now,
                    end: now,
                    played: 0,
                },
                playing: true,
            });
        }
        ended
    }

    /// The learner did something in the window (key, click, scroll).
    pub fn activity(&mut self, now: u64) {
        if let Some(open) = &mut self.open {
            // Too late to extend: the next status closes the session.
            open.extend(now);
        }
    }

    /// Ends the open session, keeping it if enough was played. True if kept.
    pub fn close(&mut self) -> bool {
        match self.open.take() {
            Some(open) if open.session.played >= MIN_PLAYED_MS => {
                self.done.push(open.session);
                true
            }
            _ => false,
        }
    }

    pub fn is_open(&self) -> bool {
        self.open.is_some()
    }

    /// Everything so far, including the session still running.
    pub fn sessions(&self) -> Vec<Session> {
        let mut all = self.done.clone();
        if let Some(open) = self
            .open
            .as_ref()
            .filter(|o| o.session.played >= MIN_PLAYED_MS)
        {
            all.push(open.session.clone());
        }
        all
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: u64 = 1000;
    const T0: u64 = 1_760_000_000_000;

    /// Status events every 100 ms while playing from `from` to `to` (seconds after T0).
    fn play(c: &mut Clock, seq: &mut u64, audio: &str, from: u64, to: u64) {
        let mut t = T0 + from * S;
        while t <= T0 + to * S {
            *seq += 1;
            c.status(t, *seq, Some(audio), true);
            t += 100;
        }
        *seq += 1;
        c.status(T0 + to * S, *seq, Some(audio), false);
    }

    #[test]
    fn short_pauses_count_long_ones_split() {
        let (mut c, mut seq) = (Clock::default(), 0);
        play(&mut c, &mut seq, "/a.mp3", 0, 10);
        // Paused 20 s to repeat the sentence, then played again.
        play(&mut c, &mut seq, "/a.mp3", 30, 40);
        // Walked away for 10 minutes.
        play(&mut c, &mut seq, "/a.mp3", 640, 650);
        let s = c.sessions();
        assert_eq!(s.len(), 2);
        assert_eq!((s[0].end - s[0].start, s[0].played), (40 * S, 20 * S));
        assert_eq!((s[1].end - s[1].start, s[1].played), (10 * S, 10 * S));
    }

    #[test]
    fn activity_keeps_a_pause_alive_but_never_starts_a_session() {
        let (mut c, mut seq) = (Clock::default(), 0);
        c.activity(T0);
        assert!(!c.is_open());
        play(&mut c, &mut seq, "/a.mp3", 0, 10);
        // Reading an explanation for 3 minutes, clicking now and then.
        for t in [60, 120, 180] {
            c.activity(T0 + t * S);
        }
        let s = c.sessions();
        assert_eq!((s[0].end - s[0].start, s[0].played), (180 * S, 10 * S));
        // Too late: nothing more counts.
        c.activity(T0 + 300 * S);
        assert_eq!(c.sessions()[0].end, T0 + 180 * S);
    }

    #[test]
    fn other_audio_or_unload_ends_the_session() {
        let (mut c, mut seq) = (Clock::default(), 0);
        play(&mut c, &mut seq, "/a.mp3", 0, 10);
        play(&mut c, &mut seq, "/b.mp3", 12, 20);
        seq += 1;
        assert!(c.status(T0 + 21 * S, seq, None, false));
        let s = c.sessions();
        assert_eq!(
            s.iter().map(|s| s.audio.as_str()).collect::<Vec<_>>(),
            ["/a.mp3", "/b.mp3"]
        );
        assert!(!c.is_open());
    }

    #[test]
    fn sleeping_while_playing_does_not_count() {
        let (mut c, mut seq) = (Clock::default(), 0);
        play(&mut c, &mut seq, "/a.mp3", 0, 10);
        seq += 1;
        c.status(T0 + 10 * S, seq, Some("/a.mp3"), true);
        // Lid closed for an hour; the status thread wakes up still "playing".
        play(&mut c, &mut seq, "/a.mp3", 3610, 3620);
        let total: u64 = c.sessions().iter().map(|s| s.played).sum();
        assert_eq!(total, 20 * S);
    }

    #[test]
    fn clock_going_back_starts_a_new_session() {
        let (mut c, mut seq) = (Clock::default(), 0);
        play(&mut c, &mut seq, "/a.mp3", 100, 110);
        play(&mut c, &mut seq, "/a.mp3", 0, 10);
        assert_eq!(c.sessions().len(), 2);
    }

    #[test]
    fn stale_status_is_ignored() {
        let mut c = Clock::default();
        c.status(T0, 5, Some("/a.mp3"), true);
        c.status(T0 + 2 * S, 7, Some("/a.mp3"), false);
        // An older "playing" status arriving late must not make the pause count as playback.
        c.status(T0 + 2 * S, 6, Some("/a.mp3"), true);
        c.status(T0 + 30 * S, 8, Some("/a.mp3"), true);
        c.status(T0 + 36 * S, 9, Some("/a.mp3"), false);
        assert_eq!(c.sessions()[0].played, 8 * S);
    }

    #[test]
    fn tiny_sessions_are_dropped() {
        let (mut c, mut seq) = (Clock::default(), 0);
        play(&mut c, &mut seq, "/a.mp3", 0, 3);
        assert!(c.sessions().is_empty());
        assert!(!c.close());
        assert!(c.done.is_empty());
    }
}
