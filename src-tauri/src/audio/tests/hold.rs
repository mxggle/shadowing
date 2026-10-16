//! Pausing a recording or a clip (the deck's play key while one is going on):
//! everything waits where it is and goes on from there.

use super::*;
use crate::audio::clip::Clip;
use crate::audio::engine::EV_ENDED;
use std::sync::atomic::Ordering::Relaxed;

fn heard(out: &[f32], n: usize) -> Vec<f64> {
    out.chunks(2)
        .filter(|f| f[1].abs() > 1e-6)
        .map(|f| index_of(f, n))
        .collect()
}

/// A rig playing the range [1 s, 2 s) of a ramp, half a second in.
fn ranged(dir: &std::path::Path) -> (Rig, usize, u64) {
    let (path, n) = ramp_wav(dir, SR, 6.0);
    let (a, b) = (SR as u64, SR as u64 * 2);
    let mut rig = Rig::new(&path, SR, 1.0, 0);
    rig.set_loop(a, b, 3); // a sentence loop is on, as when recording while it loops
    rig.send(Cmd::Seek(a));
    rig.send(Cmd::Range(Some(b)));
    rig.render(SR as usize / 2, 512);
    (rig, n, b)
}

#[test]
fn a_held_range_goes_on_to_its_end() {
    let dir = tempfile::tempdir().unwrap();
    let (mut rig, n, b) = ranged(dir.path());
    rig.send(Cmd::Hold(true));
    let (out, _) = rig.render(SR as usize / 10, 512);
    let before = *heard(&out, n).last().unwrap();
    assert!(!rig.shared.playing() && rig.shared.held());
    let (out, _) = rig.render(SR as usize * 2, 512);
    assert!(heard(&out, n).is_empty(), "silent while held");
    rig.send(Cmd::Hold(false));
    let (out, _) = rig.render(SR as usize, 512);
    let idx = heard(&out, n);
    assert!(
        (idx[0] - before).abs() < 300.0,
        "goes on from where it was: {} after {before}",
        idx[0]
    );
    assert!(
        idx.windows(2).all(|w| w[1] >= w[0] - TOL),
        "no wrap back to A"
    );
    assert!(
        (idx.last().unwrap() - (b - 1) as f64).abs() < TOL,
        "stops right before B"
    );
    assert!(!rig.shared.playing(), "and waits there");
    assert!(!rig.shared.held());
    assert_eq!(rig.shared.take_events() & EV_ENDED, 0);
}

#[test]
fn a_hold_ended_by_a_pause_leaves_the_loop_working() {
    // A paused take cancelled or kept: the range is over, as when skipped.
    let dir = tempfile::tempdir().unwrap();
    let (mut rig, n, b) = ranged(dir.path());
    rig.send(Cmd::Hold(true));
    rig.render(SR as usize / 10, 512);
    rig.send(Cmd::Pause);
    rig.send(Cmd::Hold(false));
    rig.render(SR as usize / 10, 512);
    assert!(
        !rig.shared.playing(),
        "letting go after the pause plays nothing"
    );
    rig.send(Cmd::Play);
    let (out, _) = rig.render(SR as usize * 3 / 2, 512);
    let idx = heard(&out, n);
    let near_b = idx.iter().position(|&v| v > (b - 1000) as f64).unwrap();
    assert!(
        idx[near_b..].iter().any(|&v| v < (SR + 1000) as f64),
        "wraps from B back to A"
    );
    assert!(rig.shared.playing());
}

#[test]
fn a_hold_after_the_range_ended_doesnt_play_on() {
    let dir = tempfile::tempdir().unwrap();
    let (mut rig, _, _) = ranged(dir.path());
    rig.render(SR as usize, 512); // the range plays out
    assert!(!rig.shared.playing());
    rig.send(Cmd::Hold(true));
    rig.render(512, 512);
    assert!(!rig.shared.held(), "nothing was playing to hold");
    rig.send(Cmd::Hold(false));
    rig.render(SR as usize / 10, 512);
    assert!(!rig.shared.playing());
}

#[test]
fn a_range_held_in_its_end_padding_still_waits_at_its_end() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 6.0);
    let (a, b) = (SR as u64, SR as u64 * 2);
    let mut rig = Rig::new(&path, SR, 1.0, 0);
    rig.send(Cmd::Seek(a));
    rig.send(Cmd::Range(Some(b)));
    rig.render(512, 512);
    let mut last = 0.0;
    while last < (b - 64) as f64 && rig.shared.playing() {
        let (out, _) = rig.render(32, 32);
        last = heard(&out, n).last().copied().unwrap_or(last);
    }
    rig.send(Cmd::Hold(true));
    rig.render(SR as usize / 10, 512);
    rig.send(Cmd::Hold(false));
    rig.render(SR as usize / 2, 512);
    assert!(!rig.shared.playing(), "the range finishes");
    assert!(
        (rig.shared.time() - 2.0).abs() < 0.01,
        "at B: {}",
        rig.shared.time()
    );
}

#[test]
fn a_held_clip_waits_and_lets_the_output_rest() {
    let dir = tempfile::tempdir().unwrap();
    let (path, _) = ramp_wav(dir.path(), SR, 4.0);
    let mut rig = Rig::new(&path, SR, 1.0, 0);
    rig.render(4800, 512);
    rig.send(Cmd::Clip(Some(Box::new(Clip::new(
        9,
        vec![0.25; SR as usize],
        SR,
    )))));
    rig.render(4800, 512);
    rig.send(Cmd::HoldClip(true));
    rig.render(1024, 512);
    assert!(rig.shared.clip_held.load(Relaxed));
    let at = rig.shared.clip_ms.load(Relaxed);
    let (out, _) = rig.render(SR as usize * 2, 512);
    assert!(out.iter().all(|&v| v == 0.0), "silent");
    assert_eq!(rig.shared.clip.load(Relaxed), 9, "still the clip playing");
    assert_eq!(rig.shared.clip_ms.load(Relaxed), at, "where it paused");
    assert!(!rig.shared.audible.load(Relaxed), "the output may idle");
    assert!(!rig.shared.playing(), "the track stays paused");
    rig.send(Cmd::HoldClip(false));
    let (out, _) = rig.render(4800, 512);
    assert!(out.chunks(2).skip(600).all(|f| (f[0] - 0.25).abs() < 1e-6));
    assert!(rig.shared.audible.load(Relaxed));
    rig.render(SR as usize, 512);
    assert_eq!(rig.shared.clip_done.load(Relaxed), 9, "played to its end");
}
