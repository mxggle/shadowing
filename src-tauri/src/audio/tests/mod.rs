//! Device-free tests. Most use a "ramp" WAV: channel 0 = i/N, channel 1 = 0.5,
//! so every output frame reveals which source frame it came from
//! (`2·ch0/ch1·N/2`), independent of fades and volume.

mod decode;
mod device;
mod engine;
mod record;
mod timing;

use super::decode::Decoder;
use super::engine::{Cmd, Engine, Shared, Trash};
use super::feed::{DirectFeed, Feed};
use super::region::{self, Spec};
use super::session::Session;
use rtrb::{Consumer, Producer};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const SR: u32 = 48_000;
/// Index decoding is exact to f32 precision (~0.02 frames for multi-second ramps).
pub const TOL: f64 = 0.05;

pub fn write_wav(path: &Path, sr: u32, frames: usize, f: impl Fn(usize) -> [f32; 2]) {
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: sr,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut w = hound::WavWriter::create(path, spec).unwrap();
    for i in 0..frames {
        let [l, r] = f(i);
        w.write_sample(l).unwrap();
        w.write_sample(r).unwrap();
    }
    w.finalize().unwrap();
}

pub fn ramp_value(i: usize, n: usize) -> f32 {
    i as f32 / n as f32
}

/// `secs` of ramp audio at `sr`; returns (path, frame count).
pub fn ramp_wav(dir: &Path, sr: u32, secs: f64) -> (PathBuf, usize) {
    let n = (sr as f64 * secs) as usize;
    let path = dir.join(format!("ramp{sr}.wav"));
    write_wav(&path, sr, n, |i| [ramp_value(i, n), 0.5]);
    (path, n)
}

/// Source frame encoded in an output frame (fractional during crossfades).
pub fn index_of(frame: &[f32], n: usize) -> f64 {
    frame[0] as f64 / frame[1] as f64 * 0.5 * n as f64
}

pub struct Rig {
    pub engine: Engine,
    pub tx: Producer<Cmd>,
    _trash: Consumer<Trash>,
    pub shared: Arc<Shared>,
    pub path: PathBuf,
    pub sr: u32,
}

impl Rig {
    /// Engine with a synchronous decoder feed, loaded and playing from `start` (frames).
    pub fn new(path: &Path, dev_sr: u32, rate: f64, start: u64) -> Self {
        let dec = Decoder::open(path).unwrap();
        Self::with_feed(
            path,
            dec.sample_rate,
            dec.channels,
            dec.frames.unwrap(),
            Box::new(DirectFeed::new(dec)),
            dev_sr,
            rate,
            start,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn with_feed(
        path: &Path,
        sr: u32,
        ch: usize,
        total: u64,
        feed: Box<dyn Feed>,
        dev_sr: u32,
        rate: f64,
        start: u64,
    ) -> Self {
        let (engine, mut tx, trash, shared) = Engine::with_queues(dev_sr);
        let session = Session::new(1, feed, sr, ch, total, dev_sr, rate);
        assert!(tx.push(Cmd::Rate(rate)).is_ok());
        assert!(tx.push(Cmd::Load(Box::new(session), start, true)).is_ok());
        Self {
            engine,
            tx,
            _trash: trash,
            shared,
            path: path.to_path_buf(),
            sr,
        }
    }

    pub fn send(&mut self, cmd: Cmd) {
        assert!(self.tx.push(cmd).is_ok());
    }

    /// Sets loop [a, b) (frames) and delivers its RAM region synchronously.
    pub fn set_loop(&mut self, a: u64, b: u64, id: u64) {
        self.send(Cmd::Loop(Some((a, b)), id));
        let mut dec = Decoder::open(&self.path).unwrap();
        let spec = Spec {
            loop_id: id,
            a,
            b,
            history: super::session::history_frames(self.sr),
            xf: (self.sr as f64 * super::session::XF_SECS).round() as u64,
            cap: self.sr as u64 * 60,
        };
        let r = region::build(&mut dec, &spec, &|| false).unwrap();
        self.send(Cmd::Region(Arc::new(r)));
    }

    /// Renders `frames` stereo device frames in blocks; returns samples and
    /// the reported time after each block (= time of the block's next frame).
    pub fn render(&mut self, frames: usize, block: usize) -> (Vec<f32>, Vec<(usize, f64)>) {
        let mut out = vec![0.0f32; frames * 2];
        let mut times = Vec::new();
        let mut done = 0;
        while done < frames {
            let k = block.min(frames - done);
            self.engine.render(&mut out[done * 2..(done + k) * 2], 2, 0);
            done += k;
            times.push((done, self.shared.time()));
        }
        (out, times)
    }
}
