//! What the recorder needs from the engine: play a range once, copy the
//! output, play a clip over a paused track.

use super::*;
use crate::audio::clip::Clip;
use crate::audio::engine::{EV_CLIP_DONE, EV_ENDED};
use crate::audio::tap;

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
    assert_eq!(
        rig.shared.clip.load(std::sync::atomic::Ordering::Relaxed),
        9
    );
    assert!(!rig.shared.playing(), "the track pauses for the clip");
    let (out, _) = rig.render(1024, 512);
    assert!(
        out.chunks(2).all(|f| (f[0] - 0.25).abs() < 1e-6),
        "only the clip is heard"
    );
    rig.render(4800, 512);
    assert_eq!(
        rig.shared.clip.load(std::sync::atomic::Ordering::Relaxed),
        0
    );
    assert_ne!(rig.shared.take_events() & EV_CLIP_DONE, 0);
}
