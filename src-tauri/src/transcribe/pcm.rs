//! Any supported audio file as a stream of 16 kHz mono samples (what speech
//! models expect), plus WAV encoding for upload.

use crate::audio::decode::Decoder;
use crate::audio::resample::Resampler;
use std::path::Path;

pub const RATE: u32 = 16_000;

pub struct Pcm16k {
    decoder: Decoder,
    resampler: Resampler,
    input: Vec<f32>,
    mono: Vec<f32>,
    output: Vec<f32>,
    /// Resampler latency still to be dropped from the front of the output.
    skip: usize,
    /// Output samples the whole input should produce; the flush is trimmed to this.
    expected: u64,
    produced: u64,
    source_frames: u64,
    source_rate: u32,
    finished: bool,
    /// Length in seconds, if the container says.
    pub duration: Option<f64>,
}

impl Pcm16k {
    pub fn open(path: &Path) -> Result<Self, String> {
        let decoder = Decoder::open(path)?;
        let resampler = Resampler::new(decoder.sample_rate, RATE, 1);
        let duration = decoder
            .frames
            .map(|f| f as f64 / f64::from(decoder.sample_rate));
        Ok(Self {
            skip: resampler.delay(),
            source_rate: decoder.sample_rate,
            input: Vec::new(),
            mono: Vec::new(),
            output: Vec::new(),
            expected: u64::MAX,
            produced: 0,
            source_frames: 0,
            finished: false,
            duration,
            decoder,
            resampler,
        })
    }

    /// Appends the next block of samples to `buf`; false once the stream has ended.
    pub fn read_into(&mut self, buf: &mut Vec<f32>) -> Result<bool, String> {
        if self.finished {
            return Ok(false);
        }
        let want = self.resampler.chunk_in();
        let ch = self.decoder.channels;
        self.input.resize(want * ch, 0.0);
        let got = self.decoder.read(&mut self.input)?;
        if self.expected == u64::MAX {
            self.source_frames += got as u64;
            if got < want {
                // Input ended: keep feeding silence until the resampler latency is flushed.
                self.expected =
                    self.source_frames * u64::from(RATE) / u64::from(self.source_rate.max(1));
            }
        }
        self.mono.clear();
        self.mono.extend(
            self.input[..got * ch]
                .chunks(ch)
                .map(|f| f.iter().sum::<f32>() / ch as f32),
        );
        self.mono.resize(want, 0.0);
        self.output.resize(self.resampler.chunk_out(), 0.0);
        let n = self.resampler.process(&self.mono, &mut self.output);
        let fresh = &self.output[self.skip.min(n)..n];
        self.skip -= self.skip.min(n);
        let room = self.expected.saturating_sub(self.produced) as usize;
        let take = fresh.len().min(room);
        buf.extend_from_slice(&fresh[..take]);
        self.produced += take as u64;
        if self.produced >= self.expected {
            self.finished = true;
        }
        Ok(!self.finished)
    }
}

/// 16-bit PCM mono WAV at `RATE`.
pub fn wav_bytes(samples: &[f32]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_wav(path: &Path, rate: u32, channels: u16, seconds: f32) {
        let spec = hound::WavSpec {
            channels,
            sample_rate: rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for i in 0..(rate as f32 * seconds) as u32 {
            let v =
                ((i as f32 / rate as f32 * 440.0 * std::f32::consts::TAU).sin() * 8000.0) as i16;
            for _ in 0..channels {
                w.write_sample(v).unwrap();
            }
        }
        w.finalize().unwrap();
    }

    fn read_all(path: &Path) -> Vec<f32> {
        let mut pcm = Pcm16k::open(path).unwrap();
        let mut buf = Vec::new();
        while pcm.read_into(&mut buf).unwrap() {}
        buf
    }

    #[test]
    fn resamples_stereo_44k_to_16k_mono_with_exact_length() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.wav");
        write_wav(&path, 44_100, 2, 3.0);
        let samples = read_all(&path);
        assert_eq!(samples.len(), 48_000);
        // The tone survives: RMS of a 8000/32768 sine ≈ 0.17.
        let rms = (samples[8000..40000].iter().map(|s| s * s).sum::<f32>() / 32000.0).sqrt();
        assert!((rms - 0.1726).abs() < 0.01, "rms {rms}");
    }

    #[test]
    fn passes_16k_through_untouched_in_length() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("b.wav");
        write_wav(&path, 16_000, 1, 1.25);
        assert_eq!(read_all(&path).len(), 20_000);
    }

    #[test]
    fn wav_bytes_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("c.wav");
        std::fs::write(&path, wav_bytes(&[0.0, 0.5, -1.0, 2.0])).unwrap();
        let mut r = hound::WavReader::open(&path).unwrap();
        assert_eq!((r.spec().sample_rate, r.spec().channels), (RATE, 1));
        let s: Vec<i16> = r.samples::<i16>().map(Result::unwrap).collect();
        assert_eq!(s, [0, 16384, -32767, 32767]);
    }
}
