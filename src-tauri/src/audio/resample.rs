//! Source-rate → device-rate conversion in fixed chunks (rubato FFT
//! resampler, allocation-free after construction). Equal rates pass through.

use rubato::{FftFixedInOut, Resampler as _};

const CHUNK: usize = 512;

pub enum Resampler {
    Pass,
    Fft {
        r: Box<FftFixedInOut<f32>>,
        ch: usize,
        inb: Vec<Vec<f32>>,
        outb: Vec<Vec<f32>>,
    },
}

impl Resampler {
    pub fn new(src_sr: u32, dev_sr: u32, ch: usize) -> Self {
        if src_sr == dev_sr || src_sr == 0 || dev_sr == 0 {
            return Resampler::Pass;
        }
        match FftFixedInOut::<f32>::new(src_sr as usize, dev_sr as usize, CHUNK, ch) {
            Ok(r) => {
                let inb = r.input_buffer_allocate(true);
                let outb = r.output_buffer_allocate(true);
                Resampler::Fft {
                    r: Box::new(r),
                    ch,
                    inb,
                    outb,
                }
            }
            Err(_) => Resampler::Pass,
        }
    }

    /// Source frames consumed per `process` call.
    pub fn chunk_in(&self) -> usize {
        match self {
            Resampler::Pass => CHUNK,
            Resampler::Fft { r, .. } => r.input_frames_next(),
        }
    }

    /// Device frames produced per `process` call.
    pub fn chunk_out(&self) -> usize {
        match self {
            Resampler::Pass => CHUNK,
            Resampler::Fft { r, .. } => r.output_frames_next(),
        }
    }

    /// Delay in device frames.
    pub fn delay(&self) -> usize {
        match self {
            Resampler::Pass => 0,
            Resampler::Fft { r, .. } => r.output_delay(),
        }
    }

    pub fn reset(&mut self) {
        if let Resampler::Fft { r, .. } = self {
            r.reset();
        }
    }

    /// Converts one chunk (`chunk_in` interleaved frames) into `out`; returns samples written.
    pub fn process(&mut self, input: &[f32], out: &mut [f32]) -> usize {
        match self {
            Resampler::Pass => {
                out[..input.len()].copy_from_slice(input);
                input.len()
            }
            Resampler::Fft { r, ch, inb, outb } => {
                let ch = *ch;
                for (i, frame) in input.chunks(ch).enumerate() {
                    for (c, &s) in frame.iter().enumerate() {
                        inb[c][i] = s;
                    }
                }
                let Ok((_, n)) = r.process_into_buffer(inb, outb, None) else {
                    let n = r.output_frames_next() * ch;
                    out[..n].fill(0.0);
                    return n;
                };
                for i in 0..n {
                    for c in 0..ch {
                        out[i * ch + c] = outb[c][i];
                    }
                }
                n * ch
            }
        }
    }
}
