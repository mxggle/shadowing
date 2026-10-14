//! The original's own audio for stretches of the track, mono at the take rate:
//! what each sentence sounds like, for comparing a paragraph you read on your
//! own (自己读 plays nothing, so there's no copy of the output to keep).

use super::take::{convert, RATE};
use crate::audio::decode::Decoder;
use std::path::Path;

/// Each `(start, end)` stretch (seconds, in order) of the file at `path`.
pub fn stretches(path: &Path, spans: &[(f64, f64)]) -> Result<Vec<Vec<f32>>, String> {
    let (Some(first), Some(last)) = (spans.first(), spans.last()) else {
        return Ok(Vec::new());
    };
    let mut d = Decoder::open(path)?;
    let (sr, ch) = (d.sample_rate, d.channels.max(1));
    let from = (first.0.max(0.0) * sr as f64) as u64;
    let to = (last.1 * sr as f64).ceil() as u64;
    d.seek(from)?;
    let mut mono = Vec::with_capacity((to - from) as usize);
    let mut buf = vec![0.0; 4096 * ch];
    while (mono.len() as u64) < to - from {
        let n = d.read(&mut buf)?;
        if n == 0 {
            break;
        }
        mono.extend(
            buf[..n * ch]
                .chunks(ch)
                .map(|f| f.iter().sum::<f32>() / ch as f32),
        );
    }
    let all = convert(&mono, sr, RATE);
    let at = |t: f64| (((t - first.0.max(0.0)) * RATE as f64).max(0.0) as usize).min(all.len());
    Ok(spans
        .iter()
        .map(|&(a, b)| all[at(a)..at(b).max(at(a))].to_vec())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuts_the_stretches_asked_for() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ramp.wav");
        // One second of silence, one of a 440 Hz tone, one of silence.
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 44_100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(&path, spec).unwrap();
        for i in 0..44_100 * 3 {
            let on = (44_100..88_200).contains(&i);
            let v = if on {
                ((i as f32 / 44_100.0 * 440.0 * std::f32::consts::TAU).sin() * 16_000.0) as i16
            } else {
                0
            };
            w.write_sample(v).unwrap();
            w.write_sample(v).unwrap();
        }
        w.finalize().unwrap();
        let s = stretches(&path, &[(0.5, 0.9), (1.2, 1.8), (2.1, 2.5)]).unwrap();
        let rms = |x: &[f32]| (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt();
        assert_eq!(s[1].len(), (0.6 * RATE as f64) as usize);
        assert!(rms(&s[0]) < 1e-3 && rms(&s[1]) > 0.3 && rms(&s[2]) < 1e-3);
    }
}
