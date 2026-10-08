//! Whisper output → timed sentences. Segments carry punctuated text; words
//! carry precise times but (usually) no punctuation. Sentences are split on the
//! segment text and timed by lining their letters up with the words' letters.

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

/// Longer sentences are split at a comma near the middle, if there is one.
pub const MAX_SENTENCE_SECS: f64 = 15.0;

/// Whisper's own rule of thumb for text invented over silence or music.
fn is_hallucination(s: &Segment) -> bool {
    s.no_speech_prob.unwrap_or(0.0) > 0.6 && s.avg_logprob.unwrap_or(0.0) < -1.0
}

/// Pieces transcribed separately, each with its start time in the whole file.
pub fn build(pieces: Vec<(f64, Verbose)>) -> Vec<Sentence> {
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

    let text = join(segments.iter().map(|s| s.text.as_str()));
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
    for piece in pieces {
        let n = letters(&piece);
        split_long(&piece, pos, pos + n, &clock, scale, &mut out);
        pos += n;
    }
    for i in 1..out.len() {
        out[i].start = out[i].start.max(out[i - 1].start);
        out[i].end = out[i].end.max(out[i].start + 0.05);
    }
    out
}

fn counts(c: char) -> bool {
    c.is_alphanumeric()
}

fn letters(s: &str) -> usize {
    s.chars().filter(|c| counts(*c)).count()
}

/// Joins pieces of text: a space between words, none next to CJK.
fn join<'a>(parts: impl Iterator<Item = &'a str>) -> String {
    let mut out = String::new();
    for part in parts.map(str::trim).filter(|p| !p.is_empty()) {
        if let (Some(a), Some(b)) = (out.chars().last(), part.chars().next()) {
            if !is_cjk(a) && !is_cjk(b) {
                out.push(' ');
            }
        }
        out.push_str(part);
    }
    out
}

/// Start and end time for every letter, spread evenly across its word.
struct Clock(Vec<(f64, f64)>);

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
    fn span(&self, a: usize, b: usize, scale: f64) -> (f64, f64) {
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

/// Splits on sentence-ending punctuation (keeping closing quotes with their sentence).
fn split_sentences(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        cur.push(c);
        i += 1;
        let ends = TERMINAL.contains(&c) || (c == '.' && full_stop(&cur, chars.get(i).copied()));
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

const SOFT_BREAKS: &[char] = &['、', '，', ',', ';', '；', '：', ':'];

fn split_long(text: &str, a: usize, b: usize, clock: &Clock, scale: f64, out: &mut Vec<Sentence>) {
    let (start, end) = clock.span(a, b, scale);
    if end - start > MAX_SENTENCE_SECS {
        if let Some((byte, k)) = middle_break(text, b - a) {
            let (left, right) = text.split_at(byte);
            split_long(left.trim(), a, a + k, clock, scale, out);
            split_long(right.trim(), a + k, b, clock, scale, out);
            return;
        }
    }
    out.push(Sentence {
        start,
        end,
        text: text.to_string(),
    });
}

/// The comma (or space between CJK) closest to the middle: byte index to split at
/// and letters before it.
fn middle_break(text: &str, n: usize) -> Option<(usize, usize)> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut seen = 0;
    let mut best: Option<(usize, usize)> = None;
    for (j, &(idx, c)) in chars.iter().enumerate() {
        if counts(c) {
            seen += 1;
            continue;
        }
        let cjk_space = c == ' '
            && j > 0
            && chars.get(j + 1).is_some_and(|&(_, n)| is_cjk(n))
            && is_cjk(chars[j - 1].1);
        if !(SOFT_BREAKS.contains(&c) || cjk_space) || seen == 0 || seen == n {
            continue;
        }
        let dist = |k: usize| (2 * k).abs_diff(n);
        if best.is_none_or(|(_, k)| dist(seen) < dist(k)) {
            best = Some((idx + c.len_utf8(), seen));
        }
    }
    best
}

#[cfg(test)]
#[path = "sentences_tests.rs"]
mod tests;
