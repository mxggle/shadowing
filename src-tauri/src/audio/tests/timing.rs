//! Reported time vs. what is actually rendered, through the stretcher and resampler.

use super::*;

const BURST_EVERY: f64 = 0.5;
const BURST_LEN: f64 = 0.03;

/// Silence with 30 ms 700 Hz bursts starting every 0.5 s.
fn bursts_wav(dir: &Path, sr: u32, secs: f64) -> PathBuf {
    let path = dir.join(format!("bursts{sr}.wav"));
    write_wav(&path, sr, (sr as f64 * secs) as usize, |i| {
        let t = i as f64 / sr as f64;
        let phase = t % BURST_EVERY;
        let v = if t >= BURST_EVERY && phase < BURST_LEN {
            (t * 700.0 * std::f64::consts::TAU).sin() as f32 * 0.5
        } else {
            0.0
        };
        [v, v]
    });
    path
}

/// Energy centroids (output frame) of each burst.
fn burst_centroids(out: &[f32], dev_sr: u32) -> Vec<f64> {
    let e: Vec<f64> = out.chunks(2).map(|f| (f[0] as f64).powi(2)).collect();
    let gap = (dev_sr as f64 * 0.15) as usize;
    let (mut res, mut i) = (Vec::new(), 0);
    while i < e.len() {
        if e[i] > 1e-4 {
            let end = (i + gap).min(e.len());
            let (mut sum, mut w) = (0.0, 0.0);
            for (j, v) in e
                .iter()
                .enumerate()
                .take(end)
                .skip(i.saturating_sub(gap / 3))
            {
                sum += j as f64 * v;
                w += v;
            }
            res.push(sum / w);
            i = end;
        } else {
            i += 1;
        }
    }
    res
}

/// Reported time when output frame `frame` is the next one heard.
fn time_at(times: &[(usize, f64)], frame: f64) -> f64 {
    let k = times.partition_point(|&(f, _)| (f as f64) < frame);
    times[k.min(times.len() - 1)].1
}

fn check_timing(src_sr: u32, dev_sr: u32, rate: f64, tolerance: f64) -> f64 {
    let dir = tempfile::tempdir().unwrap();
    let path = bursts_wav(dir.path(), src_sr, 6.0);
    let start = 0.3;
    let mut rig = Rig::new(&path, dev_sr, rate, (start * src_sr as f64) as u64);
    let secs = 4.0 / rate;
    let (out, times) = rig.render((dev_sr as f64 * secs) as usize, 64);
    let centroids = burst_centroids(&out, dev_sr);
    assert!(centroids.len() >= 6, "found {} bursts", centroids.len());
    let mut worst: f64 = 0.0;
    for c in centroids {
        let reported = time_at(&times, c);
        // Source centroid of the nearest burst.
        let k = ((reported - BURST_LEN / 2.0) / BURST_EVERY).round();
        let expected = k * BURST_EVERY + BURST_LEN / 2.0;
        let err = reported - expected;
        worst = worst.max(err.abs());
        assert!(
            err.abs() <= tolerance,
            "{src_sr}->{dev_sr} rate {rate}: burst at {expected:.3}s reported {reported:.4}s ({:+.1} ms)",
            err * 1000.0
        );
    }
    // Time advances at `rate` source seconds per output second.
    let (f0, t0) = times[times.len() / 4];
    let (f1, t1) = times[times.len() - 1];
    let speed = (t1 - t0) / ((f1 - f0) as f64 / dev_sr as f64);
    assert!(
        (speed - rate).abs() < 0.01,
        "time runs at {speed}x, expected {rate}x"
    );
    worst
}

#[test]
fn reported_time_matches_audio_at_rate_1() {
    let worst = check_timing(SR, SR, 1.0, 0.005);
    println!("rate 1.0 bypass: worst error {:.1} ms", worst * 1000.0);
}

#[test]
fn reported_time_matches_audio_at_rate_075() {
    let worst = check_timing(SR, SR, 0.75, 0.02);
    println!("rate 0.75: worst error {:.1} ms", worst * 1000.0);
}

#[test]
fn reported_time_matches_audio_with_resampling() {
    let worst = check_timing(44_100, SR, 1.0, 0.01);
    println!("44.1k->48k rate 1.0: worst error {:.1} ms", worst * 1000.0);
    let worst = check_timing(44_100, SR, 1.25, 0.02);
    println!("44.1k->48k rate 1.25: worst error {:.1} ms", worst * 1000.0);
}

#[test]
fn rate_changes_are_continuous_and_return_to_bit_exact() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 12.0);
    let mut rig = Rig::new(&path, SR, 1.0, 0);
    let mut out = Vec::new();
    for rate in [1.0, 0.75, 1.5, 0.5, 1.0] {
        rig.send(Cmd::Rate(rate));
        let (chunk, times) = rig.render(SR as usize, 256);
        assert!(
            times.windows(2).all(|w| w[1].1 >= w[0].1),
            "time never runs backwards"
        );
        out.extend(chunk);
    }
    assert!(out.iter().all(|s| s.is_finite()));
    let win = SR as usize / 100;
    for (k, w) in out.chunks(win * 2).enumerate().skip(1) {
        let rms = (w.iter().skip(1).step_by(2).map(|s| s * s).sum::<f32>() / win as f32).sqrt();
        assert!(rms > 0.3, "window {k} ({} ms) dropped to rms {rms}", k * 10);
    }
    // Last 0.5 s is back on the bypass path: consecutive source frames, exactly.
    let tail = &out[out.len() - SR as usize..];
    let idx: Vec<f64> = tail.chunks(2).map(|f| index_of(f, n)).collect();
    for w in idx.windows(2) {
        assert!(
            (w[1] - w[0] - 1.0).abs() < TOL,
            "bypass is bit-exact: {} -> {}",
            w[0],
            w[1]
        );
    }
}

#[test]
fn loop_period_is_exact_through_the_stretcher() {
    let dir = tempfile::tempdir().unwrap();
    let path = bursts_wav(dir.path(), SR, 4.0);
    let rate = 0.75;
    let (a, b) = (0.9, 1.6); // contains the bursts at 1.0 s and 1.5 s
    let mut rig = Rig::new(&path, SR, rate, (a * SR as f64) as u64);
    rig.set_loop((a * SR as f64) as u64, (b * SR as f64) as u64, 1);
    let (out, times) = rig.render(SR as usize * 6, 128);
    let c = burst_centroids(&out, SR);
    assert!(c.len() >= 10, "found {} bursts", c.len());
    let period = (b - a) / rate * SR as f64;
    for w in c.windows(3) {
        // Same burst one loop later.
        let err = (w[2] - w[0] - period) / SR as f64;
        assert!(
            err.abs() < 0.003,
            "loop period off by {:.1} ms",
            err * 1000.0
        );
    }
    // Reported time stays inside the loop and wraps every period.
    let inside = times
        .iter()
        .skip(20)
        .all(|&(_, t)| t >= a - 0.01 && t < b + 0.01);
    assert!(inside, "reported time left the loop");
}
