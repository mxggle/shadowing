//! Reading a paragraph aloud on your own (自己读): which sentence you're on,
//! from your voice alone. A sentence ends at a pause once you've said enough
//! of it — "enough" from the original's length for that sentence, scaled by
//! how your pace has compared so far. The highlight follows; the take is split
//! properly afterwards (`segment.rs`), so a wrong guess here only moves the
//! highlight early or late.

use super::vad::FRAME_SECS;

/// A pause this long can end a sentence…
const PAUSE_SECS: f64 = 0.3;
/// …once at least this share of its expected length has been said.
const ENOUGH: f64 = 0.5;
/// After the last sentence, this much quiet finishes the reading.
const END_SECS: f64 = 1.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Now on this sentence (index into the reading).
    Next(usize),
    /// Read to the end.
    Done,
}

pub struct Follow {
    /// Seconds each sentence takes in the original.
    expected: Vec<f64>,
    pub current: usize,
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
        Self {
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
        let enough =
            spoken >= (ENOUGH * expected * self.pace()).max(0.35) && self.voiced >= frames(0.2);
        let last = self.current + 1 >= self.expected.len();
        if last {
            if enough && self.silent >= frames(END_SECS) {
                self.finished = true;
                return Some(Step::Done);
            }
            return None;
        }
        if enough && self.silent >= frames(PAUSE_SECS) {
            self.said += spoken;
            self.meant += expected;
            return Some(self.go(self.current + 1));
        }
        None
    }

    /// Moves to sentence `to` by hand (] / [ while reading).
    pub fn jump(&mut self, to: usize) -> Option<Step> {
        let to = to.min(self.expected.len().saturating_sub(1));
        (to != self.current).then(|| self.go(to))
    }

    fn go(&mut self, to: usize) -> Step {
        self.current = to;
        self.begun = None;
        self.voiced = 0;
        Step::Next(to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds speech (true) and pause (false) stretches, in seconds; returns the steps and the frames they came at.
    fn read(f: &mut Follow, parts: &[(bool, f64)]) -> Vec<(usize, Step)> {
        let mut at = 0;
        let mut out = Vec::new();
        for &(voiced, secs) in parts {
            for _ in 0..frames(secs) {
                if let Some(s) = f.frame(at, voiced) {
                    out.push((at, s));
                }
                at += 1;
            }
        }
        out
    }

    #[test]
    fn follows_sentence_ends_but_not_short_pauses_inside() {
        let mut f = Follow::new(vec![2.0, 1.0, 2.0]);
        let steps = read(
            &mut f,
            &[
                (false, 0.5),
                (true, 0.6), // a breath inside the first sentence: not enough said yet
                (false, 0.4),
                (true, 1.3),
                (false, 0.5), // the end of the first
                (true, 1.0),
                (false, 0.4),
                (true, 2.1),
                (false, 2.0),
            ],
        );
        let kinds: Vec<Step> = steps.iter().map(|s| s.1).collect();
        assert_eq!(kinds, [Step::Next(1), Step::Next(2), Step::Done]);
        // The first move comes 0.3 s into the pause after "1.3 s" of speech (at 2.8 s + 0.3 s).
        assert_eq!(steps[0].0, frames(3.1) - 1);
    }

    #[test]
    fn a_slow_reader_is_given_more_time() {
        let mut f = Follow::new(vec![1.0, 1.0, 1.0]);
        read(&mut f, &[(true, 1.6), (false, 0.4)]);
        assert_eq!(f.current, 1);
        assert!((f.pace() - 1.6).abs() < 0.05);
        // 0.7 s then a pause: at 1.6× pace half the sentence is 0.8 s, so not yet.
        let steps = read(&mut f, &[(true, 0.7), (false, 0.4)]);
        assert!(steps.is_empty());
    }

    #[test]
    fn jumping_by_hand() {
        let mut f = Follow::new(vec![1.0, 1.0, 1.0]);
        assert_eq!(f.jump(2), Some(Step::Next(2)));
        assert_eq!(f.jump(9), None, "already on the last");
        assert_eq!(f.jump(1), Some(Step::Next(1)));
    }
}
