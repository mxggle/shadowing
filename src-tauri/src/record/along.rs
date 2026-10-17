//! 边听边说: which of what echo removal leaves is you. You and the original
//! overlap, and what's left of the original (laptop speakers, a loud volume)
//! can stand above the room like a voice. It can only be where the original
//! sounds, or is still dying away in the room; you, a little behind, go on in
//! its pauses and after it has finished. So a take is yours only if some of
//! your voice is where the original can't account for it.

use super::vad;

/// The original is silent below this (as `take::active`).
const SILENT_DB: f32 = -60.0;
/// What the original leaves goes on a little after it: its echo, the room, the
/// laptop speakers' own processing (on a MacBook, up to 0.3 s past its end).
const HOLD_FRAMES: usize = 35;
/// …longer after a loud stop (a cut mid-word): it dies away at this rate.
const RING_DB_PER_FRAME: f32 = 1.5;
/// Under the original, a voice this far above the room is you all the same:
/// what echo removal left stayed within about 14 dB of it (MacBook, 56 %).
const LOUD_ABOVE_DB: f32 = 18.0;
/// Voice of yours that makes a take yours: 0.1 s, so that 0.6 s behind is
/// enough even in a sentence with no pause (closer than that, quiet, and
/// stopping with it, you're taken for its leftovers).
const OWN_FRAMES: usize = 10;
/// A take that stops by itself ends with the quiet that stopped it: whatever
/// is in its last moments (a click, a creak) isn't you.
const END_FRAMES: usize = 30;
/// Recording past the original's leftovers needed to tell at all. Stopped by
/// hand before that, any voice counts, as for 听完再说.
const JUDGED_FRAMES: usize = 20;

/// Your frames (10 ms levels `mine` of the cleaned take, voiced against the
/// room's `along_threshold`), or None when the voice in them is all where the
/// original's leftovers could be. `original`: the levels of what was played,
/// on the same timeline.
pub fn yours(mine: &[f32], original: &[f32], room: f32) -> Option<Vec<bool>> {
    let voiced = vad::voiced_over(mine, vad::along_threshold(room));
    let loud = vad::voiced_over(mine, room + LOUD_ABOVE_DB);
    let (mut ring, mut quiet) = (f32::MIN, usize::MAX);
    let sounding: Vec<bool> = (0..mine.len())
        .map(|i| {
            let level = original.get(i).copied().unwrap_or(-100.0);
            ring = level.max(ring - RING_DB_PER_FRAME);
            quiet = if level > SILENT_DB {
                0
            } else {
                quiet.saturating_add(1)
            };
            ring > SILENT_DB || quiet <= HOLD_FRAMES
        })
        .collect();
    let after = sounding.iter().rposition(|&s| s).map_or(0, |i| i + 1);
    if mine.len() < after + JUDGED_FRAMES {
        return voiced.iter().any(|&v| v).then_some(voiced);
    }
    let end = mine.len() - END_FRAMES.min(mine.len() - after);
    let own = (0..end)
        .filter(|&i| voiced[i] && (!sounding[i] || loud[i]))
        .count();
    (own >= OWN_FRAMES).then_some(voiced)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOM: f32 = -60.0;

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

    /// What echo removal leaves of the original, as on a MacBook: 12 dB above
    /// the room where it sounds, and on for 0.3 s after it stops.
    fn leftover(played: &[f32]) -> impl Fn(usize) -> Option<f32> + '_ {
        move |i| {
            (0..=i.min(30))
                .any(|k| played[i - k] > SILENT_DB)
                .then_some(ROOM + 12.0)
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
        let thr = vad::along_threshold(ROOM);
        assert!(
            vad::voiced_over(&mine, thr).iter().any(|&v| v),
            "the leftovers stand out like a voice"
        );
        assert_eq!(yours(&mine, &played, ROOM), None);
    }

    #[test]
    fn a_cut_mid_word_rings_on_and_is_still_nothing() {
        // Cut while loud: louder than the rest of it, and on 0.35 s past the end.
        let played = original(LEN, &[(10, 360)]);
        let cut = |i: usize| (360..395).contains(&i).then_some(ROOM + 16.0);
        let mine = take(LEN, both(leftover(&played), cut));
        assert_eq!(yours(&mine, &played, ROOM), None);
    }

    #[test]
    fn quiet_and_behind_is_you() {
        let played = original(LEN, &PHRASES);
        for lag in [70, 90] {
            let mine = take(LEN, both(leftover(&played), you(&PHRASES, lag)));
            let v = yours(&mine, &played, ROOM).unwrap_or_else(|| panic!("{lag} frames behind"));
            let last = v.iter().rposition(|&x| x).unwrap();
            assert!(last + 10 >= 360 + lag, "{lag}: your last words, at {last}");
        }
    }

    #[test]
    fn just_over_half_a_second_behind_with_no_pause_is_you() {
        let one = [(10, 360)];
        let played = original(LEN, &one);
        let mine = take(LEN, both(leftover(&played), you(&one, 60)));
        assert!(yours(&mine, &played, ROOM).is_some());
    }

    #[test]
    fn a_word_out_loud_under_the_original_is_you() {
        // Only the first word, well above anything echo removal leaves.
        let played = original(LEN, &PHRASES);
        let word = |i: usize| (120..160).contains(&i).then_some(ROOM + 24.0);
        let mine = take(LEN, both(leftover(&played), word));
        assert!(yours(&mine, &played, ROOM).is_some());
    }

    #[test]
    fn a_sound_as_it_stops_by_itself_is_not_you() {
        // The quiet that stopped it, with a creak in it.
        let played = original(LEN, &PHRASES);
        let creak = |i: usize| (440..455).contains(&i).then_some(ROOM + 10.0);
        let mine = take(LEN, both(leftover(&played), creak));
        assert_eq!(yours(&mine, &played, ROOM), None);
    }

    #[test]
    fn stopped_by_hand_during_the_original_any_voice_counts() {
        // Nothing after the original to tell by: as before, your voice is yours.
        let played = original(300, &[(10, 300)]);
        let mine = take(300, |i| (100..250).contains(&i).then_some(ROOM + 10.0));
        assert!(yours(&mine, &played, ROOM).is_some());
    }

    #[test]
    fn nothing_at_all_is_nothing() {
        let played = original(LEN, &PHRASES);
        assert_eq!(yours(&take(LEN, |_| None), &played, ROOM), None);
    }
}
