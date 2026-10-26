use super::*;
use crate::audio::feed::RingFeed;
use std::time::{Duration, Instant};

/// Source index of every output frame.
fn indices(out: &[f32], n: usize) -> Vec<f64> {
    out.chunks(2)
        .map(|f| {
            if f[1].abs() > 1e-6 {
                index_of(f, n)
            } else {
                f64::NAN
            }
        })
        .collect()
}

#[test]
fn seek_and_play_are_sample_accurate() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 6.0);
    let mut rig = Rig::new(&path, SR, 1.0, 24_000);
    let (out, _) = rig.render(4800, 256);
    let idx = indices(&out, n);
    for (k, v) in idx.iter().enumerate() {
        assert!((v - (24_000 + k) as f64).abs() < TOL, "frame {k}: {v}");
    }
    for target in [100_000u64, 7, 200_001] {
        rig.send(Cmd::Seek(target));
        let (out, _) = rig.render(4800, 256);
        let idx = indices(&out, n);
        // The old audio fades out (4 ms), then the new position starts exactly.
        let first = idx
            .iter()
            .position(|v| (v - target as f64).abs() < TOL)
            .expect("target frame");
        assert!(first <= 200, "seek took {first} frames");
        for (k, v) in idx[first..].iter().enumerate() {
            assert!(
                (v - (target as usize + k) as f64).abs() < TOL,
                "after seek {target}, +{k}: {v}"
            );
        }
    }
}

/// Frames at which a loop pass begins (first frame after the splice crossfade).
fn pass_starts(idx: &[f64], a: u64, xf: u64) -> Vec<usize> {
    let mark = (a + xf) as f64;
    (1..idx.len())
        .filter(|&i| (idx[i] - mark).abs() < TOL && (idx[i - 1] - (mark - 1.0)).abs() > 0.5)
        .collect()
}

#[test]
fn ab_loop_is_gapless_and_exact() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 8.0);
    let (a, b) = (SR as u64, SR as u64 * 3 / 2 + 123); // 1.0 s .. ~1.5 s
    let xf = (SR as f64 * crate::audio::session::XF_SECS).round() as u64;
    let mut rig = Rig::new(&path, SR, 1.0, a - SR as u64 / 5);
    rig.set_loop(a, b, 1);
    let cycles = 6;
    let frames = (SR as u64 / 5 + (b - a) * cycles + 1000) as usize;
    let (out, _) = rig.render(frames, 300);
    let idx = indices(&out, n);
    let starts = pass_starts(&idx, a, xf);
    assert!(
        starts.len() >= cycles as usize,
        "only {} loop passes",
        starts.len()
    );
    // The reader can be one wrap ahead of what has been rendered.
    let repeats = rig.shared.repeats() as usize;
    assert!(
        (starts.len()..=starts.len() + 1).contains(&repeats),
        "{repeats} repeats counted for {} splices",
        starts.len()
    );
    for w in starts.windows(2) {
        assert_eq!(
            (w[1] - w[0]) as u64,
            b - a,
            "every pass is exactly B−A frames"
        );
    }
    // No gap or dip anywhere after the start fade: ch1 is 0.5·(cos+sin) ≥ 0.5 at splices.
    let fade = (SR as f64 * 0.004) as usize + 1;
    for (i, f) in out.chunks(2).enumerate().skip(fade) {
        assert!(f[1] >= 0.4999, "frame {i} dipped to {}", f[1]);
    }
    // Inside each splice the two signals are mixed (index between A and B).
    for &s in &starts {
        let mid = idx[s - xf as usize / 2];
        assert!(
            mid > (a + 1) as f64 && mid < (b - 1) as f64,
            "crossfade frame index {mid}"
        );
        assert!(
            out[(s - xf as usize / 2) * 2 + 1] > 0.6,
            "equal-power bump at splice"
        );
        // Pure source frames right after the splice.
        for k in 0..100 {
            assert!((idx[s + k] - (a + xf + k as u64) as f64).abs() < TOL);
        }
    }
}

#[test]
fn loop_wraps_only_when_crossing_b() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 8.0);
    let (a, b) = (SR as u64, SR as u64 * 2);
    let mut rig = Rig::new(&path, SR, 1.0, SR as u64 * 3); // already past B
    rig.set_loop(a, b, 7);
    let (out, _) = rig.render(SR as usize, 512);
    let idx = indices(&out, n);
    for w in idx.windows(2) {
        assert!(
            (w[1] - w[0] - 1.0).abs() < TOL,
            "no snap back when starting past B"
        );
    }
    assert_eq!(rig.shared.repeats(), 0, "playing past B is not a repeat");
    // Seek before A: plays through A, wraps at B.
    rig.send(Cmd::Seek(a / 2));
    let (out, _) = rig.render(SR as usize * 2, 512);
    let idx = indices(&out, n);
    let last_before_wrap = idx
        .windows(2)
        .position(|w| w[1] < w[0] - 100.0)
        .expect("wrap");
    assert!(
        (idx[last_before_wrap] - (b - 1) as f64).abs() < TOL,
        "wrap right after B−1"
    );
    assert_eq!(rig.shared.repeats(), 1, "one pass counted per wrap");
    // Clearing the loop lets playback run on past B.
    rig.send(Cmd::Loop(None, 8));
    let (out, _) = rig.render(SR as usize * 2, 512);
    let idx = indices(&out, n);
    assert!(
        idx.windows(2).all(|w| w[1] > w[0]),
        "no wrap after clearing"
    );
    assert!(*idx.last().unwrap() > b as f64);
    assert_eq!(rig.shared.repeats(), 0, "count resets with the loop");
}

#[test]
fn loop_waits_for_region_and_survives_threaded_feed() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 8.0);
    let dec = Decoder::open(&path).unwrap();
    let feed = RingFeed::spawn(dec, Arc::new(|e| panic!("{e}")));
    let (a, b) = (SR as u64 / 2, SR as u64);
    let mut rig = Rig::with_feed(&path, SR, 2, n as u64, Box::new(feed), SR, 1.0, a);
    rig.send(Cmd::Loop(Some((a, b)), 3)); // region arrives later
    let mut out = Vec::new();
    let t0 = Instant::now();
    let mut delivered = false;
    while out.len() < (SR as usize * 3) * 2 {
        if !delivered && t0.elapsed() > Duration::from_millis(30) {
            rig.set_loop(a, b, 3);
            delivered = true;
        }
        let (chunk, _) = rig.render(512, 512);
        out.extend(chunk);
        std::thread::sleep(Duration::from_micros(500));
    }
    let idx: Vec<f64> = indices(&out, n)
        .into_iter()
        .filter(|v| !v.is_nan())
        .collect();
    let wraps = idx.windows(2).filter(|w| w[1] < w[0] - 100.0).count();
    assert!(wraps >= 3, "looped {wraps} times");
    assert!(
        idx.iter()
            .all(|&v| v >= a as f64 - 1.0 && v < b as f64 + 300.0),
        "stayed in the loop"
    );
}

/// A file shorter than its header says, with the loop's A set past the real end:
/// the RAM region ends before A. This used to index out of range in the audio
/// callback (a process abort); now it just plays into the end.
#[test]
fn loop_starting_past_the_real_end_plays_to_the_end() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 2.0);
    let n64 = n as u64;
    let dec = Decoder::open(&path).unwrap();
    let claimed = n64 * 2; // e.g. a truncated MP3 whose Xing header counts the full file
    let start = n64 - SR as u64 / 10;
    let mut rig = Rig::with_feed(
        &path,
        SR,
        2,
        claimed,
        Box::new(DirectFeed::new(dec)),
        SR,
        1.0,
        start,
    );
    let (a, b) = (n64 + SR as u64 / 20, n64 + SR as u64 / 2);
    rig.set_loop(a, b, 7);
    let (out, _) = rig.render(SR as usize / 2, 256);
    let idx = indices(&out, n);
    let played: Vec<f64> = idx.iter().copied().filter(|v| !v.is_nan()).collect();
    assert!(!played.is_empty(), "played the last tenth of a second");
    assert!(
        played
            .iter()
            .all(|&v| v >= start as f64 - 1.0 && v < n as f64),
        "never jumped"
    );
    assert!(
        idx[idx.len() - 100..].iter().all(|v| v.is_nan()),
        "silent after the end"
    );
}

/// Each block the recorder's tap gets says where in the track its first frame is
/// (a take of a video is mapped back onto the picture with it); nothing while paused.
#[test]
fn tap_marks_carry_the_track_position() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 6.0);
    let mut rig = Rig::new(&path, SR, 1.0, 48_000);
    let (tap, mut rx) = crate::audio::tap::tap(4.0);
    rig.send(Cmd::Tap(Some(Box::new(tap))));
    let mut firsts = Vec::new();
    for k in 0..20u64 {
        let mut block = vec![0.0f32; 512 * 2];
        rig.engine.render(&mut block, 2, 0);
        rig.engine.tap(&block, 2, k * 1_000_000);
        firsts.push(index_of(&block[..2], n));
    }
    rig.send(Cmd::Pause);
    for _ in 0..8 {
        let mut block = vec![0.0f32; 512 * 2];
        rig.engine.render(&mut block, 2, 0);
        rig.engine.tap(&block, 2, 0);
    }
    let marks: Vec<_> = std::iter::from_fn(|| rx.marks.pop().ok()).collect();
    assert_eq!(marks.len(), 28);
    // Past the first blocks (the start fades in), each mark's place is its first frame's.
    for (m, first) in marks.iter().zip(&firsts).skip(2) {
        assert!(
            (m.src * SR as f64 - first).abs() < 2.0,
            "mark at {} for frame {first}",
            m.src * SR as f64
        );
    }
    // Paused (once the fade-out is over): no place in the track.
    assert!(marks[24..].iter().all(|m| m.src.is_nan()));
}
