//! A short sound played over the engine's output instead of the track: a
//! recorded take, the original as it was heard, or both. Prepared (decoded,
//! resampled to the device rate) on the control thread; the engine only mixes.

/// Fade at both ends so starting or stopping never clicks.
const FADE_SECS: f32 = 0.006;

pub struct Clip {
    pub id: u64,
    /// Mono at the device rate.
    pub samples: Vec<f32>,
    pub rate: u32,
    pub pos: usize,
    /// Stop requested: fade out from here.
    stopping: Option<usize>,
}

impl Clip {
    pub fn new(id: u64, samples: Vec<f32>, rate: u32) -> Self {
        Self {
            id,
            samples,
            rate,
            pos: 0,
            stopping: None,
        }
    }

    pub fn stop(&mut self) {
        self.stopping.get_or_insert(self.pos);
    }

    /// Adds the next frames into `out` (interleaved, `ch` channels); true once finished.
    pub fn mix(&mut self, out: &mut [f32], ch: usize) -> bool {
        let fade = ((FADE_SECS * self.rate as f32) as usize).max(1);
        let len = self.samples.len();
        for frame in out.chunks_mut(ch) {
            let end = self.stopping.map_or(len, |s| (s + fade).min(len));
            if self.pos >= end {
                return true;
            }
            let into = self.pos.min(end - self.pos).min(fade) as f32 / fade as f32;
            let v = self.samples[self.pos] * into.min(1.0);
            for s in frame.iter_mut().take(2) {
                *s += v;
            }
            self.pos += 1;
        }
        self.pos >= len
    }

    pub fn secs(&self) -> f64 {
        self.pos as f64 / self.rate.max(1) as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plays_through_then_finishes() {
        let mut c = Clip::new(1, vec![1.0; 1000], 48_000);
        let mut out = vec![0.0; 2 * 600];
        assert!(!c.mix(&mut out, 2));
        assert_eq!(out[0], 0.0, "fades in");
        assert_eq!(out[2 * 500], 1.0);
        assert_eq!(out[2 * 500], out[2 * 500 + 1], "both channels");
        let mut out = vec![0.0; 2 * 600];
        assert!(c.mix(&mut out, 2));
        assert_eq!(out[2 * 500], 0.0, "silent after the end");
    }

    #[test]
    fn stop_fades_out() {
        let mut c = Clip::new(1, vec![1.0; 48_000], 48_000);
        let mut out = vec![0.0; 1000];
        c.mix(&mut out, 1);
        c.stop();
        let mut out = vec![0.0; 1000];
        assert!(c.mix(&mut out, 1));
        assert!(out[0] > 0.9 && out[200] < out[0] && out[400] == 0.0);
    }
}
