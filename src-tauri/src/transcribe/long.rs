//! Sentences too long to loop comfortably, cut in two (recursively).

use super::sentences::{counts, Clock, SOFT_BREAKS};
use super::snap::longest_pause;
use crate::subtitles::is_cjk;
use crate::transcript::Sentence;

/// Longer sentences are split.
pub const MAX_SENTENCE_SECS: f64 = 15.0;

/// Splits sentences longer than `MAX_SENTENCE_SECS`: at the comma closest to the
/// middle, or failing that at the longest pause heard in the middle part.
pub(super) struct Long<'a> {
    pub clock: &'a Clock,
    pub scale: f64,
    /// Loudness of the whole file (see `snap::Meter`).
    pub db: &'a [f32],
}

impl Long<'_> {
    /// `text` is sentence letters `a..b`.
    pub fn split(&self, text: &str, a: usize, b: usize, out: &mut Vec<Sentence>) {
        let (start, end) = self.clock.span(a, b, self.scale);
        if end - start > MAX_SENTENCE_SECS {
            let at = middle_comma(text, b - a).or_else(|| self.middle_pause(text, a, b));
            if let Some((byte, k)) = at {
                let (left, right) = text.split_at(byte);
                self.split(left.trim(), a, a + k, out);
                self.split(right.trim(), a + k, b, out);
                return;
            }
        }
        out.push(Sentence {
            start,
            end,
            text: text.to_string(),
            speaker: None,
            unsure: Vec::new(),
            times: Vec::new(),
        });
    }

    /// The place between two words nearest the longest pause in the middle 60%.
    fn middle_pause(&self, text: &str, a: usize, b: usize) -> Option<(usize, usize)> {
        let n = b - a;
        if n < 5 {
            return None;
        }
        let (lo, _) = self.clock.span(a + n / 5, a + n / 5 + 1, self.scale);
        let (_, hi) = self
            .clock
            .span(a + n * 4 / 5 - 1, a + n * 4 / 5, self.scale);
        let (from, to) = longest_pause(self.db, lo, hi)?;
        let quiet = (from + to) / 2.0;
        word_gaps(text)
            .filter(|&(_, k)| k > 0 && k < n)
            .min_by(|&(_, x), &(_, y)| {
                let off =
                    |k: usize| (self.clock.span(a + k, a + k + 1, self.scale).0 - quiet).abs();
                off(x).total_cmp(&off(y))
            })
    }
}

/// Places a sentence may be cut: (byte index, letters before it). Between words,
/// or anywhere next to a CJK character.
fn word_gaps(text: &str) -> impl Iterator<Item = (usize, usize)> + '_ {
    let mut seen = 0;
    let mut prev: Option<char> = None;
    text.char_indices().filter_map(move |(idx, c)| {
        let gap = counts(c) && prev.is_some_and(|p| !counts(p) || is_cjk(p) || is_cjk(c));
        let at = gap.then_some((idx, seen));
        if counts(c) {
            seen += 1;
        }
        prev = Some(c);
        at
    })
}

/// The comma closest to the middle: byte index to split at and letters before it.
fn middle_comma(text: &str, n: usize) -> Option<(usize, usize)> {
    let mut seen = 0;
    let mut best: Option<(usize, usize)> = None;
    for (idx, c) in text.char_indices() {
        if counts(c) {
            seen += 1;
            continue;
        }
        if !SOFT_BREAKS.contains(&c) || seen == 0 || seen == n {
            continue;
        }
        let dist = |k: usize| (2 * k).abs_diff(n);
        if best.is_none_or(|(_, k)| dist(seen) < dist(k)) {
            best = Some((idx + c.len_utf8(), seen));
        }
    }
    best
}
