//! Source timeline: produces source frames in playback order into the `Fifo`,
//! applying A–B loop wraps at the exact frame. Reads come from a RAM region
//! when one covers the cursor, else from the streaming feed. A wrap happens
//! only when reading *crosses* B (same rule as `shouldJumpToA` in
//! src/audio/logic.ts) and splices B→A with an equal-power crossfade.

use super::feed::Feed;
use super::fifo::Fifo;
use super::region::Region;
use std::f32::consts::FRAC_PI_2;
use std::sync::Arc;

#[derive(Clone, Copy)]
struct Loop {
    a: u64,
    b: u64,
    id: u64,
}

enum Read {
    Frames(usize),
    Starved,
    Eof,
}

pub struct Reader {
    feed: Box<dyn Feed>,
    ch: usize,
    cursor: u64,
    in_region: bool,
    read_region: Option<Arc<Region>>,
    loop_region: Option<Arc<Region>>,
    lp: Option<Loop>,
    region_failed: bool,
    pending_wrap: bool,
    /// Loop id the pending wrap belongs to.
    pending_id: u64,
    tail: Vec<f32>,
    tail_got: usize,
    stream_pos: Option<u64>,
    /// Feed index where end-of-file padding started.
    pub eof_feed: Option<u64>,
    xf: usize,
    history: u64,
    /// Regions to be freed off the audio thread.
    pub retired: Vec<Arc<Region>>,
    /// Times the current loop has jumped from B back to A (0 when set).
    pub wraps: u32,
}

impl Reader {
    pub fn new(feed: Box<dyn Feed>, ch: usize, xf: usize, history: u64) -> Self {
        Self {
            feed,
            ch,
            cursor: 0,
            in_region: false,
            read_region: None,
            loop_region: None,
            lp: None,
            region_failed: false,
            pending_wrap: false,
            pending_id: 0,
            tail: vec![0.0; xf.max(1) * ch],
            tail_got: 0,
            stream_pos: None,
            eof_feed: None,
            xf,
            history,
            retired: Vec::with_capacity(8),
            wraps: 0,
        }
    }

    fn retire(&mut self, r: Option<Arc<Region>>) {
        if let Some(r) = r {
            if self.retired.len() < self.retired.capacity() {
                self.retired.push(r);
            }
        }
    }

    pub fn set_loop(&mut self, ab: Option<(u64, u64)>, id: u64) {
        self.lp = ab.map(|(a, b)| Loop { a, b, id });
        self.region_failed = false;
        self.wraps = 0;
        if self.loop_region.as_ref().is_some_and(|r| r.loop_id != id) {
            let r = self.loop_region.take();
            self.retire(r);
        }
    }

    pub fn offer_region(&mut self, r: Arc<Region>) {
        if self.lp.is_some_and(|l| l.id == r.loop_id) {
            let old = self.loop_region.replace(r);
            self.retire(old);
        } else {
            self.retire(Some(r));
        }
    }

    pub fn region_failed(&mut self, id: u64) {
        if self.lp.is_some_and(|l| l.id == id) {
            self.region_failed = true;
        }
    }

    fn ready_region(&self) -> Option<&Arc<Region>> {
        let lp = self.lp?;
        self.loop_region.as_ref().filter(|r| r.loop_id == lp.id)
    }

    /// Frame at which reading must stop to wrap, if a loop is active.
    fn wrap_at(&self) -> Option<u64> {
        let lp = self.lp?;
        Some(self.ready_region().map_or(lp.b, |r| r.wrap_at()))
    }

    /// Repositions at `t`, with `history` frames of pre-roll before it.
    /// Returns the feed index at which frame `t` will sit.
    pub fn seek(&mut self, fifo: &mut Fifo, t: u64) -> u64 {
        fifo.clear();
        let hist = self.history.min(t);
        self.cursor = t - hist;
        self.pending_wrap = false;
        self.tail_got = 0;
        self.eof_feed = None;
        if let Some(r) = self.loop_region.as_ref().filter(|r| r.covers(self.cursor)) {
            let r = r.clone();
            let old = self.read_region.replace(r);
            self.retire(old);
            self.in_region = true;
        } else {
            self.in_region = self
                .read_region
                .as_ref()
                .is_some_and(|r| r.covers(self.cursor));
        }
        fifo.end + hist
    }

    /// Housekeeping each callback: drain stale stream data and pre-request
    /// the stream at the end of the RAM region we are playing from.
    pub fn maintain(&mut self) {
        if self.in_region {
            if let Some(r) = self.read_region.as_ref().filter(|r| !r.eof) {
                let end = r.end;
                if self.stream_pos != Some(end) {
                    self.feed.request(end);
                    self.stream_pos = Some(end);
                }
            }
        }
        self.feed.available();
    }

    /// Reads source frames into `dst` without applying loops.
    fn read_into(&mut self, dst: &mut [f32]) -> Read {
        let want = dst.len() / self.ch;
        loop {
            if self.in_region {
                let r = self
                    .read_region
                    .as_ref()
                    .expect("in_region implies a region");
                if r.covers(self.cursor) {
                    let k = want.min((r.end - self.cursor) as usize);
                    dst[..k * self.ch].copy_from_slice(r.frames(self.cursor, k));
                    self.cursor += k as u64;
                    return Read::Frames(k);
                }
                if r.eof && self.cursor >= r.end {
                    return Read::Eof;
                }
                self.in_region = false;
                let old = self.read_region.take();
                self.retire(old);
                continue;
            }
            if self.stream_pos != Some(self.cursor) {
                self.feed.request(self.cursor);
                self.stream_pos = Some(self.cursor);
            }
            let k = self.feed.read(&mut dst[..want * self.ch]);
            if k > 0 {
                self.cursor += k as u64;
                self.stream_pos = Some(self.cursor);
                return Read::Frames(k);
            }
            return if self.feed.ended() {
                Read::Eof
            } else {
                Read::Starved
            };
        }
    }

    /// Makes feed indices `< upto` available in `fifo`. False if starved.
    pub fn fill(&mut self, fifo: &mut Fifo, upto: u64) -> bool {
        while fifo.end < upto {
            if self.pending_wrap {
                if !self.try_wrap(fifo) {
                    return false;
                }
                continue;
            }
            let want = (upto - fifo.end) as usize;
            let wrap = self.wrap_at().filter(|&b| self.cursor < b);
            let limit = wrap.map_or(usize::MAX, |b| (b - self.cursor) as usize);
            let start = self.cursor;
            let dst = fifo.write_slice(want.min(limit));
            match self.read_into(dst) {
                Read::Frames(k) => {
                    fifo.commit(k, start);
                    if wrap == Some(self.cursor) {
                        self.arm_wrap();
                    }
                }
                Read::Starved => return false,
                Read::Eof => {
                    let inside = self.lp.is_some_and(|l| start > l.a && start < l.b);
                    if inside && self.eof_feed.is_none() {
                        self.arm_wrap(); // B lies past the real end: wrap at EOF
                        continue;
                    }
                    self.eof_feed.get_or_insert(fifo.end);
                    fifo.push_silence(want, start);
                }
            }
        }
        true
    }

    fn arm_wrap(&mut self) {
        self.pending_wrap = true;
        self.pending_id = self.lp.map_or(0, |l| l.id);
    }

    /// Splices from the current position (B) to A. False while waiting for
    /// the loop region or for crossfade tail frames.
    fn try_wrap(&mut self, fifo: &mut Fifo) -> bool {
        let Some(lp) = self.lp.filter(|l| l.id == self.pending_id) else {
            return self.abandon_wrap(fifo); // loop changed or cleared while waiting
        };
        let Some(r) = self.ready_region().cloned() else {
            if self.region_failed {
                // No RAM region: plain stream re-seek (may leave a short gap).
                self.abandon_wrap(fifo);
                self.cursor = lp.a;
                self.in_region = false;
                self.wraps += 1;
                return true;
            }
            return false;
        };
        let xf = self
            .xf
            .min(((lp.b - lp.a) / 2) as usize)
            .min((r.end.saturating_sub(lp.a)) as usize);
        let ch = self.ch;
        while self.tail_got < xf {
            let mut tail = std::mem::take(&mut self.tail);
            let res = self.read_into(&mut tail[self.tail_got * ch..xf * ch]);
            self.tail = tail;
            match res {
                Read::Frames(k) => self.tail_got += k,
                Read::Starved => return false,
                Read::Eof => {
                    self.tail[self.tail_got * ch..xf * ch].fill(0.0);
                    self.tail_got = xf;
                }
            }
        }
        let head = r.frames(lp.a, xf);
        for i in 0..xf {
            let t = (i as f32 + 0.5) / xf as f32 * FRAC_PI_2;
            let (fade_out, fade_in) = (t.cos(), t.sin());
            for c in 0..ch {
                let j = i * ch + c;
                self.tail[j] = self.tail[j] * fade_out + head[j] * fade_in;
            }
        }
        fifo.push(&self.tail[..xf * ch], lp.a);
        self.tail_got = 0;
        self.pending_wrap = false;
        self.cursor = lp.a + xf as u64;
        let old = self.read_region.replace(r);
        self.retire(old);
        self.in_region = true;
        self.wraps += 1;
        true
    }

    /// Gives up a pending wrap, keeping any tail frames already read.
    fn abandon_wrap(&mut self, fifo: &mut Fifo) -> bool {
        if self.tail_got > 0 {
            let start = self.cursor - self.tail_got as u64;
            fifo.push(&self.tail[..self.tail_got * self.ch], start);
            self.tail_got = 0;
        }
        self.pending_wrap = false;
        true
    }
}
