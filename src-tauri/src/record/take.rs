//! Turns what was captured into a take: the microphone and the engine's
//! output on one timeline, the original taken out of the mic, trimmed to the
//! two voices, levels matched. Two lanes: the original as you heard it (speed
//! included) and you. 边听边说 keeps them in step (a stereo file); 听完再说
//! lays them one after the other (`turns`), so they fit in one channel.

use super::echo;
use super::follow::Followed;
use super::vad::{self, FRAME_SECS};
use crate::audio::resample::Resampler;
use crate::audio::tap::Mark;

/// Working and storage rate (speech to 16 kHz, half the size of 48 kHz).
pub const RATE: u32 = 32_000;
/// Kept before your first word and after your last.
pub const LEAD_SECS: f64 = 0.15;
pub const TAIL_SECS: f64 = 0.3;
pub const MARGIN_SECS: f64 = 0.1;
/// Quiet takes are brought up to the original's level, at most this much.
const MAX_GAIN: f32 = 8.0;
/// Shadowing lags searched (you after the original).
const MAX_LAG_SECS: f64 = 1.5;
/// Between the original and you when one follows the other in a file.
const TURN_GAP_SECS: f64 = 0.5;

/// Whether you come after the original rather than over it (as `inTurns` in src/lib/takes.ts).
pub fn in_turns(mode: Mode) -> bool {
    mode != Mode::Shadow
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Hear the sentence, then say it.
    Listen,
    /// Say it along with the original.
    Shadow,
    /// Read it on your own, the original silent (a paragraph at a time).
    Read,
}

/// Everything captured during a take.
pub struct Raw {
    pub mic: Vec<f32>,
    pub mic_rate: u32,
    /// Host time (ns) of `mic[0]`.
    pub mic_at: u64,
    /// The engine's output: blocks as marked, samples back to back.
    pub marks: Vec<Mark>,
    pub played: Vec<f32>,
    /// Mic sample at which your turn began (the original had finished).
    pub turn: usize,
    /// Reading a paragraph on your own: what the live highlight did.
    pub followed: Option<Followed>,
}

pub struct Built {
    pub original: Vec<f32>,
    pub mine: Vec<f32>,
    /// Seconds in the file where each voice is.
    pub original_span: (f64, f64),
    pub mine_span: (f64, f64),
    /// How far behind the original you were (shadowing).
    pub lag_ms: Option<i32>,
}

pub const NOTHING: &str = "没听到你的声音，再试一次？";
const NOT_PLAYED: &str = "原句没有放出来（刚开始就跳过了，或者声音被关掉了），这次没有保存";

/// Fails when the original never sounded, or there's no voice of yours.
pub fn build(raw: &Raw, mode: Mode) -> Result<Built, &'static str> {
    let mic = convert(&raw.mic, raw.mic_rate, RATE);
    let played = place(
        &raw.marks,
        &raw.played,
        raw.mic_at,
        raw.mic.len() as f64 / raw.mic_rate as f64,
    );
    let mut mine = if played.iter().any(|v| v.abs() > 1e-4) {
        echo::cancel(&mic, &played, RATE)
    } else {
        mic
    };
    let turn = (raw.turn as f64 * RATE as f64 / raw.mic_rate.max(1) as f64) as usize;
    if mode == Mode::Listen {
        // Before your turn the mic only heard the original.
        let turn = turn.min(mine.len());
        mine[..turn].fill(0.0);
    }
    let original_span = span(&played, &active(&played)).ok_or(NOT_PLAYED)?;
    let mine_span = span(&mine, &vad::voiced(&levels(&mine)))
        .map(|(a, b)| ((a - LEAD_SECS).max(0.0), b + TAIL_SECS))
        .ok_or(NOTHING)?;
    if mode == Mode::Listen {
        let cut =
            |x: &[f32], (a, b): (f64, f64)| x[at(a).min(x.len())..at(b).min(x.len())].to_vec();
        let (original, mine, original_span, mine_span) =
            turns(&cut(&played, original_span), &cut(&mine, mine_span));
        return Ok(Built {
            original,
            mine,
            original_span,
            mine_span,
            lag_ms: None,
        });
    }
    let start = (original_span.0.min(mine_span.0) - MARGIN_SECS).max(0.0);
    let end = (original_span.1.max(mine_span.1) + MARGIN_SECS).min(mine.len() as f64 / RATE as f64);
    let cut = |x: &[f32]| x[at(start).min(x.len())..at(end).min(x.len())].to_vec();
    let (original, mut mine_cut) = (cut(&played), cut(&mine));
    let shift = |(a, b): (f64, f64)| (a - start, (b - start).min(end - start));
    let (original_span, mine_span) = (shift(original_span), shift(mine_span));
    match_level(&original, original_span, &mut mine_cut, mine_span);
    let lag_ms = (mode == Mode::Shadow)
        .then(|| lag(&original, &mine_cut))
        .flatten();
    Ok(Built {
        original,
        mine: mine_cut,
        original_span,
        mine_span,
        lag_ms,
    })
}

/// Two lanes (the original, you) and where each voice is in them (seconds).
pub type Piece = (Vec<f32>, Vec<f32>, (f64, f64), (f64, f64));

/// The original, a short gap, then `voice` (each as given), as two lanes that
/// never overlap — they're stored in one channel. Your level is matched to the
/// original's.
pub fn turns(original: &[f32], voice: &[f32]) -> Piece {
    let lead = at(MARGIN_SECS);
    let you = lead + original.len() + at(TURN_GAP_SECS);
    let mut l = vec![0.0; you + voice.len()];
    l[lead..lead + original.len()].copy_from_slice(original);
    let mut r = vec![0.0; you + voice.len()];
    r[you..].copy_from_slice(voice);
    let secs = |n: usize| n as f64 / RATE as f64;
    let os = (secs(lead), secs(lead + original.len()));
    let ms = (secs(you), secs(you + voice.len()));
    match_level(&l, os, &mut r, ms);
    (l, r, os, ms)
}

pub fn at(secs: f64) -> usize {
    (secs * RATE as f64).round().max(0.0) as usize
}

/// Whole-buffer rate conversion, delay removed, length kept in proportion.
pub fn convert(x: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || x.is_empty() {
        return x.to_vec();
    }
    let mut r = Resampler::new(from, to, 1);
    let want = (x.len() as f64 * to as f64 / from as f64).round() as usize;
    let skip = r.delay();
    let n = r.chunk_in();
    let mut out = Vec::with_capacity(want + skip + r.chunk_out());
    let mut buf = vec![0.0; r.chunk_out() + 16];
    let mut chunk = vec![0.0; n];
    let mut i = 0;
    while out.len() < want + skip {
        for (k, c) in chunk.iter_mut().enumerate() {
            *c = x.get(i + k).copied().unwrap_or(0.0);
        }
        let k = r.process(&chunk, &mut buf);
        out.extend_from_slice(&buf[..k]);
        i += n;
    }
    out.drain(..skip.min(out.len()));
    out.truncate(want);
    out
}

/// The tapped output at `RATE`, on the mic's timeline (`secs` long).
pub fn place(marks: &[Mark], played: &[f32], mic_at: u64, secs: f64) -> Vec<f32> {
    let Some(rate) = marks.first().map(|m| m.rate) else {
        return vec![0.0; at(secs)];
    };
    let mut line = vec![0.0; (secs * rate as f64).round() as usize];
    let (mut from, mut next) = (0usize, None::<i64>);
    for m in marks {
        let n = m.frames as usize;
        let block = &played[from.min(played.len())..(from + n).min(played.len())];
        from += n;
        if m.rate != rate {
            continue; // the output device changed mid-take
        }
        let mut pos = ((m.at as i128 - mic_at as i128) * rate as i128 / 1_000_000_000) as i64;
        // Host times jitter by a sample or two; keep consecutive blocks back to back.
        if let Some(p) = next.filter(|p| (pos - p).abs() <= (rate / 500) as i64) {
            pos = p;
        }
        next = Some(pos + n as i64);
        for (k, &v) in block.iter().enumerate() {
            if let Some(slot) = usize::try_from(pos + k as i64)
                .ok()
                .and_then(|i| line.get_mut(i))
            {
                *slot = v;
            }
        }
    }
    let mut out = convert(&line, rate, RATE);
    out.resize(at(secs), 0.0);
    out
}

pub fn levels(x: &[f32]) -> Vec<f32> {
    x.chunks(at(FRAME_SECS)).map(vad::level).collect()
}

/// Frames where the original was sounding (it's clean: anything above −60 dB).
fn active(x: &[f32]) -> Vec<bool> {
    levels(x).into_iter().map(|l| l > -60.0).collect()
}

/// First to last flagged frame, in seconds.
fn span(x: &[f32], flags: &[bool]) -> Option<(f64, f64)> {
    let first = flags.iter().position(|&f| f)?;
    let last = flags.iter().rposition(|&f| f)?;
    let secs = x.len() as f64 / RATE as f64;
    Some((
        first as f64 * FRAME_SECS,
        ((last + 1) as f64 * FRAME_SECS).min(secs),
    ))
}

fn rms(x: &[f32], (a, b): (f64, f64)) -> f32 {
    let s = &x[at(a).min(x.len())..at(b).min(x.len())];
    (s.iter().map(|v| v * v).sum::<f32>() / s.len().max(1) as f32).sqrt()
}

/// Brings your voice up to about the original's loudness (never down), without clipping.
pub fn match_level(original: &[f32], os: (f64, f64), mine: &mut [f32], ms: (f64, f64)) {
    let (o, m) = (rms(original, os), rms(mine, ms));
    if m <= 1e-6 {
        return;
    }
    let peak = mine.iter().fold(0.0f32, |p, v| p.max(v.abs())).max(1e-6);
    let g = (o / m).clamp(1.0, MAX_GAIN).min(0.95 / peak);
    mine.iter_mut().for_each(|v| *v *= g);
}

/// How far your loudness contour trails the original's, if they clearly match.
pub fn lag(original: &[f32], mine: &[f32]) -> Option<i32> {
    let env = |x: &[f32]| -> Vec<f32> {
        let l: Vec<f32> = levels(x).into_iter().map(|l| l.max(-60.0)).collect();
        let mean = l.iter().sum::<f32>() / l.len().max(1) as f32;
        l.into_iter().map(|v| v - mean).collect()
    };
    let (o, m) = (env(original), env(mine));
    let max = (MAX_LAG_SECS / FRAME_SECS) as usize;
    let mut best = (0usize, f32::MIN);
    for lag in 0..=max.min(m.len().saturating_sub(10)) {
        let n = o.len().min(m.len() - lag);
        if n < 50 {
            break;
        }
        let (a, b) = (&o[..n], &m[lag..lag + n]);
        let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
        let norm =
            (a.iter().map(|x| x * x).sum::<f32>() * b.iter().map(|y| y * y).sum::<f32>()).sqrt();
        let c = dot / norm.max(1e-9);
        if c > best.1 {
            best = (lag, c);
        }
    }
    (best.1 > 0.3).then(|| (best.0 as f64 * FRAME_SECS * 1000.0).round() as i32)
}

/// Loudness outline for drawing: one value (0–255) per `1 / per_sec` seconds.
pub fn peaks(x: &[f32], per_sec: u32) -> Vec<u8> {
    x.chunks((RATE / per_sec) as usize)
        .map(|c| (c.iter().fold(0.0f32, |p, v| p.max(v.abs())).min(1.0) * 255.0).round() as u8)
        .collect()
}

#[cfg(test)]
#[path = "take_tests.rs"]
mod tests;
