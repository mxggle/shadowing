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
//! - Recording yourself (跟读录音, 整段录音) is practice too: it starts and keeps
//!   a session like playing does (the time shows as practice between playback),
//!   and listening to your takes counts as playback (`busy`).
//! - Sessions with less than `MIN_PLAYED_MS` of playback or recording are
//!   dropped (a track opened by mistake).

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

/// What's going on with the audio, besides the learner's clicks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Doing {
    Paused,
    /// The track, or a take of it, playing.
    Playing,
    /// The microphone recording a take.
    Recording,
}

struct Open {
    session: Session,
    doing: Doing,
    /// Ms spent recording (only for keeping the session: it shows as the time between playback).
    recorded: u64,
}

impl Open {
    /// Counts the time since the last activity, unless it was too long (or the clock went back).
    fn extend(&mut self, now: u64) -> bool {
        match now.checked_sub(self.session.end) {
            Some(gap) if gap <= IDLE_MS => {
                match self.doing {
                    Doing::Playing => self.session.played += gap,
                    Doing::Recording => self.recorded += gap,
                    Doing::Paused => {}
                }
                self.session.end = now;
                true
            }
            _ => false,
        }
    }

    fn kept(&self) -> bool {
        self.session.played + self.recorded >= MIN_PLAYED_MS
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
        let doing = if playing {
            Doing::Playing
        } else {
            Doing::Paused
        };
        self.apply(now, audio, doing)
    }

    /// Not the player: a take of `audio` being recorded or played back, sent
    /// often while it lasts (`Paused` once it's over). Returns true when a session ended.
    pub fn busy(&mut self, now: u64, audio: &str, doing: Doing) -> bool {
        // While the track plays (the original of a take) that's playback, whoever says so.
        let doing = match &self.open {
            Some(o) if doing == Doing::Recording && o.doing == Doing::Playing => Doing::Playing,
            _ => doing,
        };
        self.apply(now, Some(audio), doing)
    }

    fn apply(&mut self, now: u64, audio: Option<&str>, doing: Doing) -> bool {
        let mut ended = false;
        if let Some(open) = &mut self.open {
            if audio == Some(open.session.audio.as_str()) && open.extend(now) {
                open.doing = doing;
                return false;
            }
            ended = self.close();
        }
        if let (Doing::Playing | Doing::Recording, Some(audio)) = (doing, audio) {
            self.open = Some(Open {
                session: Session {
                    audio: audio.into(),
                    start: now,
                    end: now,
                    played: 0,
                },
                doing,
                recorded: 0,
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

    /// Ends the open session, keeping it if enough was played or recorded. True if kept.
    pub fn close(&mut self) -> bool {
        match self.open.take() {
            Some(open) if open.kept() => {
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
        if let Some(open) = self.open.as_ref().filter(|o| o.kept()) {
            all.push(open.session.clone());
        }
        all
    }
}

#[cfg(test)]
#[path = "clock_tests.rs"]
mod tests;
