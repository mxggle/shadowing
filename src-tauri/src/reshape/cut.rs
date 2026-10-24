//! Where a sentence is cut in two: the text at the cursor, and the time
//! that word is said (or, without times, a guess from how far through the
//! words it is), moved onto a pause heard near there (as transcription moves
//! sentence edges, see `transcribe::snap`).

use super::len16;
use crate::audio::decode::Decoder;
use crate::timing;
use crate::transcribe::snap;
use crate::transcript::Sentence;
use std::path::Path;

/// A sentence's text cut in two, each part trimmed.
#[derive(Debug, PartialEq)]
pub(super) struct Cut {
    pub(super) first: String,
    pub(super) second: String,
    /// Where the second part began in the text (UTF-16 units).
    pub(super) second_from: u32,
}

/// Cuts `text` at `at` (UTF-16 units, as the editor counts); none unless
/// both parts have words in them.
pub(super) fn cut_text(text: &str, at: u32) -> Option<Cut> {
    let (mut byte, mut units) = (0, 0);
    for (i, c) in text.char_indices() {
        if units + c.len_utf16() as u32 > at {
            break;
        }
        units += c.len_utf16() as u32;
        byte = i + c.len_utf8();
    }
    let (a, b) = text.split_at(byte);
    let (first, second) = (a.trim_end(), b.trim_start());
    let words = |s: &str| s.chars().any(char::is_alphanumeric);
    (words(first) && words(second)).then(|| Cut {
        first: first.into(),
        second: second.into(),
        second_from: units + len16(&b[..b.len() - second.len()]),
    })
}

/// How far through the sentence the cut is: when the second part's first
/// word is said, if transcription timed it; else how far through the words
/// (spaces and punctuation aren't said).
fn ratio(s: &Sentence, cut: &Cut) -> f64 {
    let span = s.end - s.start;
    let timed = s.times.iter().find(|&&(at, _)| at >= cut.second_from);
    if let (Some(&(_, t)), true) = (timed, span > 0.0) {
        return ((t - s.start) / span).clamp(0.0, 1.0);
    }
    let said = |s: &str| s.chars().filter(|c| c.is_alphanumeric()).count() as f64;
    let (a, b) = (said(&cut.first), said(&cut.second));
    a / (a + b)
}

/// A pause is looked for this far either side of the guess: 30% of the
/// sentence (the words aren't said at an even pace, and a sentence's own
/// times can be off), within these bounds (s).
const REACH: f64 = 0.3;
const REACH_MIN: f64 = 0.4;
const REACH_MAX: f64 = 1.5;
/// A pause found there is followed out up to this much further (s).
const FOLLOW: f64 = 1.0;
/// Neither part is left shorter than this (s).
const MIN_PART: f64 = 0.1;
/// A pause further from the guess has to be longer to be chosen: this many
/// seconds longer for each second further.
const FARTHER: f64 = 0.3;
/// This much quieter than the speech around it is a pause, even where a
/// moment somewhere else (digital silence) is quieter still.
const BELOW_SPEECH_DB: f32 = 30.0;

/// Where in the sentence a cut `ratio` of the way through its words is
/// guessed to be, and the stretch [lo, hi] a pause is looked for in.
fn guess(s: &Sentence, ratio: f64) -> (f64, f64, f64) {
    let span = s.end - s.start;
    let edge = MIN_PART.min(span / 2.0);
    let t = (s.start + span * ratio)
        .min(s.end - edge)
        .max(s.start + edge);
    let reach = (span * REACH).clamp(REACH_MIN, REACH_MAX);
    let lo = (t - reach).max(s.start + MIN_PART);
    let hi = (t + reach).min(s.end - MIN_PART);
    (t, lo, hi)
}

/// Pauses reaching into frames [a, b) of `db`: as quiet as the quietest
/// there, or well below the speech there (when that is a pause, not just
/// quieter speech), followed out on either side to where the speech starts
/// again. Quiet that runs to either end of `db` (before the first word or
/// after the last, as far as was heard) has no speech on that side: no
/// place to cut.
fn pauses(db: &[f32], a: usize, b: usize) -> Vec<(usize, usize)> {
    let b = b.min(db.len());
    let mut window = db[a.min(b)..b].to_vec();
    window.sort_by(f32::total_cmp);
    let (Some(&min), Some(&max)) = (window.first(), window.last()) else {
        return Vec::new();
    };
    if window.len() < 2 || max - min < snap::MIN_DEPTH_DB {
        return Vec::new();
    }
    let speech = window[(window.len() - 1) * 9 / 10];
    let limit = (min + snap::QUIET_DB).max(speech - BELOW_SPEECH_DB);
    let quiet = |k: usize| db[k] <= limit;
    let mut runs = Vec::new();
    let mut k = a;
    while k < b {
        if quiet(k) {
            let from = (0..k).rev().take_while(|&j| quiet(j)).last().unwrap_or(k);
            let to = (k..db.len()).find(|&j| !quiet(j)).unwrap_or(db.len());
            if from > 0 && to < db.len() {
                runs.push((from, to));
            }
            k = to;
        } else {
            k += 1;
        }
    }
    runs
}

/// Where the first part ends and the second begins: at the pause reaching
/// into [lo, hi] that is longest for how near it is to the guess `t`, else
/// both right at `t`. `db` is the loudness of 20 ms frames from `from` seconds.
fn cut_times(t: f64, lo: f64, hi: f64, db: &[f32], from: f64) -> (f64, f64) {
    let frame = |x: f64| ((x - from).max(0.0) / snap::FRAME_SECS).round() as usize;
    let secs = |k: usize| from + k as f64 * snap::FRAME_SECS;
    let score = |(a, b): (f64, f64)| (b - a) - FARTHER * (a - t).max(t - b).max(0.0);
    pauses(db, frame(lo), frame(hi))
        .into_iter()
        .map(|(a, b)| (secs(a), secs(b)))
        .filter(|(a, b)| b - a >= snap::MIN_PAUSE)
        .max_by(|&x, &y| score(x).total_cmp(&score(y)))
        .map_or((t, t), |(quiet, sound)| {
            ((quiet + snap::TAIL).min(sound), sound)
        })
}

/// Where the first part ends and the second begins, for `s` cut at `cut`:
/// from the words' times (or a guess), then moved onto a pause heard in `audio` near there.
pub(super) fn times(s: &Sentence, cut: &Cut, audio: &Path) -> (f64, f64) {
    let (guessed, lo, hi) = guess(s, ratio(s, cut));
    if hi - lo <= snap::MIN_PAUSE {
        return (guessed, guessed);
    }
    let from = (lo - FOLLOW).max(s.start + MIN_PART);
    let to = (hi + FOLLOW).min(s.end - MIN_PART);
    cut_times(guessed, lo, hi, &loudness(audio, from, to), from)
}

/// Loudness of each 20 ms frame of the track from `from` to `to` seconds,
/// as the speech in a sentence is measured when it's transcribed; nothing
/// when the file can't be read.
fn loudness(audio: &Path, from: f64, to: f64) -> Vec<f32> {
    let Ok(mut d) = Decoder::open(audio) else {
        return Vec::new();
    };
    let (rate, ch) = (d.sample_rate as f64, d.channels.max(1));
    let frame = ((rate * snap::FRAME_SECS).round() as usize).max(1);
    let want = ((to - from) * rate).max(0.0) as usize;
    if d.seek((from.max(0.0) * rate) as u64).is_err() {
        return Vec::new();
    }
    let mut mono = Vec::with_capacity(want);
    let mut buf = vec![0.0; 4096 * ch];
    while mono.len() < want {
        let Ok(n) = d.read(&mut buf) else {
            return Vec::new();
        };
        if n == 0 {
            break;
        }
        mono.extend(
            buf[..n * ch]
                .chunks(ch)
                .map(|f| f.iter().sum::<f32>() / ch as f32),
        );
    }
    mono.truncate(want);
    mono.chunks_exact(frame)
        .map(|f| 10.0 * (f.iter().map(|v| v * v).sum::<f32>() / frame as f32 + 1e-10).log10())
        .collect()
}

/// Underlines that fall in [from, to), counted from `from`.
fn within(unsure: &[[u32; 2]], from: u32, to: u32) -> Vec<[u32; 2]> {
    unsure
        .iter()
        .filter_map(|&[a, b]| {
            let (a, b) = (a.max(from), b.min(to));
            (a < b).then(|| [a - from, b - from])
        })
        .collect()
}

/// The two sentences `s` becomes, cut at `cut`, the first ending at `end` and
/// the second starting at `start`.
pub(super) fn halves(s: &Sentence, cut: Cut, (end, start): (f64, f64)) -> [Sentence; 2] {
    let first_len = len16(&cut.first);
    let second_to = cut.second_from + len16(&cut.second);
    [
        Sentence {
            end,
            unsure: within(&s.unsure, 0, first_len),
            times: timing::within(&s.times, 0, first_len),
            text: cut.first,
            ..s.clone()
        },
        Sentence {
            start,
            unsure: within(&s.unsure, cut.second_from, second_to),
            times: timing::within(&s.times, cut.second_from, second_to),
            text: cut.second,
            ..s.clone()
        },
    ]
}

#[cfg(test)]
#[path = "cut_tests.rs"]
mod tests;
