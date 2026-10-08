//! Where to cut long audio into upload-sized pieces: in the quietest moment
//! near the end of each piece, so no sentence is split mid-word.

use super::pcm::RATE;

#[derive(Debug, Clone, Copy)]
pub struct ChunkPlan {
    /// Longest piece. 10 min of 16 kHz 16-bit mono WAV is 19.2 MB, under the 25 MB upload limit.
    pub max_secs: f64,
    /// The cut is chosen within this much before the maximum.
    pub search_secs: f64,
}

pub const DEFAULT: ChunkPlan = ChunkPlan {
    max_secs: 600.0,
    search_secs: 90.0,
};

impl ChunkPlan {
    pub fn max_samples(&self) -> usize {
        (self.max_secs * f64::from(RATE)) as usize
    }

    /// Cut position for a full buffer of `max_samples` samples.
    pub fn cut(&self, samples: &[f32]) -> usize {
        let from = samples
            .len()
            .saturating_sub((self.search_secs * f64::from(RATE)) as usize);
        quietest_point(samples, from)
    }
}

/// 20 ms frames.
const FRAME: usize = RATE as usize / 50;
/// Silence has to last a little to count: 0.4 s windows.
const WINDOW: usize = 20;

/// Sample index at the middle of the quietest 0.4 s in `samples[from..]`.
pub fn quietest_point(samples: &[f32], from: usize) -> usize {
    let energy: Vec<f32> = samples[from.min(samples.len())..]
        .chunks_exact(FRAME)
        .map(|f| f.iter().map(|s| s * s).sum())
        .collect();
    if energy.len() < WINDOW {
        return samples.len();
    }
    let mut sum: f32 = energy[..WINDOW].iter().sum();
    let (mut best, mut best_at) = (sum, 0);
    for i in WINDOW..energy.len() {
        sum += energy[i] - energy[i - WINDOW];
        // `<=` prefers the later of equally quiet spots: longer pieces, fewer requests.
        if sum <= best {
            best = sum;
            best_at = i + 1 - WINDOW;
        }
    }
    from + (best_at + WINDOW / 2) * FRAME
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(secs: f64) -> Vec<f32> {
        (0..(secs * f64::from(RATE)) as usize)
            .map(|i| (i as f32 * 0.07).sin() * 0.3)
            .collect()
    }

    #[test]
    fn cuts_in_the_middle_of_the_pause() {
        // speech 0–5 s, pause 5–6 s, speech 6–9 s
        let mut s = tone(5.0);
        s.extend(vec![0.0; RATE as usize]);
        s.extend(tone(3.0));
        let at = quietest_point(&s, 0) as f64 / f64::from(RATE);
        assert!((at - 5.5).abs() < 0.35, "cut at {at}");
    }

    #[test]
    fn only_looks_after_from() {
        let mut s = vec![0.0; RATE as usize]; // early silence, outside the search
        s.extend(tone(4.0));
        s.extend(vec![0.001; RATE as usize / 2]);
        s.extend(tone(1.0));
        let at = quietest_point(&s, RATE as usize * 3) as f64 / f64::from(RATE);
        assert!((at - 5.25).abs() < 0.3, "cut at {at}");
    }

    #[test]
    fn too_short_to_search_keeps_everything() {
        let s = tone(0.2);
        assert_eq!(quietest_point(&s, 0), s.len());
    }

    #[test]
    fn plan_searches_the_tail() {
        let plan = ChunkPlan {
            max_secs: 4.0,
            search_secs: 1.5,
        };
        let mut s = vec![0.0; RATE as usize]; // silence at 0–1 s must be ignored
        s.extend(tone(1.8));
        s.extend(vec![0.0; RATE as usize / 2]); // 2.8–3.3 s
        s.extend(tone(0.7));
        let at = plan.cut(&s) as f64 / f64::from(RATE);
        assert!((at - 3.05).abs() < 0.3, "cut at {at}");
    }
}
