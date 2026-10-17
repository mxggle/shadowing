//! 边听边说: which of what echo removal leaves is you. You and the original
//! overlap, and what's left of the original (laptop speakers, a loud volume)
//! can stand above the room like a voice. It can only be where the original
//! sounds, or is still dying away in the room; you, a little behind, go on in
//! its pauses and after it has finished. So a take is yours only if some of
//! your voice is where the original can't account for it.

use super::vad;

/// The original is silent below this (as `take::active`).
const SILENT_DB: f32 = -60.0;
/// How fast what the original leaves in the room dies away (a cut mid-word on
/// laptop speakers rang on for about 0.3 s).
const RING_DB_PER_FRAME: f32 = 1.5;
/// Voice the original can't account for that makes a take yours: 0.1 s, so
/// that half a second behind is enough even in a sentence with no pause (closer
/// than that and stopping with it, you're taken for its leftovers).
const OWN_FRAMES: usize = 10;
/// Recording after the original (and its ring) needed to tell at all: stopped
/// by hand before that, any voice counts, as for 听完再说.
const JUDGED_FRAMES: usize = 30;

/// Your frames (10 ms levels `mine` of the cleaned take, voiced against `thr`),
/// or None when the voice in them is all where the original's leftovers could
/// be. `original`: the levels of what was played, on the same timeline.
pub fn yours(mine: &[f32], original: &[f32], thr: f32) -> Option<Vec<bool>> {
    let voiced = vad::voiced_over(mine, thr);
    let mut ring = f32::MIN;
    let sounding: Vec<bool> = (0..mine.len())
        .map(|i| {
            ring = original
                .get(i)
                .copied()
                .unwrap_or(-100.0)
                .max(ring - RING_DB_PER_FRAME);
            ring > SILENT_DB
        })
        .collect();
    let after = sounding.iter().rposition(|&s| s).map_or(0, |i| i + 1);
    let judged = mine.len().saturating_sub(after) >= JUDGED_FRAMES;
    let own = voiced
        .iter()
        .zip(&sounding)
        .filter(|(v, s)| **v && !**s)
        .count();
    let any = voiced.iter().any(|&v| v);
    (any && (own >= OWN_FRAMES || !judged)).then_some(voiced)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOM: f32 = -60.0;
    /// 6 dB above the room, as `vad::along_threshold`.
    const THR: f32 = -54.0;

    /// A sentence as played: phrases at −18 dB (syllables, with dips between
    /// them) and pauses of digital silence; `phrases` in frames.
    fn original(len: usize, phrases: &[(usize, usize)]) -> Vec<f32> {
        (0..len)
            .map(
                |i| match phrases.iter().any(|&(a, b)| (a..b).contains(&i)) {
                    true if i % 12 < 3 => -30.0,
                    true => -18.0,
                    false => -100.0,
                },
            )
            .collect()
    }

    /// The cleaned take: the room (±1 dB), plus `over` (level, frame) where louder.
    fn take(len: usize, over: impl Fn(usize) -> Option<f32>) -> Vec<f32> {
        (0..len)
            .map(|i| {
                let room = ROOM + (i % 3) as f32 - 1.0;
                over(i).map_or(room, |l| l.max(room))
            })
            .collect()
    }

    /// What echo removal leaves of the original: 8 dB above the room where it
    /// sounds, 30 ms late, dying away 1 dB a frame after it stops (as on a
    /// MacBook at a loud volume: the left-over stretches stood out like a voice).
    fn leftover(played: &[f32]) -> impl Fn(usize) -> Option<f32> + '_ {
        move |i| {
            (3..=i.min(40))
                .map(|k| (k, played[i - k]))
                .find(|&(_, l)| l > SILENT_DB)
                .map(|(k, _)| ROOM + 8.0 - (k - 3) as f32)
        }
    }

    /// You under your breath (10 dB above the room), `lag` frames behind each phrase.
    fn you(phrases: &[(usize, usize)], lag: usize) -> impl Fn(usize) -> Option<f32> + '_ {
        move |i| {
            phrases
                .iter()
                .any(|&(a, b)| (a + lag..b + lag).contains(&i))
                .then_some(ROOM + 10.0 + if i % 9 < 2 { -6.0 } else { 0.0 })
        }
    }

    /// Two sounds at once: the louder one.
    fn both(
        a: impl Fn(usize) -> Option<f32>,
        b: impl Fn(usize) -> Option<f32>,
    ) -> impl Fn(usize) -> Option<f32> {
        move |i| match (a(i), b(i)) {
            (Some(x), Some(y)) => Some(x.max(y)),
            (x, y) => x.or(y),
        }
    }

    /// 3.5 s in two phrases with a short pause; the take runs 1 s past it.
    const PHRASES: [(usize, usize); 2] = [(10, 180), (210, 360)];
    const LEN: usize = 460;

    #[test]
    fn only_the_originals_leftovers_is_nothing() {
        let played = original(LEN, &PHRASES);
        let mine = take(LEN, leftover(&played));
        assert!(
            vad::voiced_over(&mine, THR).iter().any(|&v| v),
            "the leftovers stand out like a voice"
        );
        assert_eq!(yours(&mine, &played, THR), None);
    }

    #[test]
    fn a_cut_mid_word_rings_on_and_is_still_nothing() {
        // Cut while loud: what's left goes on 0.3 s past the end.
        let played = original(LEN, &[(10, 360)]);
        let cut = |i: usize| (360..390).contains(&i).then_some(ROOM + 12.0);
        let mine = take(LEN, both(leftover(&played), cut));
        assert_eq!(yours(&mine, &played, THR), None);
    }

    #[test]
    fn quiet_and_behind_is_you() {
        let played = original(LEN, &PHRASES);
        for lag in [70, 90] {
            let mine = take(LEN, both(leftover(&played), you(&PHRASES, lag)));
            let v = yours(&mine, &played, THR).unwrap_or_else(|| panic!("{lag} frames behind"));
            let last = v.iter().rposition(|&x| x).unwrap();
            assert!(last + 10 >= 360 + lag, "{lag}: your last words, at {last}");
        }
    }

    #[test]
    fn half_a_second_behind_with_no_pause_is_you() {
        let one = [(10, 360)];
        let played = original(LEN, &one);
        let mine = take(LEN, both(leftover(&played), you(&one, 50)));
        assert!(yours(&mine, &played, THR).is_some());
    }

    #[test]
    fn stopped_by_hand_during_the_original_any_voice_counts() {
        // Nothing after the original to tell by: as before, your voice is yours.
        let played = original(300, &[(10, 300)]);
        let mine = take(300, |i| (100..250).contains(&i).then_some(ROOM + 10.0));
        assert!(yours(&mine, &played, THR).is_some());
    }

    #[test]
    fn nothing_at_all_is_nothing() {
        let played = original(LEN, &PHRASES);
        assert_eq!(yours(&take(LEN, |_| None), &played, THR), None);
    }
}
