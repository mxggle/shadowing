//! Kaldi-style log mel filterbank features (80 bins, 25 ms frames every 10 ms),
//! the input speaker-embedding models are trained on. Matches
//! `torchaudio.compliance.kaldi.fbank` with dither off.

use realfft::RealFftPlanner;

pub const BINS: usize = 80;
const RATE: f64 = 16_000.0;
const WINDOW: usize = 400;
const SHIFT: usize = 160;
const FFT: usize = 512;
const PREEMPHASIS: f32 = 0.97;

/// Features with each bin's mean over time removed, as the models expect.
pub fn fbank(samples: &[f32]) -> Vec<[f32; BINS]> {
    let mut rows = log_mel(samples);
    let mut mean = [0f32; BINS];
    for row in &rows {
        for (m, v) in mean.iter_mut().zip(row) {
            *m += v / rows.len() as f32;
        }
    }
    for row in &mut rows {
        for (v, m) in row.iter_mut().zip(&mean) {
            *v -= m;
        }
    }
    rows
}

fn log_mel(samples: &[f32]) -> Vec<[f32; BINS]> {
    if samples.len() < WINDOW {
        return Vec::new();
    }
    let frames = 1 + (samples.len() - WINDOW) / SHIFT;
    // Povey window: a Hann window raised to 0.85.
    let window: Vec<f32> = (0..WINDOW)
        .map(|i| {
            let a = std::f64::consts::TAU * i as f64 / (WINDOW - 1) as f64;
            (0.5 - 0.5 * a.cos()).powf(0.85) as f32
        })
        .collect();
    let banks = mel_banks();
    let fft = RealFftPlanner::<f32>::new().plan_fft_forward(FFT);
    let mut input = fft.make_input_vec();
    let mut spectrum = fft.make_output_vec();
    let mut power = vec![0f32; spectrum.len()];
    let mut frame = [0f32; WINDOW];
    let mut out = Vec::with_capacity(frames);
    for f in 0..frames {
        let src = &samples[f * SHIFT..f * SHIFT + WINDOW];
        let mean = src.iter().sum::<f32>() / WINDOW as f32;
        // Kaldi works on 16-bit sample values.
        for (d, s) in frame.iter_mut().zip(src) {
            *d = (s - mean) * 32768.0;
        }
        for i in (1..WINDOW).rev() {
            frame[i] -= PREEMPHASIS * frame[i - 1];
        }
        frame[0] -= PREEMPHASIS * frame[0];
        input.fill(0.0);
        for ((d, s), w) in input.iter_mut().zip(&frame).zip(&window) {
            *d = s * w;
        }
        fft.process(&mut input, &mut spectrum)
            .expect("buffers come from the plan");
        for (p, c) in power.iter_mut().zip(&spectrum) {
            *p = c.norm_sqr();
        }
        let mut row = [0f32; BINS];
        for (r, (first, weights)) in row.iter_mut().zip(&banks) {
            let energy: f32 = weights
                .iter()
                .zip(&power[*first..])
                .map(|(w, p)| w * p)
                .sum();
            *r = energy.max(f32::EPSILON).ln();
        }
        out.push(row);
    }
    out
}

fn mel(hz: f64) -> f64 {
    1127.0 * (1.0 + hz / 700.0).ln()
}

/// Triangular filters, evenly spaced on the mel scale from 20 Hz to 8 kHz:
/// for each, the first FFT bin it covers and its weights from there.
fn mel_banks() -> Vec<(usize, Vec<f32>)> {
    let (low, high) = (mel(20.0), mel(RATE / 2.0));
    let step = (high - low) / (BINS + 1) as f64;
    (0..BINS)
        .map(|b| {
            let (left, center, right) = (
                low + b as f64 * step,
                low + (b + 1) as f64 * step,
                low + (b + 2) as f64 * step,
            );
            let weights: Vec<(usize, f32)> = (0..FFT / 2)
                .filter_map(|i| {
                    let m = mel(i as f64 * RATE / FFT as f64);
                    let w = if m <= left || m >= right {
                        return None;
                    } else if m <= center {
                        (m - left) / (center - left)
                    } else {
                        (right - m) / (right - center)
                    };
                    Some((i, w as f32))
                })
                .collect();
            let first = weights.first().map_or(0, |w| w.0);
            (first, weights.into_iter().map(|w| w.1).collect())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(hz: f32, secs: f32) -> Vec<f32> {
        (0..(secs * 16_000.0) as usize)
            .map(|i| (i as f32 / 16_000.0 * hz * std::f32::consts::TAU).sin() * 0.3)
            .collect()
    }

    #[test]
    fn frames_every_ten_milliseconds() {
        assert_eq!(fbank(&tone(440.0, 1.0)).len(), 98);
        assert!(fbank(&tone(440.0, 0.02)).is_empty());
    }

    #[test]
    fn a_tone_lights_up_the_filter_around_its_pitch() {
        let rows = log_mel(&tone(1000.0, 0.5));
        let row = rows[10];
        let loudest = (0..BINS)
            .max_by(|&a, &b| row[a].total_cmp(&row[b]))
            .unwrap();
        // 1 kHz is 1000 mel; filter centres are ~34.7 mel apart from 31.7 mel.
        assert!((26..=27).contains(&loudest), "{loudest}");
    }

    #[test]
    fn each_bin_averages_zero_over_time() {
        let mut speechy = tone(200.0, 0.6);
        speechy.extend(tone(900.0, 0.6));
        let rows = fbank(&speechy);
        for b in 0..BINS {
            let mean: f32 = rows.iter().map(|r| r[b]).sum::<f32>() / rows.len() as f32;
            assert!(mean.abs() < 1e-3, "bin {b}: {mean}");
        }
    }
}
