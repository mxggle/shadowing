//! Moves sentence edges onto the pauses actually heard in the audio. Whisper's
//! word times can be a quarter second off (large-v3-turbo tends to end early),
//! which cuts the last syllable off a looped sentence.

use super::pcm::RATE;
use crate::transcript::Sentence;

/// 20 ms frames.
const FRAME: usize = RATE as usize / 50;
const FRAME_SECS: f64 = FRAME as f64 / RATE as f64;

/// Loudness (dB) of each 20 ms frame, fed piece by piece as the audio is decoded.
#[derive(Default)]
pub struct Meter {
    sum: f32,
    n: usize,
    pub db: Vec<f32>,
}

impl Meter {
    pub fn push(&mut self, samples: &[f32]) {
        for s in samples {
            self.sum += s * s;
            self.n += 1;
            if self.n == FRAME {
                self.db
                    .push(10.0 * (self.sum / FRAME as f32 + 1e-10).log10());
                self.sum = 0.0;
                self.n = 0;
            }
        }
    }
}

/// How far an edge may move.
const EARLIER: f64 = 0.35;
const LATER_END: f64 = 0.6;
const LATER_START: f64 = 0.35;
/// A pause has to be this long, and this much quieter than the speech around it.
const MIN_PAUSE: f64 = 0.06;
const MIN_DEPTH_DB: f32 = 10.0;
/// Frames within this of the quietest one count as the same pause.
const QUIET_DB: f32 = 6.0;
/// Let the last sound ring out a little before the loop jumps back.
const TAIL: f64 = 0.08;

pub fn snap(sentences: &mut [Sentence], db: &[f32]) {
    let duration = db.len() as f64 * FRAME_SECS;
    for i in 0..sentences.len() {
        let next_end = sentences.get(i + 1).map_or(duration, |n| n.end);
        let s = &sentences[i];
        // End: onto where the speech stops.
        let lo = (s.end - EARLIER).max(s.start + 0.1);
        let hi = (s.end + LATER_END).min(next_end - 0.1).min(duration);
        if let Some((quiet_from, quiet_to)) = longest_pause(db, lo, hi) {
            sentences[i].end = (quiet_from + TAIL).min(quiet_to);
        }
        // Start of the next sentence: onto where the speech begins.
        if i + 1 < sentences.len() {
            let n = &sentences[i + 1];
            let lo = (n.start - LATER_END).max(sentences[i].end - TAIL);
            // If this end just moved onto a later pause, look for the next start after it too.
            let hi = (n.start + LATER_START)
                .max(sentences[i].end + LATER_START)
                .min(n.end - 0.1);
            if let Some((_, quiet_to)) = longest_pause(db, lo, hi) {
                sentences[i + 1].start = quiet_to;
            }
        }
    }
    for i in 0..sentences.len() {
        if i > 0 {
            sentences[i].start = sentences[i].start.max(sentences[i - 1].start);
        }
        sentences[i].end = sentences[i].end.max(sentences[i].start + 0.05);
    }
    // Never overlap the next sentence: looping one would start inside the other.
    for i in 0..sentences.len().saturating_sub(1) {
        let next = sentences[i + 1].start;
        if sentences[i].end > next {
            sentences[i].end = next.max(sentences[i].start + 0.05);
        }
    }
}

/// The longest quiet stretch in [lo, hi] seconds, if it is a real pause.
pub(super) fn longest_pause(db: &[f32], lo: f64, hi: f64) -> Option<(f64, f64)> {
    let a = (lo.max(0.0) / FRAME_SECS).floor() as usize;
    let b = ((hi / FRAME_SECS).ceil() as usize).min(db.len());
    if b <= a + 1 {
        return None;
    }
    let window = &db[a..b];
    let min = window.iter().copied().fold(f32::INFINITY, f32::min);
    let max = window.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    if max - min < MIN_DEPTH_DB {
        return None; // all speech, or all silence: nothing to snap to
    }
    let mut best: Option<(usize, usize)> = None;
    let mut run_start = None;
    for (k, &e) in window
        .iter()
        .chain(std::iter::once(&f32::INFINITY))
        .enumerate()
    {
        match (e <= min + QUIET_DB, run_start) {
            (true, None) => run_start = Some(k),
            (false, Some(from)) => {
                if best.is_none_or(|(f, t)| k - from >= t - f) {
                    best = Some((from, k));
                }
                run_start = None;
            }
            _ => {}
        }
    }
    let (from, to) = best?;
    let secs = |k: usize| (a + k) as f64 * FRAME_SECS;
    (secs(to) - secs(from) >= MIN_PAUSE).then(|| (secs(from), secs(to)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Loudness track from (seconds, dB) spans.
    fn track(spans: &[(f64, f32)]) -> Vec<f32> {
        spans
            .iter()
            .flat_map(|&(secs, db)| std::iter::repeat_n(db, (secs / FRAME_SECS).round() as usize))
            .collect()
    }

    fn s(start: f64, end: f64) -> Sentence {
        Sentence {
            start,
            end,
            text: String::new(),
            speaker: None,
            unsure: Vec::new(),
        }
    }

    fn round(v: &[Sentence]) -> Vec<(f64, f64)> {
        v.iter()
            .map(|s| {
                (
                    (s.start * 100.0).round() / 100.0,
                    (s.end * 100.0).round() / 100.0,
                )
            })
            .collect()
    }

    #[test]
    fn early_ends_and_starts_move_onto_the_pause() {
        // speech 0.2–1.86, pause 1.86–2.10, speech 2.10–3.42, silence after
        let db = track(&[
            (0.2, -70.0),
            (1.66, -20.0),
            (0.24, -65.0),
            (1.32, -22.0),
            (1.0, -70.0),
        ]);
        let mut v = [s(0.19, 1.55), s(1.82, 3.19)];
        snap(&mut v, &db);
        assert_eq!(round(&v), [(0.19, 1.94), (2.1, 3.5)]);
    }

    #[test]
    fn continuous_speech_is_left_alone() {
        let db = track(&[(3.0, -20.0)]);
        let mut v = [s(0.0, 1.5), s(1.5, 3.0)];
        snap(&mut v, &db);
        assert_eq!(round(&v), [(0.0, 1.5), (1.5, 3.0)]);
    }

    #[test]
    fn a_short_dip_inside_a_word_is_not_a_pause() {
        // 40 ms dip at 1.4 s, real pause from 1.7 s
        let db = track(&[
            (1.4, -20.0),
            (0.04, -60.0),
            (0.26, -20.0),
            (0.5, -65.0),
            (1.0, -20.0),
        ]);
        let mut v = [s(0.0, 1.45), s(2.2, 3.2)];
        snap(&mut v, &db);
        assert_eq!(round(&v)[0], (0.0, 1.78));
    }

    #[test]
    fn a_moved_end_never_overlaps_the_next_sentence() {
        // Two sentences split proportionally inside one segment (no word times):
        // the real pause is at 2.0–2.3 s, well after the guessed boundary at 1.5 s.
        let db = track(&[
            (0.2, -70.0),
            (1.8, -20.0),
            (0.3, -65.0),
            (1.1, -22.0),
            (1.0, -70.0),
        ]);
        let mut v = [s(0.2, 1.5), s(1.5, 3.2)];
        snap(&mut v, &db);
        assert!(v[0].end <= v[1].start, "{:?}", round(&v));
        assert_eq!(round(&v), [(0.2, 2.08), (2.3, 3.48)]);
    }

    #[test]
    fn meter_measures_twenty_millisecond_frames() {
        let mut m = Meter::default();
        m.push(&vec![0.5; FRAME + FRAME / 2]);
        m.push(&vec![0.0; FRAME / 2]);
        assert_eq!(m.db.len(), 2);
        assert!((m.db[0] - (-6.02)).abs() < 0.05, "{}", m.db[0]);
    }
}
