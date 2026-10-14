//! What the recorder needs from the engine: play a range once, copy the
//! output, play a clip over a paused track.

use super::*;
use crate::audio::clip::Clip;
use crate::audio::engine::{EV_CLIP_DONE, EV_ENDED};
use crate::audio::tap;
use std::sync::atomic::Ordering::Relaxed;

fn heard(out: &[f32], n: usize) -> Vec<f64> {
    out.chunks(2)
        .filter(|f| f[1].abs() > 1e-6)
        .map(|f| index_of(f, n))
        .collect()
}

#[test]
fn range_plays_once_and_waits_at_its_end() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 6.0);
    let (a, b) = (SR as u64, SR as u64 * 2);
    let mut rig = Rig::new(&path, SR, 1.0, 0);
    rig.set_loop(a, b, 3); // a sentence loop is on; the range ignores it
    rig.send(Cmd::Seek(a));
    rig.send(Cmd::Range(Some(b)));
    let (out, _) = rig.render(SR as usize * 2, 512);
    let idx = heard(&out, n);
    let from = idx
        .iter()
        .position(|v| (v - a as f64).abs() < TOL)
        .expect("starts at A");
    let last = *idx.last().unwrap();
    assert!(
        (last - (b - 1) as f64).abs() < TOL,
        "stops right before B: {last}"
    );
    assert!(
        idx[from..]
            .windows(2)
            .all(|w| (w[1] - w[0] - 1.0).abs() < TOL),
        "once, no wrap"
    );
    assert!(!rig.shared.playing(), "paused at the end");
    assert!(
        (rig.shared.time() - 2.0).abs() < 0.01,
        "waits at B: {}",
        rig.shared.time()
    );
    assert_eq!(
        rig.shared.take_events() & EV_ENDED,
        0,
        "not the end of the track"
    );
    // Playing again goes on from B (here with the loop cleared; with it, it would wrap).
    rig.send(Cmd::Loop(None, 4));
    rig.send(Cmd::Play);
    let (out, _) = rig.render(SR as usize / 2, 512);
    let idx = heard(&out, n);
    assert!(
        (idx[0] - b as f64).abs() < TOL,
        "goes on from B: {}",
        idx[0]
    );
}

#[test]
fn a_range_cut_short_leaves_the_loop_working() {
    // Skipping the original while recording pauses it partway; playing on
    // afterwards must loop the sentence again, not stop at its end.
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 6.0);
    let (a, b) = (SR as u64, SR as u64 * 2);
    let mut rig = Rig::new(&path, SR, 1.0, 0);
    rig.set_loop(a, b, 3);
    rig.send(Cmd::Seek(a));
    rig.send(Cmd::Range(Some(b)));
    rig.render(SR as usize / 2, 512);
    rig.send(Cmd::Pause);
    rig.render(SR as usize / 10, 512);
    assert!(!rig.shared.playing());
    rig.send(Cmd::Play);
    let (out, _) = rig.render(SR as usize * 3 / 2, 512);
    let idx = heard(&out, n);
    let near_b = idx
        .iter()
        .position(|&v| v > (b - 1000) as f64)
        .expect("reaches B");
    let back = idx[near_b..].iter().any(|&v| v < (a + 1000) as f64);
    assert!(
        back,
        "wraps from B back to A: {:?}",
        (idx[0], idx[near_b], idx.last())
    );
    assert!(rig.shared.playing(), "still playing, not waiting at B");
    assert_eq!(rig.shared.take_events() & EV_ENDED, 0);
}

#[test]
fn a_range_paused_at_its_very_end_waits_there() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 6.0);
    let (a, b) = (SR as u64, SR as u64 * 2);
    let mut rig = Rig::new(&path, SR, 1.0, 0);
    rig.send(Cmd::Seek(a));
    rig.send(Cmd::Range(Some(b)));
    // Up to the moment B has been read but not yet heard out.
    rig.render(512, 512);
    let mut last = 0.0;
    while last < (b - 64) as f64 && rig.shared.playing() {
        let (out, _) = rig.render(32, 32);
        last = heard(&out, n).last().copied().unwrap_or(last);
    }
    rig.send(Cmd::Pause);
    rig.render(SR as usize / 10, 512);
    assert!(!rig.shared.playing());
    assert!(
        (rig.shared.time() - 2.0).abs() < 0.01,
        "at B: {}",
        rig.shared.time()
    );
    rig.send(Cmd::Play);
    let (out, _) = rig.render(SR as usize / 2, 512);
    let idx = heard(&out, n);
    assert!(
        (idx[0] - b as f64).abs() < TOL,
        "goes on from B: {}",
        idx[0]
    );
    assert!(rig.shared.playing(), "and keeps playing");
    assert_eq!(
        rig.shared.take_events() & EV_ENDED,
        0,
        "not the end of the track"
    );
}

#[test]
fn tap_copies_what_was_played() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 4.0);
    let mut rig = Rig::new(&path, SR, 1.0, 0);
    let (t, mut rx) = tap::tap(2.0);
    rig.send(Cmd::Tap(Some(Box::new(t))));
    let mut played = Vec::new();
    for k in 0..10u64 {
        let mut out = vec![0.0f32; 512 * 2];
        rig.engine.render(&mut out, 2, 0);
        rig.engine.tap(&out, 2, k * 1_000_000);
        played.extend(out.chunks(2).map(|f| (f[0] + f[1]) * 0.5));
    }
    let mut marks = Vec::new();
    while let Ok(m) = rx.marks.pop() {
        marks.push(m);
    }
    assert_eq!(marks.len(), 10);
    assert!(marks.iter().all(|m| m.frames == 512 && m.rate == SR));
    assert_eq!(marks[3].at, 3_000_000);
    let got: Vec<f32> = std::iter::from_fn(|| rx.samples.pop().ok()).collect();
    assert_eq!(got, played);
    assert!(heard(&[got[600], 0.5], n)[0] > 0.0);
}

#[test]
fn clip_pauses_the_track_and_reports_its_end() {
    let dir = tempfile::tempdir().unwrap();
    let (path, _) = ramp_wav(dir.path(), SR, 4.0);
    let mut rig = Rig::new(&path, SR, 1.0, 0);
    rig.render(4800, 512);
    rig.send(Cmd::Clip(Some(Box::new(Clip::new(
        9,
        vec![0.25; 4800],
        SR,
    )))));
    rig.render(1024, 512);
    assert_eq!(rig.shared.clip.load(Relaxed), 9);
    assert!(!rig.shared.playing(), "the track pauses for the clip");
    let (out, _) = rig.render(1024, 512);
    assert!(
        out.chunks(2).all(|f| (f[0] - 0.25).abs() < 1e-6),
        "only the clip is heard"
    );
    rig.render(4800, 512);
    assert_eq!(rig.shared.clip.load(Relaxed), 0);
    assert_ne!(rig.shared.take_events() & EV_CLIP_DONE, 0);
    assert_eq!(rig.shared.clip_done.load(Relaxed), 9, "played to its end");
}

#[test]
fn playing_the_track_stops_a_clip_without_finishing_it() {
    // Chained take playback goes on only after a take that ended by itself.
    let dir = tempfile::tempdir().unwrap();
    let (path, _) = ramp_wav(dir.path(), SR, 4.0);
    let mut rig = Rig::new(&path, SR, 1.0, 0);
    rig.render(4800, 512);
    rig.send(Cmd::Clip(Some(Box::new(Clip::new(
        7,
        vec![0.25; 4800],
        SR,
    )))));
    rig.render(1024, 512);
    rig.send(Cmd::Play);
    rig.render(4800, 512);
    assert_eq!(rig.shared.clip.load(Relaxed), 0, "the clip is gone");
    assert!(rig.shared.playing(), "the track plays");
    assert_ne!(
        rig.shared.clip_done.load(Relaxed),
        7,
        "but it didn't finish"
    );
}
