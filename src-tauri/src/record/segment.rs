//! Splitting a paragraph's recording into its sentences.
//!
//! 自己读: where you paused. Every pause is a candidate boundary; the ones
//! chosen (by dynamic programming) are the set whose positions best match
//! where the sentence ends fall in the original, scaled to your whole reading
//! (people read at their own speed, but in proportion), preferring longer
//! pauses and the boundaries the live highlight already showed.
//!
//! 跟着原文读: where the original's sentences were, shifted by your lag, each
//! boundary moved to the nearest pause.

use super::vad::FRAME_SECS;

/// Shortest silence counted as a pause.
const PAUSE_FRAMES: usize = 8;
/// How much a boundary may sit off the original's proportions (squared, in shares of the reading)…
const PLACE: f64 = 120.0;
/// …against how much a longer pause is preferred, and the live highlight's guess.
const LONG: f64 = 1.0;
const HINT: f64 = 60.0;
/// 跟着原文读: how far a boundary may move to land in a pause.
const SNAP_SECS: f64 = 0.35;
/// …and how much longer than the original you may go on with the last sentence.
const OVERRUN_SECS: f64 = 3.0;

/// Where each sentence is in the recording: (first, last + 1) voiced frame.
pub type Spans = Vec<(usize, usize)>;

struct Pause {
    /// Middle frame and length in frames.
    at: usize,
    len: usize,
}

fn pauses(voiced: &[bool], from: usize, to: usize) -> Vec<Pause> {
    let mut out = Vec::new();
    let mut i = from;
    while i < to {
        if voiced[i] {
            i += 1;
            continue;
        }
        let start = i;
        while i < to && !voiced[i] {
            i += 1;
        }
        if i - start >= PAUSE_FRAMES {
            out.push(Pause {
                at: (start + i) / 2,
                len: i - start,
            });
        }
    }
    out
}

/// The voiced stretch between two boundaries.
fn trim(voiced: &[bool], a: usize, b: usize) -> (usize, usize) {
    let first = (a..b).find(|&i| voiced[i]).unwrap_or(a);
    let last = (a..b).rev().find(|&i| voiced[i]).map_or(first, |i| i + 1);
    (first, last.max(first))
}

fn spans(voiced: &[bool], bounds: &[usize], from: usize, to: usize) -> Spans {
    let mut edges = vec![from];
    edges.extend_from_slice(bounds);
    edges.push(to);
    edges
        .windows(2)
        .map(|w| trim(voiced, w[0], w[1].max(w[0])))
        .collect()
}

/// 自己读: `expected` seconds per sentence in the original; `hints`, per
/// boundary, the frame where the live highlight moved across it (if it did).
pub fn reading(voiced: &[bool], expected: &[f64], hints: &[Option<usize>]) -> Option<Spans> {
    let from = voiced.iter().position(|&v| v)?;
    let to = voiced.iter().rposition(|&v| v)? + 1;
    let n = expected.len();
    if n <= 1 {
        return Some(vec![(from, to)]);
    }
    let total: f64 = expected.iter().sum::<f64>().max(1e-6);
    let share: Vec<f64> = expected
        .iter()
        .scan(0.0, |acc, e| {
            *acc += e;
            Some(*acc / total)
        })
        .take(n - 1)
        .collect();
    let cands = pauses(voiced, from, to);
    let span = (to - from) as f64;
    let at = |c: &Pause| (c.at - from) as f64 / span;
    let cost = |k: usize, c: &Pause| {
        let hint = hints
            .get(k)
            .copied()
            .flatten()
            .map_or(0.0, |h| HINT * ((c.at as f64 - h as f64) / span).powi(2));
        PLACE * (at(c) - share[k]).powi(2) - LONG * (c.len as f64 / PAUSE_FRAMES as f64).ln() + hint
    };
    let m = cands.len();
    if m < n - 1 {
        // Not enough pauses: cut in proportion.
        let bounds: Vec<usize> = share.iter().map(|s| from + (s * span) as usize).collect();
        return Some(spans(voiced, &bounds, from, to));
    }
    // best[k][j]: least cost with boundary k at candidate j (boundaries in order).
    let mut best = vec![vec![f64::INFINITY; m]; n - 1];
    let mut back = vec![vec![0usize; m]; n - 1];
    for j in 0..m {
        best[0][j] = cost(0, &cands[j]);
    }
    for k in 1..n - 1 {
        let mut run = (f64::INFINITY, 0usize); // best of row k-1 over candidates before j
        for j in 0..m {
            if j > 0 && best[k - 1][j - 1] < run.0 {
                run = (best[k - 1][j - 1], j - 1);
            }
            if run.0.is_finite() {
                best[k][j] = run.0 + cost(k, &cands[j]);
                back[k][j] = run.1;
            }
        }
    }
    let mut j = (0..m)
        .min_by(|&a, &b| best[n - 2][a].total_cmp(&best[n - 2][b]))
        .unwrap_or(0);
    let mut bounds = vec![0; n - 1];
    for k in (0..n - 1).rev() {
        bounds[k] = cands[j].at;
        j = back[k][j];
    }
    Some(spans(voiced, &bounds, from, to))
}

/// 跟着原文读: `heard` is where each sentence of the original was on the
/// recording (frames), `lag` how far behind you were.
pub fn shadowing(voiced: &[bool], heard: &[(usize, usize)], lag: usize) -> Spans {
    let len = voiced.len();
    let snap = (SNAP_SECS / FRAME_SECS) as usize;
    let cands = pauses(voiced, 0, len);
    let bounds: Vec<usize> = heard
        .windows(2)
        .map(|w| {
            let mid = ((w[0].1 + w[1].0) / 2 + lag).min(len);
            cands
                .iter()
                .filter(|c| c.at.abs_diff(mid) <= snap)
                .min_by_key(|c| c.at.abs_diff(mid))
                .map_or(mid, |c| c.at)
        })
        .collect();
    let from = heard
        .first()
        .map_or(0, |h| (h.0 + lag).saturating_sub(snap))
        .min(len);
    let to = heard.last().map_or(len, |h| h.1 + lag + snap * 3).min(len);
    // Still speaking there (fallen behind at the end): on to where your voice stops.
    let to = overrun(voiced, to, (OVERRUN_SECS / FRAME_SECS) as usize);
    let mut bounds = bounds;
    for i in 1..bounds.len() {
        bounds[i] = bounds[i].max(bounds[i - 1]);
    }
    spans(voiced, &bounds, from, to.max(from))
}

/// From `at`, the end of the voice still going on there (pauses shorter than a
/// real one don't stop it), at most `max` frames further.
fn overrun(voiced: &[bool], at: usize, max: usize) -> usize {
    let limit = (at + max).min(voiced.len());
    let (mut end, mut quiet) = (at, 0);
    for (i, &v) in voiced.iter().enumerate().take(limit).skip(at) {
        if v {
            end = i + 1;
            quiet = 0;
        } else {
            quiet += 1;
            if quiet >= PAUSE_FRAMES {
                break;
            }
        }
    }
    end
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Frames from (voiced, seconds) stretches.
    fn take(parts: &[(bool, f64)]) -> Vec<bool> {
        parts
            .iter()
            .flat_map(|&(v, s)| std::iter::repeat_n(v, (s / FRAME_SECS).round() as usize))
            .collect()
    }

    fn secs(s: (usize, usize)) -> (f64, f64) {
        (s.0 as f64 * FRAME_SECS, s.1 as f64 * FRAME_SECS)
    }

    #[test]
    fn reading_is_cut_at_the_right_pauses() {
        // Three sentences read 1.3× slower than the original (2 s, 1 s, 3 s),
        // with breaths inside the first and the last.
        let v = take(&[
            (false, 0.5),
            (true, 1.2),
            (false, 0.25), // breath
            (true, 1.4),
            (false, 0.5), // end of 1
            (true, 1.3),
            (false, 0.6), // end of 2
            (true, 2.0),
            (false, 0.3), // breath
            (true, 1.9),
            (false, 1.0),
        ]);
        let s = reading(&v, &[2.0, 1.0, 3.0], &[]).unwrap();
        let s: Vec<(f64, f64)> = s.into_iter().map(secs).collect();
        assert_eq!(s.len(), 3);
        assert!(
            (s[0].0 - 0.5).abs() < 0.02 && (s[0].1 - 3.35).abs() < 0.02,
            "{s:?}"
        );
        assert!(
            (s[1].0 - 3.85).abs() < 0.02 && (s[1].1 - 5.15).abs() < 0.02,
            "{s:?}"
        );
        assert!(
            (s[2].0 - 5.75).abs() < 0.02 && (s[2].1 - 9.95).abs() < 0.02,
            "{s:?}"
        );
    }

    #[test]
    fn the_live_guess_breaks_a_tie() {
        // Two equal pauses; the original's proportions sit between them.
        let v = take(&[
            (true, 1.0),
            (false, 0.4),
            (true, 1.0),
            (false, 0.4),
            (true, 1.0),
        ]);
        let early = reading(&v, &[1.5, 1.5], &[Some(120)]).unwrap();
        let late = reading(&v, &[1.5, 1.5], &[Some(260)]).unwrap();
        assert_eq!(early[0].1, 100);
        assert_eq!(late[0].1, 240);
    }

    #[test]
    fn a_boundary_without_a_hint_doesnt_shift_the_others() {
        // Four equal pauses for three boundaries; the hints say the first, (none), the last.
        let v = take(&[
            (true, 1.0),
            (false, 0.4),
            (true, 1.0),
            (false, 0.4),
            (true, 1.0),
            (false, 0.4),
            (true, 1.0),
            (false, 0.4),
            (true, 1.0),
        ]);
        let s = reading(&v, &[1.2, 1.2, 1.2, 1.2], &[Some(120), None, Some(540)]).unwrap();
        let ends: Vec<usize> = s.iter().map(|s| s.1).collect();
        assert_eq!(ends[0], 100);
        assert_eq!(ends[2], 520, "the last hint is the third boundary's");
    }

    #[test]
    fn too_few_pauses_cut_in_proportion() {
        let v = take(&[(true, 4.0)]);
        let s = reading(&v, &[1.0, 3.0], &[]).unwrap();
        assert_eq!(s, vec![(0, 100), (100, 400)]);
    }

    #[test]
    fn silence_is_no_reading() {
        assert!(reading(&[false; 100], &[1.0, 1.0], &[]).is_none());
    }

    #[test]
    fn shadowing_follows_the_original_shifted_by_the_lag() {
        // The original: 0.5–2.5 s and 2.9–4.4 s; you 0.4 s behind, pausing at 3.0 s.
        let v = take(&[
            (false, 0.9),
            (true, 2.0),
            (false, 0.3),
            (true, 1.6),
            (false, 0.8),
        ]);
        let s = shadowing(&v, &[(50, 250), (290, 440)], 40);
        let s: Vec<(f64, f64)> = s.into_iter().map(secs).collect();
        assert_eq!(s, vec![(0.9, 2.9), (3.2, 4.8)]);
    }

    #[test]
    fn falling_behind_at_the_end_keeps_your_last_words() {
        // As above, but you go on with the last sentence until 6.6 s (a short breath at 5.0 s).
        let v = take(&[
            (false, 0.9),
            (true, 2.0),
            (false, 0.3),
            (true, 1.8),
            (false, 0.05),
            (true, 1.6),
            (false, 1.0),
        ]);
        let s = shadowing(&v, &[(50, 250), (290, 440)], 40);
        assert_eq!(secs(s[1]), (3.2, 6.65));
    }
}
