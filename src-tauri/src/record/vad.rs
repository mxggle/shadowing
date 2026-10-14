//! When you've finished speaking: loudness in 10 ms frames against the room's
//! own noise, so the take can stop by itself (like a voice assistant does)
//! instead of making you reach for a key with your mouth still open.

/// One frame = 10 ms.
pub const FRAME_SECS: f64 = 0.01;
/// Speech must stand this far above the room noise.
const ABOVE_FLOOR_DB: f32 = 15.0;
/// …and never counts below this level, however quiet the room.
const QUIETEST_DB: f32 = -55.0;
/// Speech needs about this much voiced time before a pause can end the take (no clicks or breaths).
const SPEECH_FRAMES: usize = 15;
/// Right after the original stops, its echo is still dying away in the room.
const ECHO_TAIL_FRAMES: usize = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stop {
    /// You stopped speaking.
    Pause,
    /// Nothing was said for a while.
    Nothing,
    /// Too long: whatever is going on, stop.
    Long,
}

#[derive(Debug, Clone, Copy)]
pub struct Rules {
    /// Quiet after speech that ends the take.
    pub pause_secs: f64,
    /// No speech at all for this long after your turn starts.
    pub wait_secs: f64,
    /// Longest your turn may last.
    pub max_secs: f64,
    /// You were already speaking when the turn began (shadowing).
    pub speaking: bool,
}

/// Level in dBFS of one frame.
pub fn level(frame: &[f32]) -> f32 {
    let p = frame.iter().map(|v| v * v).sum::<f32>() / frame.len().max(1) as f32;
    10.0 * p.max(1e-10).log10()
}

/// Background noise: a low percentile of the levels so far, leaving out digital
/// silence (a take blanks the mic before your turn; that isn't the room).
pub fn floor(levels: &[f32]) -> f32 {
    let mut v: Vec<f32> = levels.iter().copied().filter(|&l| l > -95.0).collect();
    if v.is_empty() {
        return -90.0;
    }
    v.sort_by(f32::total_cmp);
    v[v.len() / 10]
}

pub fn threshold(levels: &[f32]) -> f32 {
    (floor(levels) + ABOVE_FLOOR_DB).max(QUIETEST_DB)
}

/// Whether the take should stop, given every frame level so far and the frame your turn began at.
pub fn verdict(levels: &[f32], turn: usize, rules: &Rules) -> Option<Stop> {
    let since = levels.len().saturating_sub(turn);
    let secs = |frames: usize| frames as f64 * FRAME_SECS;
    if secs(since) >= rules.max_secs {
        return Some(Stop::Long);
    }
    let thr = threshold(levels);
    let start = (turn + if rules.speaking { 0 } else { ECHO_TAIL_FRAMES }).min(levels.len());
    let turn_levels = &levels[start..];
    let voiced = turn_levels.iter().filter(|&&l| l > thr).count();
    let heard = rules.speaking || voiced >= SPEECH_FRAMES;
    if !heard {
        return (secs(since) >= rules.wait_secs).then_some(Stop::Nothing);
    }
    let quiet = turn_levels.iter().rev().take_while(|&&l| l <= thr).count();
    (secs(quiet) >= rules.pause_secs).then_some(Stop::Pause)
}

/// Frames that are speech (`levels` from `level`), for trimming a finished take:
/// above the threshold, and in a stretch that mostly is (a lone 10 ms blip of
/// leftover echo or a click isn't speech).
pub fn voiced(levels: &[f32]) -> Vec<bool> {
    let thr = threshold(levels);
    let loud: Vec<bool> = levels.iter().map(|&l| l > thr).collect();
    let near = |i: usize| {
        loud[i.saturating_sub(5)..(i + 6).min(loud.len())]
            .iter()
            .filter(|&&v| v)
            .count()
    };
    (0..loud.len()).map(|i| loud[i] && near(i) >= 6).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTEN: Rules = Rules {
        pause_secs: 0.8,
        wait_secs: 5.0,
        max_secs: 20.0,
        speaking: false,
    };

    /// Room noise at −70 dB with speech (−25 dB) in the given frame ranges.
    fn take(total: usize, speech: std::ops::Range<usize>) -> Vec<f32> {
        (0..total)
            .map(|i| {
                if speech.contains(&i) {
                    -25.0
                } else {
                    -70.0 + (i % 3) as f32
                }
            })
            .collect()
    }

    #[test]
    fn stops_after_a_pause_in_speech() {
        let levels = take(300, 50..150);
        assert_eq!(
            verdict(&levels[..200], 0, &LISTEN),
            None,
            "0.5 s of quiet is a breath"
        );
        assert_eq!(verdict(&levels[..235], 0, &LISTEN), Some(Stop::Pause));
    }

    #[test]
    fn a_click_is_not_speech() {
        let levels = take(300, 50..55);
        assert_eq!(verdict(&levels, 0, &LISTEN), None);
        assert_eq!(verdict(&take(500, 50..55), 0, &LISTEN), Some(Stop::Nothing));
    }

    #[test]
    fn the_originals_echo_right_after_the_turn_is_ignored() {
        // Loud for the first 100 ms of the turn (the room), then nothing.
        let levels = take(200, 100..110);
        assert_eq!(verdict(&levels, 100, &LISTEN), None, "not taken for speech");
    }

    #[test]
    fn shadowing_stops_once_you_stop() {
        let rules = Rules {
            speaking: true,
            pause_secs: 0.7,
            ..LISTEN
        };
        let levels = take(400, 0..230);
        assert_eq!(verdict(&levels[..250], 200, &rules), None);
        assert_eq!(verdict(&levels[..300], 200, &rules), Some(Stop::Pause));
    }

    #[test]
    fn long_turns_stop() {
        let rules = Rules {
            max_secs: 2.0,
            ..LISTEN
        };
        let levels = take(400, 0..400);
        assert_eq!(verdict(&levels, 150, &rules), Some(Stop::Long));
    }

    #[test]
    fn blips_are_not_speech() {
        let mut levels = take(300, 100..200);
        levels[20] = -25.0;
        levels[21] = -25.0;
        let v = voiced(&levels);
        assert!(!v[20] && !v[21]);
        assert!(v[103] && v[150] && v[197]);
    }

    #[test]
    fn blanked_frames_dont_lower_the_floor() {
        let mut levels = vec![-100.0; 300];
        levels.extend(take(200, 50..120).iter().map(|l| l + 20.0)); // a noisy room at −50
        let voiced = voiced(&levels);
        assert!(!voiced[300 + 10] && voiced[300 + 60] && !voiced[300 + 150]);
    }

    #[test]
    fn level_of_full_scale_sine_is_minus_3_db() {
        let s: Vec<f32> = (0..480).map(|i| (i as f32 * 0.1).sin()).collect();
        assert!((level(&s) + 3.0).abs() < 0.2);
    }
}
