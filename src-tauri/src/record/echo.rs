//! Takes the original back out of the microphone, so shadowing works through
//! the Mac's speakers without headphones. Runs after the take, not live: we
//! have every sample the engine played (the output tap) on the same timeline
//! as the microphone, so the whole take can be used to learn the path from
//! speaker to mic, which stays put for those few seconds.
//!
//! 1. Find the delay (GCC-PHAT). No clear peak = no echo (headphones): done.
//! 2. Estimate the echo path once from the whole take (cross-spectrum over
//!    auto-spectrum, Welch). Your voice doesn't correlate with the original,
//!    so it averages out, even when you talk over it the whole time; a live
//!    adaptive canceller would have to freeze or would garble you instead.
//! 3. Subtract the predicted echo, then turn down what's left of it (the
//!    speaker's own processing) per frequency, never below `FLOOR`, so the
//!    voice stays natural.
//!
//! Measured on a MacBook Pro's own speakers and microphone (`real_tests.rs`):
//! 11–25 dB less echo per band, a voice talking over it kept at its level.

use realfft::num_complex::Complex32;
use realfft::RealFftPlanner;

/// Lags searched for the echo: a little early (clock offsets) to half a second late.
const EARLIEST_SECS: f64 = 0.05;
const LATEST_SECS: f64 = 0.5;
/// Echo path kept after the direct sound (room reflections in a small room).
const PATH_SECS: f64 = 0.12;
/// Taps kept before the direct sound, in case the delay estimate is a little late.
const LEAD_SECS: f64 = 0.004;
/// How far above the cross-correlation's background the peak must stand to count as echo.
const PEAK_MIN: f32 = 12.0;
/// Least gain left on a time-frequency cell after residual suppression (−16 dB).
const FLOOR: f32 = 0.15;

/// `mic` with the echo of `played` removed. Both mono at `rate`, sample `i` of
/// each captured / heard at about the same moment; `played` may be shorter.
pub fn cancel(mic: &[f32], played: &[f32], rate: u32) -> Vec<f32> {
    let mut far = played.to_vec();
    far.resize(mic.len(), 0.0);
    let Some(delay) = delay(mic, &far, rate) else {
        return mic.to_vec();
    };
    let lead = (LEAD_SECS * rate as f64) as isize;
    let far = shift(&far, delay - lead);
    let taps = (PATH_SECS * rate as f64) as usize + lead as usize;
    let path = echo_path(mic, &far, taps);
    let echo = convolve(&far, &path, mic.len());
    let residual: Vec<f32> = mic.iter().zip(&echo).map(|(m, e)| m - e).collect();
    suppress(&residual, &echo, &shift(&far, lead), rate)
}

/// Longer recordings (a paragraph) are done in overlapping windows of this
/// length, crossfaded: memory stays bounded, and each window learns its own
/// path (you might move the laptop halfway).
const WINDOW_SECS: usize = 20;
const OVERLAP_SECS: usize = 2;

/// `cancel` for recordings of any length.
pub fn cancel_long(mic: &[f32], played: &[f32], rate: u32) -> Vec<f32> {
    let (win, lap) = (WINDOW_SECS * rate as usize, OVERLAP_SECS * rate as usize);
    if mic.len() <= win + win / 2 {
        return cancel(mic, played, rate);
    }
    let mut out = vec![0.0f32; mic.len()];
    let mut start = 0;
    loop {
        let end = (start + win).min(mic.len());
        let far = &played[start.min(played.len())..end.min(played.len())];
        let part = cancel(&mic[start..end], far, rate);
        for (i, v) in part.iter().enumerate() {
            // Fade in over the overlap with the window before (except the first).
            let w = if start > 0 && i < lap {
                i as f32 / lap as f32
            } else {
                1.0
            };
            out[start + i] = out[start + i] * (1.0 - w) + v * w;
        }
        if end == mic.len() {
            return out;
        }
        start = end - lap;
    }
}

/// Samples by which the echo trails `far` in `mic`, if there is an echo.
/// The echo's lag behind `far` in samples; negative when the mic hears it
/// before the copy says it was played (the output's timestamps running late).
fn delay(mic: &[f32], far: &[f32], rate: u32) -> Option<isize> {
    let n = (mic.len() * 2).next_power_of_two();
    let mut planner = RealFftPlanner::<f32>::new();
    let (fwd, inv) = (planner.plan_fft_forward(n), planner.plan_fft_inverse(n));
    let spectrum = |x: &[f32]| {
        let mut buf = x.to_vec();
        buf.resize(n, 0.0);
        let mut out = fwd.make_output_vec();
        fwd.process(&mut buf, &mut out).ok()?;
        Some(out)
    };
    let (m, f) = (spectrum(mic)?, spectrum(far)?);
    let mut cross: Vec<Complex32> = m
        .iter()
        .zip(&f)
        .map(|(m, f)| {
            let c = m * f.conj();
            c / c.norm().max(1e-12)
        })
        .collect();
    let mut cc = inv.make_output_vec();
    inv.process(&mut cross, &mut cc).ok()?;
    let early = (EARLIEST_SECS * rate as f64) as usize;
    let late = ((LATEST_SECS * rate as f64) as usize).min(mic.len());
    // Lag k sits at cc[k]; negative lags wrap to the end.
    let lags: Vec<(isize, f32)> = (-(early as isize)..late as isize)
        .map(|k| (k, cc[k.rem_euclid(n as isize) as usize].abs()))
        .collect();
    let (best, peak) = lags
        .iter()
        .copied()
        .fold((0, 0.0), |a, b| if b.1 > a.1 { b } else { a });
    let background = lags.iter().map(|l| l.1).sum::<f32>() / lags.len().max(1) as f32;
    (peak > PEAK_MIN * background.max(1e-12)).then_some(best)
}

/// `x` moved later by `by` samples (earlier if negative), same length.
fn shift(x: &[f32], by: isize) -> Vec<f32> {
    (0..x.len() as isize)
        .map(|i| {
            x.get((i - by) as usize)
                .copied()
                .filter(|_| i >= by)
                .unwrap_or(0.0)
        })
        .collect()
}

/// Impulse response (`taps` long) from `far` to `mic`, from the whole take.
fn echo_path(mic: &[f32], far: &[f32], taps: usize) -> Vec<f32> {
    let seg = (taps * 4).next_power_of_two();
    let hop = seg / 2;
    let mut planner = RealFftPlanner::<f32>::new();
    let (fwd, inv) = (planner.plan_fft_forward(seg), planner.plan_fft_inverse(seg));
    let window: Vec<f32> = (0..seg)
        .map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / seg as f32).cos())
        .collect();
    let bins = seg / 2 + 1;
    let (mut sxy, mut sxx) = (vec![Complex32::new(0.0, 0.0); bins], vec![0.0f32; bins]);
    let (mut xb, mut yb) = (vec![0.0; seg], vec![0.0; seg]);
    let (mut xs, mut ys) = (fwd.make_output_vec(), fwd.make_output_vec());
    let mut start = 0;
    while start < mic.len() {
        for i in 0..seg {
            xb[i] = far.get(start + i).copied().unwrap_or(0.0) * window[i];
            yb[i] = mic.get(start + i).copied().unwrap_or(0.0) * window[i];
        }
        if fwd.process(&mut xb, &mut xs).is_ok() && fwd.process(&mut yb, &mut ys).is_ok() {
            for k in 0..bins {
                sxy[k] += xs[k].conj() * ys[k];
                sxx[k] += xs[k].norm_sqr();
            }
        }
        start += hop;
    }
    let floor = sxx.iter().sum::<f32>() / bins as f32 * 1e-4 + 1e-12;
    let mut h: Vec<Complex32> = sxy.iter().zip(&sxx).map(|(c, p)| c / (p + floor)).collect();
    // A real signal's spectrum has no imaginary part at DC and Nyquist.
    h[0].im = 0.0;
    h[bins - 1].im = 0.0;
    let mut ir = inv.make_output_vec();
    if inv.process(&mut h, &mut ir).is_err() {
        return vec![0.0; taps];
    }
    let fade = taps / 4;
    (0..taps)
        .map(|i| {
            let taper = if i + fade > taps {
                (taps - i) as f32 / fade as f32
            } else {
                1.0
            };
            ir[i] / seg as f32 * taper
        })
        .collect()
}

/// `x` filtered by `h`, first `len` samples.
fn convolve(x: &[f32], h: &[f32], len: usize) -> Vec<f32> {
    let n = (x.len() + h.len()).next_power_of_two();
    let mut planner = RealFftPlanner::<f32>::new();
    let (fwd, inv) = (planner.plan_fft_forward(n), planner.plan_fft_inverse(n));
    let (mut a, mut b) = (x.to_vec(), h.to_vec());
    a.resize(n, 0.0);
    b.resize(n, 0.0);
    let (mut fa, mut fb) = (fwd.make_output_vec(), fwd.make_output_vec());
    if fwd.process(&mut a, &mut fa).is_err() || fwd.process(&mut b, &mut fb).is_err() {
        return vec![0.0; len];
    }
    let mut prod: Vec<Complex32> = fa.iter().zip(&fb).map(|(a, b)| a * b).collect();
    let mut out = inv.make_output_vec();
    if inv.process(&mut prod, &mut out).is_err() {
        return vec![0.0; len];
    }
    out.truncate(len);
    out.iter().map(|v| v / n as f32).collect()
}

const FRAME: usize = 512;
const HOP: usize = FRAME / 2;

/// Reverb kept in the reference's power when predicting echo (laptop in a room).
const TAIL_SECS: f32 = 0.08;
/// How hard leftover echo is pushed down (over-subtraction).
const OVER: f32 = 2.0;
/// Which ratio (as a fraction of them, low to high) is taken as typical for the echo.
const PICK: f32 = 0.5;

/// Turns down what's left of the echo where it's louder than the voice. Two
/// guides: the predicted echo (how much of it leaks past the subtraction), and
/// the original's own spectrum (laptop speakers process their sound in ways a
/// linear path can't follow, so this catches what the prediction misses). How
/// strongly each couples into the mic, per frequency, is learnt from the
/// quietest cells, where you weren't talking.
fn suppress(residual: &[f32], echo: &[f32], far: &[f32], rate: u32) -> Vec<f32> {
    let len = residual.len();
    let mut planner = RealFftPlanner::<f32>::new();
    let (fwd, inv) = (
        planner.plan_fft_forward(FRAME),
        planner.plan_fft_inverse(FRAME),
    );
    // sqrt-Hann analysis and synthesis at 50 % overlap sum to one.
    let window: Vec<f32> = (0..FRAME)
        .map(|i| (0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / FRAME as f32).cos()).sqrt())
        .collect();
    let bins = FRAME / 2 + 1;
    let frames = len.div_ceil(HOP) + 1;
    let power = |x: &[f32]| -> Vec<Vec<f32>> {
        stft(x, frames, &window, &fwd)
            .into_iter()
            .map(|f| f.iter().map(|c| c.norm_sqr()).collect())
            .collect()
    };
    let e = stft(residual, frames, &window, &fwd);
    let pe: Vec<Vec<f32>> = e
        .iter()
        .map(|f| f.iter().map(|c| c.norm_sqr()).collect())
        .collect();
    let py = power(echo);
    // The original's power with its reverb tail: it keeps sounding in the room a little.
    let decay = (-(HOP as f32) / (TAIL_SECS * rate as f32)).exp();
    let mut px = power(far);
    for f in 1..frames {
        let (done, rest) = px.split_at_mut(f);
        for (now, before) in rest[0].iter_mut().zip(&done[f - 1]) {
            *now = now.max(before * decay);
        }
    }
    // Per bin, the typical ratio where the guide is loud (its louder half):
    // there the echo outweighs any voice in most cells.
    let coupling = |guide: &[Vec<f32>], pick: f32| -> Vec<f32> {
        (0..bins)
            .map(|k| {
                let mut loud: Vec<usize> = (0..frames).filter(|&f| guide[f][k] > 0.0).collect();
                if loud.len() < 8 {
                    return 0.0;
                }
                loud.sort_by(|&a, &b| guide[b][k].total_cmp(&guide[a][k]));
                loud.truncate(loud.len() / 2);
                let mut ratios: Vec<f32> = loud.iter().map(|&f| pe[f][k] / guide[f][k]).collect();
                ratios.sort_by(f32::total_cmp);
                ratios[(ratios.len() as f32 * pick) as usize]
            })
            .collect()
    };
    let (leak, couple) = (coupling(&py, PICK), coupling(&px, PICK));

    let mut out = vec![0.0; frames * HOP + FRAME];
    let mut buf = vec![0.0; FRAME];
    let (mut se, mut gain) = (vec![0.0f32; bins], vec![1.0f32; bins]);
    for f in 0..frames {
        let mut spec = e[f].clone();
        for k in 0..bins {
            se[k] = 0.5 * se[k] + 0.5 * pe[f][k];
            let left = (leak[k] * py[f][k]).max(couple[k] * px[f][k]);
            let g = (1.0 - OVER * left / se[k].max(1e-12)).clamp(FLOOR, 1.0);
            // Down at once, back up gently: fewer warbling artefacts.
            gain[k] = if g < gain[k] {
                g
            } else {
                gain[k] + 0.5 * (g - gain[k])
            };
            spec[k] *= gain[k];
        }
        spec[0].im = 0.0;
        spec[bins - 1].im = 0.0;
        if inv.process(&mut spec, &mut buf).is_err() {
            continue;
        }
        for i in 0..FRAME {
            out[f * HOP + i] += buf[i] * window[i] / FRAME as f32;
        }
    }
    out.drain(..HOP);
    out.truncate(len);
    out
}

/// Short-time spectra, `HOP` apart, the first frame centred on sample 0.
fn stft(
    x: &[f32],
    frames: usize,
    window: &[f32],
    fwd: &std::sync::Arc<dyn realfft::RealToComplex<f32>>,
) -> Vec<Vec<Complex32>> {
    let mut buf = vec![0.0; FRAME];
    (0..frames)
        .map(|f| {
            for (i, b) in buf.iter_mut().enumerate() {
                let at = (f * HOP + i).checked_sub(HOP);
                *b = at.and_then(|j| x.get(j)).copied().unwrap_or(0.0) * window[i];
            }
            let mut out = fwd.make_output_vec();
            let _ = fwd.process(&mut buf, &mut out);
            out
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcribe::pcm::{Pcm16k, RATE};
    use std::path::Path;

    fn speech(name: &str, secs: usize) -> Vec<f32> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("samples")
            .join(name);
        let mut pcm = Pcm16k::open(&path).unwrap();
        let mut buf = Vec::new();
        while pcm.read_into(&mut buf).unwrap() && buf.len() < secs * RATE as usize {}
        buf.truncate(secs * RATE as usize);
        buf
    }

    /// A small room: 25 ms to the mic, then a decaying tail; laptop speakers clip a little.
    fn room(played: &[f32]) -> Vec<f32> {
        let mut seed = 7u32;
        let mut noise = || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5
        };
        let delay = RATE as usize / 40;
        let tail: Vec<f32> = (0..RATE as usize / 8)
            .map(|i| noise() * 0.6 * (-(i as f32) / (RATE as f32 * 0.03)).exp())
            .collect();
        let mut out = vec![0.0; played.len()];
        for (i, &x) in played.iter().enumerate() {
            let x = (x * 1.5).tanh() * 0.6;
            for (k, &h) in tail.iter().enumerate() {
                if let Some(o) = out.get_mut(i + delay + k) {
                    *o += x * h;
                }
            }
        }
        out
    }

    fn energy(x: &[f32]) -> f32 {
        x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32
    }

    fn db(a: f32, b: f32) -> f32 {
        10.0 * (a / b.max(1e-12)).log10()
    }

    /// How closely the loudness of `out` follows `voice` (20 ms frames). The
    /// filters shift phase, so samples can't be compared one to one; the
    /// envelope is what you hear. Best over a small delay.
    fn follows(out: &[f32], voice: &[f32]) -> f32 {
        let env = |x: &[f32]| -> Vec<f32> { x.chunks(320).map(|c| energy(c).sqrt()).collect() };
        let (o, v) = (env(out), env(voice));
        (0..4)
            .map(|lag| {
                let n = (o.len() - lag).min(v.len());
                let (a, b) = (&o[lag..lag + n], &v[..n]);
                let mean = |x: &[f32]| x.iter().sum::<f32>() / n as f32;
                let (ma, mb) = (mean(a), mean(b));
                let cov: f32 = a.iter().zip(b).map(|(x, y)| (x - ma) * (y - mb)).sum();
                let va: f32 = a.iter().map(|x| (x - ma).powi(2)).sum();
                let vb: f32 = b.iter().map(|y| (y - mb).powi(2)).sum();
                cov / (va * vb).sqrt().max(1e-12)
            })
            .fold(f32::MIN, f32::max)
    }

    #[test]
    fn removes_the_original_and_keeps_the_voice() {
        let played = speech("ja/ごんぎつね.mp3", 12);
        // The learner starts talking 4 s in, over the original (double talk).
        let mut voice = vec![0.0; played.len()];
        let own = speech("en/The Tale of Peter Rabbit.mp3", 6);
        let at = 4 * RATE as usize;
        voice[at..at + own.len()].copy_from_slice(&own);
        let echo: Vec<f32> = room(&played).iter().map(|e| e * 0.3).collect();
        let mic: Vec<f32> = echo.iter().zip(&voice).map(|(e, v)| e + v * 0.5).collect();

        let out = cancel(&mic, &played, RATE);
        assert_eq!(out.len(), mic.len());
        let r = at..at + own.len();
        let v2: Vec<f32> = voice[r.clone()].iter().map(|v| v * 0.5).collect();
        eprintln!(
            "echo / voice while both talk: {:.1} dB",
            db(energy(&echo[r]), energy(&v2))
        );

        // Echo alone (before the learner speaks): pushed down by a lot, from the very start.
        let first = 0..RATE as usize;
        let erle_start = db(energy(&mic[first.clone()]), energy(&out[first]));
        let alone = RATE as usize..at;
        let erle = db(energy(&mic[alone.clone()]), energy(&out[alone]));
        eprintln!("echo reduction: first second {erle_start:.1} dB, then {erle:.1} dB");
        assert!(erle_start > 15.0, "{erle_start}");
        assert!(erle > 25.0, "{erle}");

        // While both talk, what's left is mostly the voice.
        let both = at + RATE as usize / 2..at + own.len();
        let v: Vec<f32> = voice[both.clone()].iter().map(|v| v * 0.5).collect();
        let kept = db(energy(&out[both.clone()]), energy(&v));
        let (before, after) = (follows(&mic[both.clone()], &v), follows(&out[both], &v));
        eprintln!("voice kept {kept:.1} dB, follows the voice {before:.2} → {after:.2}");
        assert!(kept > -6.0, "{kept}");
        assert!(after > 0.9 && after > before + 0.1, "{before} → {after}");
    }

    #[test]
    fn an_echo_heard_before_its_copy_is_removed_too() {
        // The output's timestamps run 45 ms late (another app enlarged the
        // buffers): the echo, 25 ms after the sound, comes 20 ms before its copy.
        let played = speech("ja/ごんぎつね.mp3", 8);
        let echo: Vec<f32> = room(&played).iter().map(|e| e * 0.3).collect();
        let late_by = RATE as usize * 45 / 1000;
        let mut copy = vec![0.0; late_by];
        copy.extend_from_slice(&played[..played.len() - late_by]);
        let out = cancel(&echo, &copy, RATE);
        let r = RATE as usize..echo.len();
        let erle = db(energy(&echo[r.clone()]), energy(&out[r]));
        eprintln!("echo reduction with the copy late: {erle:.1} dB");
        assert!(erle > 20.0, "{erle}");
    }

    #[test]
    fn long_recordings_are_done_in_windows() {
        let one = speech("ja/ごんぎつね.mp3", 30);
        let played: Vec<f32> = one.iter().chain(&one).copied().collect(); // a minute
        let echo: Vec<f32> = room(&played).iter().map(|e| e * 0.3).collect();
        let out = cancel_long(&echo, &played, RATE);
        assert_eq!(out.len(), echo.len());
        for w in [5usize, 19, 21, 40, 55] {
            let r = w * RATE as usize..(w + 1) * RATE as usize;
            let erle = db(energy(&echo[r.clone()]), energy(&out[r]));
            assert!(erle > 20.0, "second {w}: {erle:.1} dB");
        }
    }

    #[test]
    fn without_echo_the_voice_passes() {
        let voice = speech("en/The Tale of Peter Rabbit.mp3", 5);
        let played = speech("ja/ごんぎつね.mp3", 5);
        let out = cancel(&voice, &played, RATE);
        let kept = db(
            energy(&out[RATE as usize..]),
            energy(&voice[RATE as usize..]),
        );
        let same = follows(&out[RATE as usize..], &voice[RATE as usize..]);
        eprintln!("voice kept {kept:.1} dB, follows {same:.2}");
        assert!(kept > -4.0, "{kept}");
        assert!(same > 0.95, "{same}");
    }
}
