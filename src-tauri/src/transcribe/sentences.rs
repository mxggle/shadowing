//! Whisper output → timed sentences. Segments carry punctuated text; words
//! carry precise times but (usually) no punctuation. Sentences are split on the
//! segment text and timed by lining their letters up with the words' letters.
//! When the text comes back without punctuation (common for Japanese without a
//! language hint), Whisper's own segment breaks — one per utterance — stand in for it.

use super::long::Long;
use crate::subtitles::is_cjk;
use crate::transcript::Sentence;
use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Verbose {
    #[serde(default)]
    pub segments: Vec<Segment>,
    #[serde(default)]
    pub words: Vec<Word>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    #[serde(default)]
    pub avg_logprob: Option<f64>,
    #[serde(default)]
    pub no_speech_prob: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Word {
    pub word: String,
    pub start: f64,
    pub end: f64,
}

/// Whisper's own rule of thumb for text invented over silence or music.
fn is_hallucination(s: &Segment) -> bool {
    s.no_speech_prob.unwrap_or(0.0) > 0.6 && s.avg_logprob.unwrap_or(0.0) < -1.0
}

/// Pieces transcribed separately, each with its start time in the whole file.
/// `db`: loudness of the whole file (see `snap::Meter`), for cutting long
/// sentences at a pause when they have no comma.
pub fn build(pieces: Vec<(f64, Verbose)>, db: &[f32]) -> Vec<Sentence> {
    let mut segments = Vec::new();
    let mut words = Vec::new();
    for (offset, v) in pieces {
        let dropped: Vec<(f64, f64)> = v
            .segments
            .iter()
            .filter(|s| is_hallucination(s))
            .map(|s| (s.start, s.end))
            .collect();
        segments.extend(
            v.segments
                .into_iter()
                .filter(|s| !is_hallucination(s))
                .map(|s| Segment {
                    start: s.start + offset,
                    end: s.end + offset,
                    ..s
                }),
        );
        words.extend(
            v.words
                .into_iter()
                .filter(|w| {
                    !dropped
                        .iter()
                        .any(|&(a, b)| w.start >= a - 0.01 && w.end <= b + 0.01)
                })
                .map(|w| Word {
                    start: w.start + offset,
                    end: w.end + offset,
                    ..w
                }),
        );
    }

    let text = join_segments(&segments);
    let mut clock = Clock::new(words.iter().map(|w| (w.word.as_str(), w.start, w.end)));
    if clock.0.is_empty() {
        clock = Clock::new(segments.iter().map(|s| (s.text.as_str(), s.start, s.end)));
    }
    let pieces = split_sentences(&text);
    let total: usize = pieces.iter().map(|p| letters(p)).sum();
    if clock.0.is_empty() || total == 0 {
        return Vec::new();
    }
    // Segment text and words come from the same decode, so letter counts nearly
    // always match; scaling keeps small mismatches (e.g. "10" vs "ten") from drifting.
    let scale = clock.0.len() as f64 / total as f64;

    let mut out: Vec<Sentence> = Vec::new();
    let mut pos = 0;
    let long = Long {
        clock: &clock,
        scale,
        db,
    };
    for piece in pieces {
        let n = letters(&piece);
        long.split(&piece, pos, pos + n, &mut out);
        pos += n;
    }
    for i in 1..out.len() {
        out[i].start = out[i].start.max(out[i - 1].start);
        out[i].end = out[i].end.max(out[i].start + 0.05);
    }
    out
}

pub(super) fn counts(c: char) -> bool {
    c.is_alphanumeric()
}

fn letters(s: &str) -> usize {
    s.chars().filter(|c| counts(*c)).count()
}

/// Marks a sentence break that has no punctuation of its own.
const BREAK: char = '\n';

/// Joins segment texts: a space between words, none next to CJK. Unless the text
/// is punctuated, each segment end is also a sentence end (but not after a
/// comma, or before a lowercase word that carries on the sentence).
fn join_segments(segments: &[Segment]) -> String {
    let parts: Vec<&str> = segments
        .iter()
        .map(|s| s.text.trim())
        .filter(|t| !t.is_empty())
        .collect();
    let ended = |t: &str| {
        t.trim_end_matches(CLOSING)
            .ends_with(|c| TERMINAL.contains(&c) || c == '.')
    };
    let punctuated = 2 * parts.iter().filter(|t| ended(t)).count() >= parts.len();
    let mut out = String::new();
    for part in parts {
        if let (Some(a), Some(b)) = (out.chars().last(), part.chars().next()) {
            if !punctuated && !SOFT_BREAKS.contains(&a) && !ended(&out) && !b.is_lowercase() {
                out.push(BREAK);
            } else if !is_cjk(a) && !is_cjk(b) {
                out.push(' ');
            }
        }
        out.push_str(part);
    }
    out
}

/// Start and end time for every letter, spread evenly across its word.
pub(super) struct Clock(Vec<(f64, f64)>);

impl Clock {
    fn new<'a>(items: impl Iterator<Item = (&'a str, f64, f64)>) -> Self {
        let mut v = Vec::new();
        for (text, start, end) in items {
            let n = letters(text);
            for k in 0..n {
                let at = |k: usize| start + (end - start) * k as f64 / n as f64;
                v.push((at(k), at(k + 1)));
            }
        }
        Self(v)
    }

    /// Time span of sentence letters `a..b` (sentence-letter units, scaled to clock letters).
    pub(super) fn span(&self, a: usize, b: usize, scale: f64) -> (f64, f64) {
        let last = self.0.len() - 1;
        let i0 = ((a as f64 * scale).floor() as usize).min(last);
        let i1 = ((b as f64 * scale).ceil() as usize)
            .saturating_sub(1)
            .clamp(i0, last);
        (self.0[i0].0, self.0[i1].1)
    }
}

const TERMINAL: &[char] = &['。', '．', '！', '？', '!', '?', '…'];
const CLOSING: &[char] = &['」', '』', '）', ')', '"', '”', '’', '\'', ']', '】'];
const ABBREVIATIONS: &[&str] = &[
    "mr", "mrs", "ms", "dr", "st", "vs", "etc", "e.g", "i.e", "jr", "sr", "prof",
];

/// Splits on sentence-ending punctuation (keeping closing quotes with their
/// sentence), on segment breaks, and on spaces between CJK characters (which
/// Whisper puts between unpunctuated Japanese or Chinese sentences).
fn split_sentences(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        cur.push(c);
        i += 1;
        let cjk_space =
            c == ' ' && i >= 2 && is_cjk(chars[i - 2]) && chars.get(i).is_some_and(|&n| is_cjk(n));
        let ends = TERMINAL.contains(&c)
            || c == BREAK
            || cjk_space
            || (c == '.' && full_stop(&cur, chars.get(i).copied()));
        if !ends {
            continue;
        }
        while i < chars.len() && (CLOSING.contains(&chars[i]) || TERMINAL.contains(&chars[i])) {
            cur.push(chars[i]);
            i += 1;
        }
        push_sentence(&mut out, &cur);
        cur.clear();
    }
    push_sentence(&mut out, &cur);
    out
}

/// A '.' ends a sentence when followed by a space or the end, and isn't "Mr." or "3.5".
fn full_stop(so_far: &str, next: Option<char>) -> bool {
    if next.is_some_and(|n| !n.is_whitespace() && !CLOSING.contains(&n)) {
        return false;
    }
    let word: String = so_far[..so_far.len() - 1]
        .chars()
        .rev()
        .take_while(|c| !c.is_whitespace())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    !ABBREVIATIONS.contains(&word.to_lowercase().as_str())
}

/// Bits with no letters (a stray "…" or "」") join the sentence before them.
fn push_sentence(out: &mut Vec<String>, s: &str) {
    let s = s.trim();
    if s.is_empty() {
        return;
    }
    match out.last_mut() {
        Some(last) if letters(s) == 0 => last.push_str(s),
        _ => out.push(s.to_string()),
    }
}

pub(super) const SOFT_BREAKS: &[char] = &['、', '，', ',', ';', '；', '：', ':'];

#[cfg(test)]
#[path = "sentences_tests.rs"]
mod tests;
