//! Feed-order frame history: every source frame handed to the DSP stage, tagged
//! with the source position it came from. Indices ("feed indices") only grow;
//! loop splices and seeks are invisible here, which is what lets the engine map
//! "the frame being heard" back to a source time across loop wraps.

pub struct Fifo {
    ch: usize,
    mask: usize,
    data: Vec<f32>,
    pos: Vec<u64>,
    /// Oldest retained feed index.
    pub start: u64,
    /// Next feed index to be written.
    pub end: u64,
}

impl Fifo {
    pub fn new(ch: usize, min_frames: usize) -> Self {
        let cap = min_frames.next_power_of_two();
        Self {
            ch,
            mask: cap - 1,
            data: vec![0.0; cap * ch],
            pos: vec![0; cap],
            start: 0,
            end: 0,
        }
    }

    pub fn capacity(&self) -> usize {
        self.mask + 1
    }

    /// Drops all frames; indices keep counting from `end`.
    pub fn clear(&mut self) {
        self.start = self.end;
    }

    /// Contiguous writable slice at `end` (at most `max` frames). Evicts the
    /// oldest frames if needed. Call [`Fifo::commit`] with the count written.
    pub fn write_slice(&mut self, max: usize) -> &mut [f32] {
        let cap = self.capacity();
        let at = (self.end as usize) & self.mask;
        let n = max.min(cap - at);
        let need_start = (self.end + n as u64).saturating_sub(cap as u64);
        self.start = self.start.max(need_start);
        &mut self.data[at * self.ch..(at + n) * self.ch]
    }

    /// Publishes `n` frames written via `write_slice`, positions `first_pos..`.
    pub fn commit(&mut self, n: usize, first_pos: u64) {
        for i in 0..n {
            self.pos[(self.end as usize + i) & self.mask] = first_pos + i as u64;
        }
        self.end += n as u64;
    }

    pub fn push(&mut self, frames: &[f32], first_pos: u64) {
        let mut done = 0;
        let total = frames.len() / self.ch;
        while done < total {
            let ch = self.ch;
            let dst = self.write_slice(total - done);
            let n = dst.len() / ch;
            dst.copy_from_slice(&frames[done * ch..(done + n) * ch]);
            self.commit(n, first_pos + done as u64);
            done += n;
        }
    }

    /// Silence that reports position `pos` (used after end of file).
    pub fn push_silence(&mut self, n: usize, pos: u64) {
        let mut done = 0;
        while done < n {
            let dst = self.write_slice(n - done);
            dst.fill(0.0);
            let k = dst.len() / self.ch;
            let at = self.end;
            self.commit(k, 0);
            for i in 0..k as u64 {
                self.pos[((at + i) as usize) & self.mask] = pos;
            }
            done += k;
        }
    }

    /// Copies frames `[from, from + dst.len()/ch)`; they must be retained.
    pub fn copy_out(&self, from: u64, dst: &mut [f32]) {
        let n = dst.len() / self.ch;
        debug_assert!(from >= self.start && from + n as u64 <= self.end);
        let cap = self.capacity();
        let mut done = 0;
        while done < n {
            let at = ((from as usize) + done) & self.mask;
            let k = (n - done).min(cap - at);
            dst[done * self.ch..(done + k) * self.ch]
                .copy_from_slice(&self.data[at * self.ch..(at + k) * self.ch]);
            done += k;
        }
    }

    /// Source position of a retained feed index (clamped into the retained range).
    pub fn pos_at(&self, idx: u64) -> Option<u64> {
        if self.end == self.start {
            return None;
        }
        let idx = idx.clamp(self.start, self.end - 1);
        Some(self.pos[(idx as usize) & self.mask])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_and_evicts() {
        let mut f = Fifo::new(2, 8);
        let frames: Vec<f32> = (0..20).map(|i| i as f32).collect(); // 10 frames
        f.push(&frames, 100);
        assert_eq!((f.start, f.end), (2, 10));
        let mut out = [0.0; 4];
        f.copy_out(8, &mut out);
        assert_eq!(out, [16.0, 17.0, 18.0, 19.0]);
        assert_eq!(f.pos_at(9), Some(109));
        assert_eq!(f.pos_at(0), Some(102)); // clamped to oldest retained
        f.push_silence(3, 7);
        assert_eq!(f.pos_at(12), Some(7));
        f.clear();
        assert_eq!(f.pos_at(13), None);
    }
}
