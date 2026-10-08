//! Per-track playback state: everything sized by the track's sample rate and
//! channel count (reader, history fifo, stretcher, resampler, buffers). Built
//! on the control thread, then moved into the engine by `Cmd::Load`.

use super::feed::Feed;
use super::fifo::Fifo;
use super::reader::Reader;
use super::resample::Resampler;
use super::stretch::{Input, Stage};

/// Loop splice crossfade.
pub const XF_SECS: f64 = 0.005;
/// Source pre-roll kept before a seek target / loop start (stretcher needs ~0.21 s).
const HISTORY_SECS: f64 = 0.3;

pub fn history_frames(sr: u32) -> u64 {
    (sr as f64 * HISTORY_SECS) as u64
}
const MAX_CHUNK: usize = 2048;
const FIFO_SECS: f64 = 1.5;

pub struct Session {
    pub(super) id: u64,
    pub(super) sr: u32,
    pub(super) ch: usize,
    pub(super) total: u64,
    pub(super) dev_sr: u32,
    pub(super) reader: Reader,
    pub(super) fifo: Fifo,
    pub(super) stage: Stage,
    pub(super) rs: Resampler,
    pub(super) chunk: Vec<f32>,
    pub(super) dev: Vec<f32>,
    pub(super) dev_len: usize,
    pub(super) dev_off: usize,
    pub(super) seek_target: Option<u64>,
    pub(super) ended: bool,
}

struct Src<'a> {
    reader: &'a mut Reader,
    fifo: &'a mut Fifo,
}

impl Input for Src<'_> {
    fn ensure(&mut self, upto: u64) -> bool {
        self.reader.fill(self.fifo, upto)
    }
    fn fifo(&self) -> &Fifo {
        self.fifo
    }
}

impl Session {
    /// Allocates everything up front (call off the audio thread).
    pub fn new(
        id: u64,
        feed: Box<dyn Feed>,
        sr: u32,
        ch: usize,
        total: u64,
        dev_sr: u32,
        rate: f64,
    ) -> Self {
        let stage = Stage::new(ch, sr, MAX_CHUNK, rate);
        let xf = (sr as f64 * XF_SECS).round() as usize;
        let history = history_frames(sr);
        debug_assert!(history >= stage.preroll());
        let mut s = Self {
            id,
            sr,
            ch,
            total,
            dev_sr,
            reader: Reader::new(feed, ch, xf, history),
            fifo: Fifo::new(ch, (sr as f64 * FIFO_SECS) as usize),
            stage,
            rs: Resampler::Pass,
            chunk: Vec::new(),
            dev: Vec::new(),
            dev_len: 0,
            dev_off: 0,
            seek_target: None,
            ended: false,
        };
        s.set_dev_rate(dev_sr);
        s
    }

    pub(super) fn set_dev_rate(&mut self, dev_sr: u32) {
        self.dev_sr = dev_sr;
        self.rs = Resampler::new(self.sr, dev_sr, self.ch);
        self.chunk = vec![0.0; self.rs.chunk_in().min(MAX_CHUNK) * self.ch];
        self.dev = vec![0.0; (self.rs.chunk_out() + 16) * self.ch];
        self.dev_len = 0;
        self.dev_off = 0;
    }

    pub(super) fn seek(&mut self, t: u64) {
        let h = self.reader.seek(&mut self.fifo, t);
        self.stage.reset_at(h);
        self.rs.reset();
        self.dev_len = 0;
        self.dev_off = 0;
        self.seek_target = Some(t);
        self.ended = false;
    }

    pub(super) fn produce(&mut self) -> bool {
        let mut input = Src {
            reader: &mut self.reader,
            fifo: &mut self.fifo,
        };
        if !self.stage.produce(&mut input, &mut self.chunk) {
            return false;
        }
        self.dev_len = self.rs.process(&self.chunk, &mut self.dev);
        self.dev_off = 0;
        self.seek_target = None;
        true
    }

    /// (feed index, source frame) of what is audible `device_pending` frames from now.
    pub(super) fn heard(&self, device_pending: usize) -> (f64, Option<u64>) {
        let dev_frames = self.rs.delay() + (self.dev_len - self.dev_off) / self.ch + device_pending;
        let downstream = dev_frames as f64 * self.sr as f64 / self.dev_sr.max(1) as f64;
        let idx = self.stage.heard_index(downstream);
        if let Some(t) = self.seek_target {
            return (idx, Some(t));
        }
        (idx, self.fifo.pos_at(idx.max(0.0) as u64))
    }
}
