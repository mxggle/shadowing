//! Speed stage: Signalsmith Stretch (pitch-preserving) for rate ≠ 1, and a
//! bit-transparent bypass at exactly 1.0. Switching between the two is a short
//! equal-power crossfade between time-aligned signals, so rate changes never
//! restart playback. Also answers "which feed index is being output now",
//! using the measured relation `output = fed − L_in − Σrate·L_out`.

use super::fifo::Fifo;
use signalsmith_stretch::Stretch;
use std::f32::consts::FRAC_PI_2;

/// Gives the stage access to source frames by feed index.
pub trait Input {
    /// Makes feed indices `< upto` available; false if the source is starved.
    fn ensure(&mut self, upto: u64) -> bool;
    fn fifo(&self) -> &Fifo;
}

pub fn is_unity(rate: f64) -> bool {
    (rate - 1.0).abs() < 1e-6
}

/// Recent (output frames, rate) pairs, newest last; used for latency maths.
struct RateHist {
    items: [(u32, f32); 128],
    len: usize,
    head: usize,
}

impl RateHist {
    fn new() -> Self {
        Self {
            items: [(0, 1.0); 128],
            len: 0,
            head: 0,
        }
    }
    fn clear(&mut self) {
        self.len = 0;
    }
    fn push(&mut self, n: usize, rate: f64) {
        self.items[self.head] = (n as u32, rate as f32);
        self.head = (self.head + 1) % self.items.len();
        self.len = (self.len + 1).min(self.items.len());
    }
    /// Σ rate over the newest `frames` output frames.
    fn sum(&self, mut frames: f64, fallback: f64) -> f64 {
        let mut total = 0.0;
        for i in 0..self.len {
            if frames <= 0.0 {
                return total;
            }
            let (n, r) = self.items[(self.head + self.items.len() - 1 - i) % self.items.len()];
            let take = frames.min(n as f64);
            total += take * r as f64;
            frames -= take;
        }
        total + frames.max(0.0) * fallback
    }
}

pub struct Stage {
    st: Stretch,
    ch: usize,
    l_in: u64,
    l_out: usize,
    preroll: u64,
    stretching: bool,
    need_prime: bool,
    /// Bypass read pointer (feed index of the next output frame).
    heard: u64,
    /// Next feed index the stretcher consumes.
    fed: u64,
    frac: f64,
    rate: f64,
    target: f64,
    /// Output frames still to run at rate 1.0 before switching to bypass.
    settle: usize,
    hist: RateHist,
    xf: usize,
    scratch_in: Vec<f32>,
    scratch_b: Vec<f32>,
    scratch_pre: Vec<f32>,
}

impl Stage {
    pub fn new(ch: usize, sr: u32, max_chunk: usize, rate: f64) -> Self {
        let st = Stretch::preset_default(ch as u32, sr);
        let (l_in, l_out) = (st.input_latency(), st.output_latency());
        // Signalsmith wants one block + one interval of pre-roll (0.12 s + 0.03 s).
        let preroll = (sr as f64 * 0.15).ceil() as u64;
        let max_in = (preroll as usize + l_out * 2 + max_chunk * 2 + 8).max(max_chunk * 3);
        Self {
            st,
            ch,
            l_in: l_in as u64,
            l_out,
            preroll,
            stretching: !is_unity(rate),
            need_prime: false,
            heard: 0,
            fed: 0,
            frac: 0.0,
            rate,
            target: rate,
            settle: 0,
            hist: RateHist::new(),
            xf: (sr as usize / 100).min(max_chunk), // 10 ms rate-switch crossfade
            scratch_in: vec![0.0; max_in * ch],
            scratch_b: vec![0.0; max_chunk * ch],
            scratch_pre: vec![0.0; l_out.max(1) * ch],
        }
    }

    /// Frames of history the stage needs before a seek target.
    pub fn preroll(&self) -> u64 {
        self.preroll + self.l_in
    }

    pub fn set_rate(&mut self, rate: f64) {
        self.target = rate;
    }

    /// After a seek: the next output frame is feed index `h`.
    pub fn reset_at(&mut self, h: u64) {
        self.heard = h;
        self.hist.clear();
        self.settle = 0;
        self.stretching = !is_unity(self.target);
        self.need_prime = self.stretching;
    }

    /// Feed index (fractional) of the frame `downstream` output frames ago.
    pub fn heard_index(&self, downstream: f64) -> f64 {
        if self.stretching && !self.need_prime {
            let lat = self.hist.sum(self.l_out as f64 + downstream, self.rate);
            self.fed as f64 - self.l_in as f64 - lat
        } else {
            self.heard as f64 - self.hist.sum(downstream, 1.0)
        }
    }

    /// Fills `out` (interleaved). False when starved; nothing is consumed then.
    pub fn produce(&mut self, input: &mut dyn Input, out: &mut [f32]) -> bool {
        let n = out.len() / self.ch;
        if self.need_prime {
            if !self.prime(input, self.heard, self.target, n) {
                return false;
            }
            self.need_prime = false;
        }
        if !self.stretching {
            if !is_unity(self.target) && self.prime(input, self.heard, self.target, n) {
                // Bypass → stretch: both signals are aligned at `heard`.
                let h = self.heard;
                self.stretching = true;
                if !self.stretch_chunk(input, out) {
                    self.need_prime = true; // cannot happen: prime() ensured the input
                    return false;
                }
                input.fifo().copy_out(h, &mut self.scratch_b[..n * self.ch]);
                crossfade(&self.scratch_b[..n * self.ch], out, self.xf.min(n), self.ch);
                return true;
            }
            if !input.ensure(self.heard + n as u64) {
                return false;
            }
            input.fifo().copy_out(self.heard, out);
            self.heard += n as u64;
            self.hist.push(n, 1.0);
            return true;
        }
        if is_unity(self.target) {
            if !is_unity(self.rate) {
                self.rate = 1.0;
                self.settle = self.l_out + n; // flush the output window at rate 1.0
            } else if self.settle == 0 {
                // Stretch → bypass: stretch output now equals fed − L_in − L_out.
                let h = self.fed.saturating_sub(self.l_in + self.l_out as u64);
                if !self.stretch_chunk(input, out) {
                    return false;
                }
                input.fifo().copy_out(h, &mut self.scratch_b[..n * self.ch]);
                crossfade_into_b(out, &self.scratch_b[..n * self.ch], self.xf.min(n), self.ch);
                self.stretching = false;
                self.heard = h + n as u64;
                return true;
            }
        } else {
            self.rate = self.target;
            self.settle = 0;
        }
        if !self.stretch_chunk(input, out) {
            return false;
        }
        self.settle = self.settle.saturating_sub(n);
        true
    }

    fn stretch_chunk(&mut self, input: &mut dyn Input, out: &mut [f32]) -> bool {
        let n = out.len() / self.ch;
        let want = n as f64 * self.rate + self.frac;
        let n_in = want.floor() as usize;
        if !input.ensure(self.fed + n_in as u64) {
            return false;
        }
        self.frac = want - n_in as f64;
        let buf = &mut self.scratch_in[..n_in * self.ch];
        input.fifo().copy_out(self.fed, buf);
        self.st.process(&*buf, &mut *out);
        self.fed += n_in as u64;
        self.hist.push(n, self.rate);
        true
    }

    /// Restarts the stretcher so its next output is feed index `h` at `rate`.
    fn prime(&mut self, input: &mut dyn Input, h: u64, rate: f64, n: usize) -> bool {
        let m = (self.l_out as f64 * rate).round() as u64;
        let first = h + self.l_in + m;
        if !input.ensure(first + (n as f64 * rate).ceil() as u64 + 2) {
            return false;
        }
        let fifo = input.fifo();
        let pre_end = h + self.l_in;
        let pre_start = pre_end.saturating_sub(self.preroll).max(fifo.start);
        let pre = &mut self.scratch_in[..(pre_end - pre_start) as usize * self.ch];
        fifo.copy_out(pre_start, pre);
        self.st.reset();
        self.st.seek(&*pre, rate);
        let warm = &mut self.scratch_in[..m as usize * self.ch];
        fifo.copy_out(pre_end, warm);
        self.st.process(&*warm, &mut self.scratch_pre[..]);
        self.fed = first;
        self.frac = 0.0;
        self.rate = rate;
        self.settle = 0;
        self.hist.clear();
        self.hist.push(self.l_out, rate);
        true
    }
}

/// `out = from·cos + out·sin` over the first `xf` frames (fade into `out`).
fn crossfade(from: &[f32], out: &mut [f32], xf: usize, ch: usize) {
    for i in 0..xf {
        let t = (i as f32 + 0.5) / xf as f32 * FRAC_PI_2;
        for c in 0..ch {
            let j = i * ch + c;
            out[j] = from[j] * t.cos() + out[j] * t.sin();
        }
    }
}

/// `out = out·cos + to·sin` for the first `xf` frames, then `to` (fade out of `out`).
fn crossfade_into_b(out: &mut [f32], to: &[f32], xf: usize, ch: usize) {
    for i in 0..out.len() / ch {
        for c in 0..ch {
            let j = i * ch + c;
            out[j] = if i < xf {
                let t = (i as f32 + 0.5) / xf as f32 * FRAC_PI_2;
                out[j] * t.cos() + to[j] * t.sin()
            } else {
                to[j]
            };
        }
    }
}
