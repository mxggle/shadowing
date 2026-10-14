//! Reading a paragraph aloud on your own (自己读): which sentence you're on,
//! from your voice alone. A sentence ends at a pause once you've said enough
//! of it — "enough" from the original's length for that sentence, scaled by
//! how your pace has compared so far. The highlight follows; the take is split
//! properly afterwards (`segment.rs`), with where the highlight moved as hints
//! and how far it got as the sentences read.

use super::vad::FRAME_SECS;

/// A pause this long ends a sentence once most of it has been said…
const PAUSE_SECS: f64 = 0.3;
const MOST: f64 = 0.75;
/// …and only a longer one when just half has (a breath inside a long sentence
/// is shorter; a fast reader's first sentence looks like half of it).
const LONG_PAUSE_SECS: f64 = 0.4;
const HALF: f64 = 0.5;
/// Shortest sentence said (a "はい").
const SHORTEST_SECS: f64 = 0.2;
/// A sentence's time in the original keeps some quiet at its edges.
const EDGES_SECS: f64 = 0.2;
/// After the last sentence, this much quiet finishes the reading.
const END_SECS: f64 = 1.5;
/// One sentence moves your pace by at most this factor either way, so a wrong
/// move doesn't make the next ones wrong too (down to how fast anyone reads).
const PACE_STEP: (f64, f64) = (0.6, 1.5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Now on this sentence (index into the reading).
    Next(usize),
    /// Read to the end.
    Done,
}

/// What the highlight did, for splitting the reading afterwards.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Followed {
    /// Per boundary (between sentence k and k + 1): the level frame the
    /// highlight last moved across it; none if it didn't, or went back over it.
    pub hints: Vec<Option<usize>>,
    /// Sentences read: those before the highlight, and the one it's on once you'd started it.
    pub reached: usize,
}

pub struct Follow {
    /// Seconds each sentence takes in the original.
    expected: Vec<f64>,
    pub current: usize,
    hints: Vec<Option<usize>>,
    /// Frame the current sentence's first voice was heard.
    begun: Option<usize>,
    voiced: usize,
    silent: usize,
    /// Seconds you took / the original took, for the sentences done.
    said: f64,
    meant: f64,
    finished: bool,
}

fn frames(secs: f64) -> usize {
    (secs / FRAME_SECS).round() as usize
}

impl Follow {
    pub fn new(expected: Vec<f64>) -> Self {
        let expected = expected
            .into_iter()
            .map(|e| (e - EDGES_SECS).max(SHORTEST_SECS))
            .collect::<Vec<_>>();
        Self {
            hints: vec![None; expected.len().saturating_sub(1)],
            expected,
            current: 0,
            begun: None,
            voiced: 0,
            silent: 0,
            said: 0.0,
            meant: 0.0,
            finished: false,
        }
    }

    /// Your pace relative to the original (1 = same), from the sentences done so far.
    pub fn pace(&self) -> f64 {
        if self.meant < 1.0 {
            1.0
        } else {
            (self.said / self.meant).clamp(0.6, 1.8)
        }
    }

    /// One 10 ms frame (index `at`), voiced or not.
    pub fn frame(&mut self, at: usize, voiced: bool) -> Option<Step> {
        if self.finished {
            return None;
        }
        if voiced {
            self.begun.get_or_insert(at);
            self.voiced += 1;
            self.silent = 0;
            return None;
        }
        self.silent += 1;
        let begun = self.begun?;
        let spoken = (at + 1 - self.silent - begun) as f64 * FRAME_SECS;
        let expected = self.expected.get(self.current).copied().unwrap_or(1.0);
        let share = |s: f64| (s * expected * self.pace()).max(SHORTEST_SECS);
        let pause = if spoken >= share(MOST) {
            PAUSE_SECS
        } else if spoken >= share(HALF) {
            LONG_PAUSE_SECS
        } else {
            return None;
        };
        if self.voiced < frames(SHORTEST_SECS) {
            return None;
        }
        let last = self.current + 1 >= self.expected.len();
        if last {
            if self.silent >= frames(END_SECS) {
                self.finished = true;
                return Some(Step::Done);
            }
            return None;
        }
        if self.silent >= frames(pause) {
            self.said += spoken.clamp(PACE_STEP.0 * expected, PACE_STEP.1 * expected);
            self.meant += expected;
            return Some(self.go(self.current + 1, at));
        }
        None
    }

    /// Moves to sentence `to` by hand (] / [ while reading) at frame `at`.
    pub fn jump(&mut self, to: usize, at: usize) -> Option<Step> {
        let to = to.min(self.expected.len().saturating_sub(1));
        (to != self.current).then(|| self.go(to, at))
    }

    fn go(&mut self, to: usize, at: usize) -> Step {
        if to > self.current {
            self.hints[to - 1] = Some(at);
        } else {
            self.hints[to..].iter_mut().for_each(|h| *h = None);
        }
        self.current = to;
        self.begun = None;
        self.voiced = 0;
        Step::Next(to)
    }

    pub fn followed(&self) -> Followed {
        let reached = if self.finished {
            self.expected.len()
        } else {
            self.current + usize::from(self.begun.is_some())
        };
        Followed {
            hints: self.hints.clone(),
            reached: reached.min(self.expected.len()),
        }
    }
}

#[cfg(test)]
#[path = "follow_tests.rs"]
mod tests;
