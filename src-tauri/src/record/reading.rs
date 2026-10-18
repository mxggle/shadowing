//! A paragraph in one go: the whole recording becomes a reading (kept whole,
//! to hear yourself straight through) and a take per sentence (to compare
//! sentence by sentence, the same as one recorded on its own).
//!
//! 跟着原文读: the original was played; its sentences sit on the recording
//! where the output tap put them, and you trail them by your lag.
//! 自己读: nothing was played; your sentences are found from your pauses
//! (`segment.rs`), and the original's audio for each is read from the file.

use super::saved::{Peaks, ReadPart, Reading, Sound, Source, Take, PEAKS_PER_SEC};
use super::take::{
    self, at, convert, Mode, Piece, Raw, LEAD_SECS, MARGIN_SECS, NOTHING, NOTHING_EN, RATE,
    TAIL_SECS,
};
use super::vad::{self, FRAME_SECS};
use super::{echo, original, segment, Meta};
use crate::i18n::pick;
use std::path::Path;

/// A sentence said for less than this isn't kept as a take.
const SAID_SECS: f64 = 0.25;
/// When no lag can be measured, assume a typical one.
const LAG_GUESS_MS: i32 = 400;

pub struct Built {
    pub reading: Reading,
    /// Left the original as heard (empty for 自己读), right you.
    pub whole: Sound,
    /// Each sentence's take, with its own audio unless it's a window onto the whole (`Take::source`).
    pub takes: Vec<(Take, Option<Sound>)>,
}

/// Samples per level frame.
fn frame() -> usize {
    at(FRAME_SECS)
}

pub fn build(raw: &Raw, meta: &Meta, file: &Path, id: &str, created: u64) -> Result<Built, String> {
    let mic = convert(&raw.mic, raw.mic_rate, RATE);
    let secs = raw.mic.len() as f64 / raw.mic_rate.max(1) as f64;
    let sentences = &meta.sentences;
    let rate = meta.rate.clamp(0.5, 2.0);
    // Reading on your own: only the sentences you got to (stopped early, the rest have no take).
    let read = match (&meta.mode, &raw.followed) {
        (Mode::Read, Some(f)) => f.reached.min(sentences.len()),
        _ => sentences.len(),
    };
    if read == 0 {
        return Err(pick(NOTHING, NOTHING_EN).into());
    }
    let (played, mine, spans, heard, lag_ms) = match meta.mode {
        Mode::Read => {
            let voiced = vad::voiced(&take::levels(&mic));
            let expected: Vec<f64> = sentences[..read].iter().map(|s| s.end - s.start).collect();
            let hints = raw.followed.as_ref().map_or(&[][..], |f| &f.hints[..]);
            let mut spans =
                segment::reading(&voiced, &expected, hints).ok_or(pick(NOTHING, NOTHING_EN))?;
            spans.resize(sentences.len(), (0, 0));
            (None, mic, spans, None, None)
        }
        _ => {
            let played = take::place(&raw.marks, &raw.played, raw.mic_at, secs);
            let mine = echo::cancel_long(&mic, &played, RATE);
            // Where the range began on the recording: its first sound, less the
            // original's own digital silence before it (which plays as nothing).
            let first_sound = played
                .iter()
                .position(|v| v.abs() > 1e-6)
                .ok_or(pick("原文没有放出来", "The original didn’t play"))?;
            let quiet = original::silence_from(file, meta.start, 5.0).unwrap_or(0.0);
            let p0 = first_sound.saturating_sub(at(quiet / rate));
            let to_frame = |t: f64| (p0 + at((t - meta.start).max(0.0) / rate)) / frame();
            let heard: Vec<(usize, usize)> = sentences
                .iter()
                .map(|s| (to_frame(s.start), to_frame(s.end)))
                .collect();
            let lag_ms = take::lag(&played, &mine);
            let lag = (lag_ms.unwrap_or(LAG_GUESS_MS) as f64 / 1000.0 / FRAME_SECS) as usize;
            let voiced = vad::voiced(&take::levels(&mine));
            let spans = segment::shadowing(&voiced, &heard, lag);
            (Some(played), mine, spans, Some(heard), lag_ms)
        }
    };
    if spans.iter().all(|s| s.1 <= s.0) {
        return Err(pick(NOTHING, NOTHING_EN).into());
    }
    let originals = match &played {
        Some(_) => None,
        None => Some(original::stretches(
            file,
            &sentences[..read]
                .iter()
                .map(|s| (s.start, s.end))
                .collect::<Vec<_>>(),
        )?),
    };

    let f = frame();
    let secs_of = |samples: usize| samples as f64 / RATE as f64;

    // The whole reading, from the first voice (yours or the original's) to the last.
    let first = spans
        .iter()
        .filter(|s| s.1 > s.0)
        .map(|s| s.0)
        .min()
        .unwrap_or(0);
    let last = spans.iter().map(|s| s.1).max().unwrap_or(0);
    let (h0, h1) = heard.as_ref().map_or((first, last), |h| {
        (h[0].0.min(first), h[h.len() - 1].1.max(last))
    });
    let a = (h0 * f).saturating_sub(at(LEAD_SECS + MARGIN_SECS));
    let b = (h1 * f + at(TAIL_SECS + MARGIN_SECS)).min(mine.len());
    let mut whole_r = mine[a..b].to_vec();
    // 自己读 played nothing: the file keeps only you.
    let whole_l = played
        .as_ref()
        .map_or_else(Vec::new, |p| p[a.min(p.len())..b.min(p.len())].to_vec());
    let reference: Vec<f32> = match &originals {
        Some(o) => o.concat(),
        None => whole_l.clone(),
    };
    let voice = (
        secs_of(first * f - a.min(first * f)),
        secs_of((last * f).min(b) - a),
    );
    take::match_level(
        &reference,
        (0.0, secs_of(reference.len())),
        &mut whole_r,
        voice,
    );

    let said = |s: (usize, usize)| (s.1.saturating_sub(s.0)) as f64 * FRAME_SECS >= SAID_SECS;
    let mut takes = Vec::new();
    let mut parts = Vec::new();
    for (i, s) in sentences.iter().enumerate() {
        let span = spans[i];
        if !said(span) {
            parts.push(ReadPart {
                start: s.start,
                end: s.end,
                mine: (0.0, 0.0),
                take: None,
            });
            continue;
        }
        let take_id = format!("{id}-{i}");
        // 跟着原文读: a window onto the whole file (no copy). 自己读: its own file, the original from the track first.
        let (source, duration, original_span, mine_span, peaks, sound) = match (&heard, &originals)
        {
            (Some(heard), _) => {
                let (wa, wb, os, ms) = along(heard[i], span, (a, b));
                let lane = |x: &[f32]| {
                    take::peaks(
                        &x[(wa - a).min(x.len())..(wb - a).min(x.len())],
                        PEAKS_PER_SEC,
                    )
                };
                let source = Source {
                    reading: id.to_string(),
                    from: secs_of(wa - a),
                };
                let peaks = Peaks {
                    original: lane(&whole_l),
                    mine: lane(&whole_r),
                };
                (Some(source), secs_of(wb - wa), os, ms, peaks, None)
            }
            (_, Some(originals)) => {
                let (l, r, os, ms) = after(&originals[i], &mine, span);
                let peaks = Peaks {
                    original: take::peaks(&l, PEAKS_PER_SEC),
                    mine: take::peaks(&r, PEAKS_PER_SEC),
                };
                (
                    None,
                    secs_of(l.len().max(r.len())),
                    os,
                    ms,
                    peaks,
                    Some((l, r)),
                )
            }
            _ => unreachable!("a reading either played the original or read it from the file"),
        };
        let take = Take {
            id: take_id.clone(),
            created,
            start: s.start,
            end: s.end,
            text: s.text.clone(),
            mode: meta.mode,
            rate: if played.is_some() { meta.rate } else { 1.0 },
            duration,
            original: original_span,
            mine: mine_span,
            lag_ms,
            peaks,
            group: Some(id.to_string()),
            source,
            bluetooth: meta.bluetooth,
        };
        takes.push((take, sound));
        parts.push(ReadPart {
            start: s.start,
            end: s.end,
            mine: (
                secs_of(span.0 * f) - secs_of(a),
                secs_of(span.1 * f) - secs_of(a),
            ),
            take: Some(take_id),
        });
    }

    let original_secs = match &originals {
        // From the first sentence's start to the last's end, pauses included, as yours is.
        Some(_) => sentences[read - 1].end - sentences[0].start,
        None => sentences.iter().map(|s| (s.end - s.start) / rate).sum(),
    };
    let reading = Reading {
        id: id.to_string(),
        created,
        start: meta.start,
        end: meta.end,
        mode: meta.mode,
        rate: if played.is_some() { meta.rate } else { 1.0 },
        duration: secs_of(b - a),
        parts,
        original_secs,
        mine_secs: (last - first) as f64 * FRAME_SECS,
        lag_ms,
        peaks: take::peaks(&whole_r, PEAKS_PER_SEC),
        bluetooth: meta.bluetooth,
    };
    Ok(Built {
        reading,
        whole: (whole_l, whole_r),
        takes,
    })
}

/// A sentence shadowed along the original: its window in the session's
/// samples (within the whole file's `whole`), and where the original and you
/// are in that window (seconds).
fn along(
    heard: (usize, usize),
    span: (usize, usize),
    whole: (usize, usize),
) -> (usize, usize, (f64, f64), (f64, f64)) {
    let f = frame();
    let a = (heard.0.min(span.0) * f)
        .saturating_sub(at(LEAD_SECS + MARGIN_SECS))
        .max(whole.0);
    let b = (heard.1.max(span.1) * f + at(TAIL_SECS + MARGIN_SECS)).min(whole.1);
    let rel = |frames: usize| (frames * f).saturating_sub(a) as f64 / RATE as f64;
    let os = (rel(heard.0), rel(heard.1).min((b - a) as f64 / RATE as f64));
    let ms = (
        (rel(span.0) - LEAD_SECS).max(0.0),
        (rel(span.1) + TAIL_SECS).min((b - a) as f64 / RATE as f64),
    );
    (a, b.max(a), os, ms)
}

/// A sentence read on your own: laid out like 听完再说, the original first, then you.
fn after(original: &[f32], mine: &[f32], span: (usize, usize)) -> Piece {
    let f = frame();
    let from = (span.0 * f).saturating_sub(at(LEAD_SECS));
    let to = (span.1 * f + at(TAIL_SECS)).min(mine.len());
    take::turns(original, &mine[from..to])
}

#[cfg(test)]
#[path = "reading_tests.rs"]
mod tests;
