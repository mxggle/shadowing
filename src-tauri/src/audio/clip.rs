//! A short sound played over the engine's output instead of the track: a
//! recorded take, the original as it was heard, or both. Prepared (decoded,
//! resampled to the device rate) on the control thread; the engine only mixes.
//! It can be paused where it is (`hold`) and go on from there.

/// Fade at both ends so starting, stopping or pausing never clicks.
const FADE_SECS: f32 = 0.006;

pub struct Clip {
    pub id: u64,
    /// Mono at the device rate.
    pub samples: Vec<f32>,
    pub rate: u32,
    pub pos: usize,
    /// Stop requested: fade out from here.
    stopping: Option<usize>,
    held: bool,
    /// 1 playing, 0 paused (fading between the two).
    gain: f32,
}

impl Clip {
    pub fn new(id: u64, samples: Vec<f32>, rate: u32) -> Self {
        Self {
            id,
            samples,
            rate,
            pos: 0,
            stopping: None,
            held: false,
            gain: 1.0,
        }
    }

    /// Pauses (fading out, then staying where it is) or goes on.
    pub fn hold(&mut self, on: bool) {
        self.held = on;
    }

    pub fn held(&self) -> bool {
        self.held
    }

    /// Paused, and faded out by now.
    pub fn silent(&self) -> bool {
        self.held && self.gain <= 0.0
    }

    pub fn stop(&mut self) {
        self.stopping.get_or_insert(self.pos);
    }

    /// Cut off rather than played to its end.
    pub fn was_stopped(&self) -> bool {
        self.stopping.is_some()
    }

    /// Adds the next frames into `out` (interleaved, `ch` channels); true once finished.
    pub fn mix(&mut self, out: &mut [f32], ch: usize) -> bool {
        let fade = ((FADE_SECS * self.rate as f32) as usize).max(1);
        let len = self.samples.len();
        let target = if self.held { 0.0 } else { 1.0 };
        for frame in out.chunks_mut(ch) {
            let end = self.stopping.map_or(len, |s| (s + fade).min(len));
            if self.pos >= end {
                return true;
            }
            if self.gain < target {
                self.gain = (self.gain + 1.0 / fade as f32).min(1.0);
            } else if self.gain > target {
                self.gain = (self.gain - 1.0 / fade as f32).max(0.0);
            }
            if self.silent() {
                // Paused where it is; stopped while paused, it's over.
                return self.stopping.is_some();
            }
            let into = self.pos.min(end - self.pos).min(fade) as f32 / fade as f32;
            let v = self.samples[self.pos] * into.min(1.0) * self.gain;
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

    #[test]
    fn a_paused_clip_waits_where_it_is_and_goes_on_from_there() {
        let samples: Vec<f32> = (0..48_000).map(|i| i as f32 / 48_000.0).collect();
        let mut c = Clip::new(1, samples, 48_000);
        let mut out = vec![0.0; 4800];
        c.mix(&mut out, 1);
        c.hold(true);
        let mut out = vec![0.0; 4800];
        assert!(!c.mix(&mut out, 1));
        assert!(out[0] > 0.09 && out[100] < out[0], "fades out");
        assert!(out[400..].iter().all(|&v| v == 0.0), "then silent");
        assert!(c.silent());
        let at = c.pos;
        assert!(at < 4800 + 300, "stays where it paused: {at}");
        let mut out = vec![0.0; 48_000];
        assert!(!c.mix(&mut out, 1));
        assert_eq!(c.pos, at, "a long pause doesn't move it");
        c.hold(false);
        let mut out = vec![0.0; 4800];
        c.mix(&mut out, 1);
        assert!(out[0] < 0.01 && out[400] > 0.09, "fades back in");
        assert!(
            (out[400] - (at + 400) as f32 / 48_000.0).abs() < 1e-3,
            "from where it was"
        );
    }

    #[test]
    fn stopping_a_paused_clip_ends_it() {
        let mut c = Clip::new(1, vec![1.0; 48_000], 48_000);
        c.hold(true);
        let mut out = vec![0.0; 1000];
        c.mix(&mut out, 1);
        c.stop();
        assert!(c.mix(&mut out, 1));
        assert!(c.was_stopped());
    }
}
