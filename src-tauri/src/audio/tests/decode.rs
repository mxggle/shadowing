use super::*;
use crate::audio::feed::RingFeed;
use std::time::{Duration, Instant};

#[test]
fn decoder_seek_lands_on_exact_frame() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 5.0);
    let mut dec = Decoder::open(&path).unwrap();
    assert_eq!(dec.frames, Some(n as u64));
    assert_eq!((dec.sample_rate, dec.channels), (SR, 2));
    let mut buf = [0.0f32; 8];
    for target in [
        0usize,
        1,
        4095,
        4096,
        12_345,
        SR as usize * 3 + 17,
        n - 4,
        777,
    ] {
        dec.seek(target as u64).unwrap();
        assert_eq!(dec.read(&mut buf).unwrap(), 4);
        for k in 0..4 {
            assert_eq!(
                buf[k * 2],
                ramp_value(target + k, n),
                "seek to {target}, frame +{k}"
            );
        }
    }
    dec.seek(n as u64 + 10).unwrap();
    assert_eq!(dec.read(&mut buf).unwrap(), 0, "past the end reads nothing");
}

#[test]
fn garbage_files_are_errors_not_panics() {
    let dir = tempfile::tempdir().unwrap();
    let cases: [(&str, Vec<u8>); 5] = [
        (
            "noise.mp3",
            (0..20_000u32)
                .map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8)
                .collect(),
        ),
        ("empty.wav", Vec::new()),
        ("text.m4a", b"definitely not audio".repeat(100)),
        ("header.wav", b"RIFF\x24\x00\x00\x00WAVEfmt ".to_vec()),
        ("fake.flac", b"fLaC\x00\x00\x00\x22garbage".to_vec()),
    ];
    for (name, bytes) in cases {
        let path = dir.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        assert!(Decoder::open(&path).is_err(), "{name} should be rejected");
    }
    assert!(Decoder::open(&dir.path().join("missing.wav")).is_err());
}

#[test]
fn truncated_wav_reads_what_exists() {
    let dir = tempfile::tempdir().unwrap();
    let (path, _) = ramp_wav(dir.path(), SR, 1.0);
    let bytes = std::fs::read(&path).unwrap();
    let cut = dir.path().join("cut.wav");
    std::fs::write(&cut, &bytes[..bytes.len() / 2]).unwrap();
    if let Ok(mut dec) = Decoder::open(&cut) {
        let mut buf = vec![0.0f32; SR as usize * 4];
        let got = dec.read(&mut buf).unwrap_or(0);
        assert!(got < SR as usize, "cannot decode more than was written");
        let _ = dec.seek(SR as u64 * 3 / 4); // beyond the data: must not panic
    }
}

fn wait_available(feed: &mut RingFeed) -> usize {
    let t0 = Instant::now();
    loop {
        let n = feed.available();
        if n > 0 || feed.ended() {
            return n;
        }
        assert!(
            t0.elapsed() < Duration::from_secs(5),
            "decoder thread never delivered"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn ring_feed_serves_latest_request_only() {
    let dir = tempfile::tempdir().unwrap();
    let (path, n) = ramp_wav(dir.path(), SR, 4.0);
    let errors: crate::audio::feed::ErrorFn = Arc::new(|e| panic!("decode error {e}"));
    let mut feed = RingFeed::spawn(Decoder::open(&path).unwrap(), errors);
    let mut buf = vec![0.0f32; 200];
    for start in [1000usize, 90_000, 5] {
        feed.request(start as u64);
        // Let the old request's data pile up, then make sure it is skipped.
        std::thread::sleep(Duration::from_millis(20));
        wait_available(&mut feed);
        let got = feed.read(&mut buf);
        assert!(got > 0);
        for k in 0..got {
            assert_eq!(buf[k * 2], ramp_value(start + k, n), "request {start}");
        }
    }
    feed.request(n as u64 - 50);
    let mut total = 0;
    while !feed.ended() {
        wait_available(&mut feed);
        total += feed.read(&mut buf);
    }
    assert_eq!(total, 50);
}

/// Manual check for real codecs: `SHADOWING_FORMATS_DIR=<dir> cargo test formats -- --ignored --nocapture`.
/// Seeking must reproduce exactly what a linear decode yields at that frame.
#[test]
#[ignore = "needs SHADOWING_FORMATS_DIR with encoded audio files"]
fn formats_seek_matches_linear_decode() {
    let dir = std::env::var("SHADOWING_FORMATS_DIR").expect("SHADOWING_FORMATS_DIR");
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    files.sort();
    for path in files {
        let mut dec = match Decoder::open(&path) {
            Ok(d) => d,
            Err(e) => {
                println!(
                    "{:<28} OPEN FAILED: {e}",
                    path.file_name().unwrap().to_string_lossy()
                );
                continue;
            }
        };
        let ch = dec.channels;
        let mut all = vec![0.0f32; dec.sample_rate as usize * 600 * ch];
        let total = dec.read(&mut all).unwrap();
        let mut worst = 0.0f32;
        for k in 1..8u64 {
            let target = total as u64 * k / 8 + 37 * k;
            dec.seek(target).unwrap();
            let mut buf = vec![0.0f32; 4096 * ch];
            let got = dec.read(&mut buf).unwrap();
            let t = target as usize * ch;
            for (x, y) in buf[..got * ch].iter().zip(&all[t..]) {
                worst = worst.max((x - y).abs());
            }
            // Alignment check that tolerates non-deterministic codec noise (AAC PNS).
            let err = |lag: i64| -> f64 {
                let s = (t as i64 + lag * ch as i64) as usize;
                buf[..got * ch]
                    .iter()
                    .zip(&all[s..])
                    .map(|(x, y)| ((x - y) as f64).powi(2))
                    .sum()
            };
            let best = (-1500i64..1500)
                .filter(|l| t as i64 + l * (ch as i64) >= 0)
                .min_by(|a, b| err(*a).total_cmp(&err(*b)))
                .unwrap();
            let energy: f64 = buf[..got * ch].iter().map(|x| (*x as f64).powi(2)).sum();
            if best != 0 || worst > 1e-4 {
                println!(
                    "   target {target}: best lag {best}, residual {:.2e} of energy {:.2e}",
                    err(best),
                    energy
                );
            }
        }
        println!(
            "{:<28} {} Hz {}ch frames {} (header {:?}) worst seek diff {worst:.2e}",
            path.file_name().unwrap().to_string_lossy(),
            dec.sample_rate,
            ch,
            total,
            dec.frames
        );
        let _ = worst;
    }
}
