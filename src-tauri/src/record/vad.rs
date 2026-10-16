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
/// Speaking along, your voice only needs to stand this far above the room:
/// shadowing is often said under the breath, a little behind the original.
const ALONG_ABOVE_DB: f32 = 6.0;

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
    /// No speech at all for this long after your turn starts (not `along`).
    pub wait_secs: f64,
    /// Longest your turn may last.
    pub max_secs: f64,
    /// You speak along with the original (边听边说): the turn begins once it
    /// has finished, with you still on your last words (you're a little
    /// behind). It ends when you stop, or at `max_secs` all the same; a quieter
    /// voice counts as still speaking, and there's no waiting for you to start.
    pub along: bool,
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

/// The speech threshold for speaking along (`Rules::along`), from the room's
/// noise floor (`floor`).
pub fn along_threshold(room: f32) -> f32 {
    (room + ALONG_ABOVE_DB).max(QUIETEST_DB)
}

/// Whether the take should stop, given every frame level so far, the frame your
/// turn began at and the speech threshold (`threshold` of the levels, kept up to date by the caller).
pub fn verdict(levels: &[f32], turn: usize, rules: &Rules, thr: f32) -> Option<Stop> {
    let since = levels.len().saturating_sub(turn);
    let secs = |frames: usize| frames as f64 * FRAME_SECS;
    if rules.along {
        // The echo has stopped: what's left above the room is you, in a
        // stretch that mostly is (the room itself flickers up that far).
        let thr = along_threshold(thr - ABOVE_FLOOR_DB);
        let you = voiced_over(&levels[turn.min(levels.len()).saturating_sub(5)..], thr);
        let quiet = you.iter().rev().take_while(|&&v| !v).count().min(since);
        let done = secs(quiet) >= rules.pause_secs || secs(since) >= rules.max_secs;
        return done.then_some(Stop::Pause);
    }
    if secs(since) >= rules.max_secs {
        return Some(Stop::Long);
    }
    let start = (turn + ECHO_TAIL_FRAMES).min(levels.len());
    let turn_levels = &levels[start..];
    let voiced = turn_levels.iter().filter(|&&l| l > thr).count();
    if voiced < SPEECH_FRAMES {
        return (secs(since) >= rules.wait_secs).then_some(Stop::Nothing);
    }
    let quiet = turn_levels.iter().rev().take_while(|&&l| l <= thr).count();
    (secs(quiet) >= rules.pause_secs).then_some(Stop::Pause)
}

/// Frames that are speech (`levels` from `level`), for trimming a finished take:
/// above the threshold, and in a stretch that mostly is (a lone 10 ms blip of
/// leftover echo or a click isn't speech).
pub fn voiced(levels: &[f32]) -> Vec<bool> {
    voiced_over(levels, threshold(levels))
}

/// `voiced`, against a given threshold.
pub fn voiced_over(levels: &[f32], thr: f32) -> Vec<bool> {
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
        along: false,
    };
    const ALONG: Rules = Rules {
        pause_secs: 0.6,
        wait_secs: 3.0,
        max_secs: 2.5,
        along: true,
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
            verdict(&levels[..200], 0, &LISTEN, threshold(&levels[..200])),
            None,
            "0.5 s of quiet is a breath"
        );
        assert_eq!(
            verdict(&levels[..235], 0, &LISTEN, threshold(&levels[..235])),
            Some(Stop::Pause)
        );
    }

    #[test]
    fn a_click_is_not_speech() {
        let levels = take(300, 50..55);
        assert_eq!(verdict(&levels, 0, &LISTEN, threshold(&levels)), None);
        let blip = take(500, 50..55);
        assert_eq!(
            verdict(&blip, 0, &LISTEN, threshold(&blip)),
            Some(Stop::Nothing)
        );
    }

    #[test]
    fn the_originals_echo_right_after_the_turn_is_ignored() {
        // Loud for the first 100 ms of the turn (the room), then nothing.
        let levels = take(200, 100..110);
        assert_eq!(
            verdict(&levels, 100, &LISTEN, threshold(&levels)),
            None,
            "not taken for speech"
        );
    }

    #[test]
    fn along_it_stops_once_you_stop() {
        // The original ends at frame 200; you finish 0.3 s later.
        let levels = take(400, 0..230);
        let at = |n: usize| verdict(&levels[..n], 200, &ALONG, threshold(&levels[..n]));
        assert_eq!(at(250), None);
        assert_eq!(at(285), None, "0.55 s after you stopped");
        assert_eq!(at(290), Some(Stop::Pause));
    }

    #[test]
    fn along_a_quiet_voice_still_counts() {
        // A fan at −60, you under your breath at −50 (as measured in a real
        // take): not speech by the usual threshold, but you're still finishing.
        let levels: Vec<f32> = (0..400)
            .map(|i| match i {
                150..300 => -50.0 + (i % 4) as f32,
                _ => -60.0 + (i % 3) as f32,
            })
            .collect();
        assert!(
            levels[250] <= threshold(&levels[..260]),
            "too quiet for 听完再说"
        );
        let at = |n: usize| verdict(&levels[..n], 200, &ALONG, threshold(&levels[..n]));
        assert_eq!(at(280), None, "still going 0.8 s after the original");
        assert_eq!(at(360), Some(Stop::Pause), "0.6 s after you stopped");
    }

    #[test]
    fn along_the_room_flickering_up_is_not_you() {
        // Every 9th frame of the room 8 dB up (10 ms frames of a real room
        // reach 5–6 dB above its quietest): alone, they aren't speech.
        let levels: Vec<f32> = (0..400)
            .map(|i| match i {
                0..150 => -30.0,
                _ if i % 9 == 0 => -52.0,
                _ => -60.0 + (i % 3) as f32,
            })
            .collect();
        let at = |n: usize| verdict(&levels[..n], 200, &ALONG, threshold(&levels[..n]));
        assert_eq!(at(255), None);
        assert_eq!(at(260), Some(Stop::Pause), "not waiting for the cap");
    }

    #[test]
    fn along_already_quiet_it_stops_soon_after_the_original() {
        let levels = take(400, 0..150);
        let at = |n: usize| verdict(&levels[..n], 200, &ALONG, threshold(&levels[..n]));
        assert_eq!(at(255), None);
        assert_eq!(at(260), Some(Stop::Pause), "no waiting for you to start");
    }

    #[test]
    fn along_it_stops_a_little_after_the_original_whatever_happens() {
        let levels = take(600, 100..600);
        let at = |n: usize| verdict(&levels[..n], 200, &ALONG, threshold(&levels[..n]));
        assert_eq!(at(440), None);
        assert_eq!(
            at(450),
            Some(Stop::Pause),
            "an end like any other: 连续录 goes on to the next time"
        );
    }

    #[test]
    fn long_turns_stop() {
        let rules = Rules {
            max_secs: 2.0,
            ..LISTEN
        };
        let levels = take(400, 0..400);
        assert_eq!(
            verdict(&levels, 150, &rules, threshold(&levels)),
            Some(Stop::Long)
        );
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
