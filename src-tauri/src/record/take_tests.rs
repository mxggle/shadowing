use super::*;
use crate::transcribe::pcm::Pcm16k;
use std::path::Path;

const MIC: u32 = 48_000;

fn speech(name: &str, secs: f64, rate: u32) -> Vec<f32> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join(name);
    let mut pcm = Pcm16k::open(&path).unwrap();
    let mut buf = Vec::new();
    let n = (secs * 16_000.0) as usize;
    while pcm.read_into(&mut buf).unwrap() && buf.len() < n {}
    buf.truncate(n);
    convert(&buf, 16_000, rate)
}

/// Output blocks of 512 frames heard from `start_ns` on.
fn tap(samples: &[f32], start_ns: u64) -> (Vec<Mark>, Vec<f32>) {
    let marks = samples
        .chunks(512)
        .enumerate()
        .map(|(i, c)| Mark {
            at: start_ns + (i as u64 * 512 * 1_000_000_000) / MIC as u64 + (i as u64 % 3) * 9_000,
            frames: c.len() as u32,
            rate: MIC,
        })
        .collect();
    (marks, samples.to_vec())
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
}

#[test]
fn convert_keeps_length_and_pitch() {
    let tone: Vec<f32> = (0..48_000)
        .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / 48_000.0).sin())
        .collect();
    let out = convert(&tone, 48_000, RATE);
    assert_eq!(out.len(), RATE as usize);
    // Zero crossings: 880 per second either way.
    let crossings = out.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
    assert!((438..=442).contains(&crossings), "{crossings}");
}

#[test]
fn listen_take_keeps_the_original_then_you() {
    // Mic opened 1 s (in host time) before the original starts; the original
    // plays 2 s; you answer 0.6 s after it ends, for ~2 s, quieter than it.
    let original = speech("ja/ごんぎつね.mp3", 2.0, MIC);
    let voice = speech("en/The Tale of Peter Rabbit.mp3", 2.0, MIC);
    let mic_at = 5_000_000_000u64;
    let (marks, played) = tap(&original, mic_at + 1_000_000_000);
    let mut mic = vec![0.0f32; MIC as usize * 6];
    for (i, v) in original.iter().enumerate() {
        mic[MIC as usize + i + 1200] += v * 0.3; // its echo, 25 ms later
    }
    let at = MIC as usize * 36 / 10;
    for (i, v) in voice.iter().enumerate() {
        mic[at + i] += v * 0.2;
    }
    let raw = Raw {
        mic,
        mic_rate: MIC,
        mic_at,
        marks,
        played,
        turn: MIC as usize * 3,
        followed: None,
    };
    let b = build(&raw, Mode::Listen).expect("a take");

    let (oa, ob) = b.original_span;
    let (ma, mb) = b.mine_span;
    // (The clip trails off in a pause, so its sound ends a little before 2 s.)
    assert!(
        oa < 0.2 && ob - oa > 1.5 && ob - oa < 2.05,
        "original {oa}..{ob}"
    );
    // One after the other (stored in one channel): you just after the original.
    assert!(
        ma > ob && ma - ob < 0.6,
        "mine starts {ma}, original ends {ob}"
    );
    assert!(b.original[at_secs(ma)..].iter().all(|v| *v == 0.0));
    assert!(mb > ma + 1.5, "mine {ma}..{mb}");
    // Nothing of the original on your track, and you're brought up to its level.
    let before = &b.mine[..at_secs(ma)];
    assert!(rms(before) < 1e-3, "before your turn: {}", rms(before));
    let (o, m) = (
        rms(&b.original[at_secs(oa)..at_secs(ob)]),
        rms(&b.mine[at_secs(ma)..at_secs(mb)]),
    );
    assert!(m > o * 0.5, "level matched: {m} vs {o}");
    assert_eq!(b.lag_ms, None);
    assert_eq!(b.original.len(), b.mine.len());
}

fn at_secs(s: f64) -> usize {
    (s * RATE as f64) as usize
}

#[test]
fn shadow_take_removes_the_original_and_measures_the_lag() {
    let original = speech("ja/ごんぎつね.mp3", 4.0, MIC);
    let mic_at = 1_000_000_000u64;
    let start = MIC as usize / 2;
    let (marks, played) = tap(&original, mic_at + 500_000_000);
    // Your imitation: the same words (here: the same audio, quieter) 400 ms behind.
    let lag = MIC as usize * 4 / 10;
    let mut mic = vec![0.0f32; MIC as usize * 6];
    for (i, v) in original.iter().enumerate() {
        mic[start + 1200 + i] += v * 0.3;
        mic[start + lag + i] += v * 0.25;
    }
    let raw = Raw {
        mic,
        mic_rate: MIC,
        mic_at,
        marks,
        played,
        turn: start + original.len(),
        followed: None,
    };
    let b = build(&raw, Mode::Shadow).expect("a take");
    let lag_ms = b.lag_ms.expect("lag");
    assert!((lag_ms - 400).abs() <= 30, "lag {lag_ms}");
}

/// 边听边说 in a room with a fan (−52 dBFS, as in a real take): the mic opens
/// 1.2 s before the original (3 s, its echo 25 ms later) and runs 1.2 s past
/// it. `you`: your voice, from 0.8 s into the original to 0.8 s past its end
/// (as far behind as people shadow), at this level against the fan (`None`:
/// you say nothing).
fn along(you: Option<f32>) -> Raw {
    let original = speech("ja/ごんぎつね.mp3", 3.0, MIC);
    let lead = MIC as usize * 12 / 10;
    let (marks, played) = tap(&original, 1_200_000_000);
    let mut seed = 1u32;
    let mut mic: Vec<f32> = (0..lead + original.len() + lead)
        .map(|_| {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            ((seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5) * 0.0087
        })
        .collect();
    for (i, v) in original.iter().enumerate() {
        mic[lead + 1200 + i] += v * 0.3;
    }
    if let Some(above) = you {
        let voice = speech("en/The Tale of Peter Rabbit.mp3", 3.0, MIC);
        let g = 0.0025 * 10f32.powf(above / 20.0) / rms(&voice);
        let at = lead + MIC as usize * 8 / 10;
        for (i, v) in voice.iter().enumerate() {
            mic[at + i] += v * g;
        }
    }
    Raw {
        mic,
        mic_rate: MIC,
        mic_at: 0,
        marks,
        played,
        turn: lead + original.len(),
        followed: None,
    }
}

#[test]
fn along_the_room_before_the_original_is_not_you() {
    // Removing the echo turns the room down while the original plays, so the
    // fan before it stood out as a voice: a take of 1.2 s of fan.
    assert_eq!(build(&along(None), Mode::Shadow).err(), Some(NOTHING_ALONG));
}

#[test]
fn along_a_quiet_voice_is_found() {
    // 12 dB above the fan, well under the original's echo: shadowing under your breath.
    let b = build(&along(Some(12.0)), Mode::Shadow).expect("a take");
    let (o, m) = (b.original_span, b.mine_span);
    let you = m.0 + LEAD_SECS - o.0;
    assert!((0.6..1.0).contains(&you), "you start 0.8 s in: {you:.2}");
    let past = m.1 - TAIL_SECS - o.1;
    assert!(
        (0.6..1.0).contains(&past),
        "and finish 0.8 s past it: {past:.2}"
    );
}

#[test]
fn saying_nothing_is_no_take() {
    let original = speech("ja/ごんぎつね.mp3", 2.0, MIC);
    let (marks, played) = tap(&original, 0);
    let mut mic: Vec<f32> = (0..MIC as usize * 4)
        .map(|i| ((i * 7919) % 1000) as f32 * 1e-6)
        .collect();
    for (i, v) in original.iter().enumerate() {
        mic[i + 1200] += v * 0.3;
    }
    let raw = Raw {
        mic,
        mic_rate: MIC,
        mic_at: 0,
        marks,
        played,
        turn: original.len(),
        followed: None,
    };
    assert_eq!(build(&raw, Mode::Listen).err(), Some(NOTHING));
}

#[test]
fn an_original_that_never_sounded_says_so() {
    // Skipped in the sentence's own quiet: nothing came out, though you spoke.
    let voice = speech("en/The Tale of Peter Rabbit.mp3", 2.0, MIC);
    let mut mic = vec![0.0f32; MIC as usize * 4];
    for (i, v) in voice.iter().enumerate() {
        mic[MIC as usize + i] += v * 0.2;
    }
    let (marks, played) = tap(&vec![0.0; MIC as usize / 2], 0);
    let raw = Raw {
        mic,
        mic_rate: MIC,
        mic_at: 0,
        marks,
        played,
        turn: MIC as usize / 2,
        followed: None,
    };
    let err = build(&raw, Mode::Listen).err().unwrap();
    assert!(err.contains("原句没有放出来"), "{err}");
}

#[test]
fn peaks_outline_the_loudness() {
    let mut x = vec![0.0; RATE as usize];
    x[RATE as usize / 2] = 0.5;
    let p = peaks(&x, 50);
    assert_eq!(p.len(), 50);
    assert_eq!(p[25], 128);
    assert_eq!(p[0], 0);
}
