//! Pausing a take (the deck's play key): the paused time is cut out of what
//! the take keeps, the microphone and the copy of the output alike, so the
//! take goes on afterwards as if there had been no pause. Echo removal, the
//! turn detection and following your reading all see one timeline without a
//! gap. Times are host ns, the clock the microphone and the output share.

use super::session::{later, Msg};
use super::Recorder;
use crate::audio::tap::Mark;
use crate::audio::Player;

impl Recorder {
    /// Pauses the take (`on`) where it is, the original playing for it too, or
    /// lets it go on; the time between is left out of the take. Going on,
    /// returns whether the original plays on (it was playing, and hadn't ended).
    pub fn pause(&self, player: &Player, on: bool) -> bool {
        {
            let mut session = self.lock();
            let Some(s) = session.as_mut().filter(|s| s.held != on) else {
                return false;
            };
            s.held = on;
            let _ = s.tx.send(Msg::Hold(on));
        }
        if on {
            let _ = player.hold();
            false
        } else {
            player.resume_held().unwrap_or(false)
        }
    }
}

/// The paused stretches of a take's timeline, cut out of it.
#[derive(Debug, Default)]
pub struct Cuts {
    /// (from, to): paused at `from`, going on at `to`.
    done: Vec<(u64, u64)>,
    /// Paused since then.
    open: Option<u64>,
}

impl Cuts {
    pub fn paused(&self) -> bool {
        self.open.is_some()
    }

    pub fn pause(&mut self, at: u64) {
        self.open.get_or_insert(at);
    }

    pub fn resume(&mut self, at: u64) {
        if let Some(from) = self.open.take() {
            self.done.push((from, at.max(from)));
        }
    }

    /// Paused: where on the timeline (earlier pauses cut out).
    fn paused_at(&self) -> Option<u64> {
        let shift: u64 = self.done.iter().map(|(from, to)| to - from).sum();
        self.open.map(|from| from.saturating_sub(shift))
    }

    /// Where something heard at `at` falls once the paused time is cut out;
    /// None if it was heard while paused.
    pub fn place(&self, at: u64) -> Option<u64> {
        if self.open.is_some_and(|from| at >= from) {
            return None;
        }
        let mut shift = 0;
        for &(from, to) in &self.done {
            if at >= to {
                shift += to - from;
            } else if at >= from {
                return None;
            }
        }
        Some(at.saturating_sub(shift))
    }
}

/// The microphone's side: which samples the take keeps. A pause starts and
/// ends at a sample, and the cut in the timeline is exactly the samples left
/// out, so the microphone and the output stay lined up.
pub struct Hold {
    cuts: Cuts,
    first_at: u64,
    rate: u32,
    /// Microphone samples so far, kept or not.
    heard: usize,
}

impl Hold {
    /// `first_at`: host time of the microphone's first sample.
    pub fn new(first_at: u64, rate: u32) -> Self {
        Self {
            cuts: Cuts::default(),
            first_at,
            rate,
            heard: 0,
        }
    }

    pub fn paused(&self) -> bool {
        self.cuts.paused()
    }

    /// Pauses (or goes on) from the next microphone sample.
    pub fn set(&mut self, on: bool) {
        let at = later(self.first_at, self.heard, self.rate);
        if on {
            self.cuts.pause(at);
        } else {
            self.cuts.resume(at);
        }
    }

    /// The next microphone sample: whether the take keeps it.
    pub fn mic(&mut self) -> bool {
        self.heard += 1;
        !self.cuts.paused()
    }

    pub fn cuts(&self) -> &Cuts {
        &self.cuts
    }
}

/// The output copied so far: the blocks' marks and their samples back to
/// back, then samples of a block whose mark hasn't come yet (samples are
/// copied before their mark).
#[derive(Default)]
pub struct Played {
    pub marks: Vec<Mark>,
    pub samples: Vec<f32>,
    /// Samples of the marked blocks.
    marked: usize,
}

impl Played {
    /// A block's mark (its samples are in already): kept, moved to where it
    /// falls with the paused time cut out, or left out with its samples if it
    /// was heard while paused.
    pub fn mark(&mut self, m: Mark, cuts: &Cuts) {
        let n = m.frames as usize;
        match cuts.place(m.at) {
            Some(at) => {
                self.marks.push(Mark { at, ..m });
                self.marked += n;
            }
            None => {
                let end = (self.marked + n).min(self.samples.len());
                self.samples.drain(self.marked.min(end)..end);
            }
        }
    }

    /// Just paused: blocks copied ahead of time but heard from then on go too.
    pub fn cut(&mut self, cuts: &Cuts) {
        let Some(from) = cuts.paused_at() else {
            return;
        };
        while let Some(n) = self
            .marks
            .last()
            .filter(|m| m.at >= from)
            .map(|m| m.frames as usize)
        {
            let n = n.min(self.marked);
            self.samples.drain(self.marked - n..self.marked);
            self.marked -= n;
            self.marks.pop();
        }
    }

    /// Takes out the marked blocks (another time through); a block still on
    /// its way stays.
    pub fn take(&mut self) -> (Vec<Mark>, Vec<f32>) {
        let n = std::mem::take(&mut self.marked).min(self.samples.len());
        let taken = self.samples.drain(..n).collect();
        (std::mem::take(&mut self.marks), taken)
    }
}

#[cfg(test)]
#[path = "hold_tests.rs"]
mod tests;
