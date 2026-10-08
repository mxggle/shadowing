//! A–B loop regions decoded into RAM so every loop wrap splices from memory
//! instead of waiting for a decoder seek. A region covers
//! `[A − history, min(B + crossfade, A + cap))`; loops longer than the cap
//! play the head from RAM while the stream re-seeks behind it.

use super::decode::Decoder;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread;

pub struct Region {
    pub loop_id: u64,
    pub b: u64,
    pub start: u64,
    pub end: u64,
    /// Decoding hit end of file before `B + crossfade`.
    pub eof: bool,
    pub ch: usize,
    pub data: Vec<f32>,
}

impl Region {
    pub fn covers(&self, pos: u64) -> bool {
        pos >= self.start && pos < self.end
    }

    /// Interleaved frames `[from, from + n)`; caller ensures they are covered.
    pub fn frames(&self, from: u64, n: usize) -> &[f32] {
        let i = (from - self.start) as usize * self.ch;
        &self.data[i..i + n * self.ch]
    }

    /// Where the loop actually wraps: B, or the true end of file if B lies beyond it.
    pub fn wrap_at(&self) -> u64 {
        if self.eof {
            self.b.min(self.end)
        } else {
            self.b
        }
    }
}

pub struct Spec {
    pub loop_id: u64,
    pub a: u64,
    pub b: u64,
    pub history: u64,
    pub xf: u64,
    pub cap: u64,
}

/// Decodes a region. `cancelled` is polled so superseded loops stop early.
pub fn build(dec: &mut Decoder, s: &Spec, cancelled: &dyn Fn() -> bool) -> Result<Region, String> {
    let ch = dec.channels;
    let start = s.a.saturating_sub(s.history);
    let target = (s.b + s.xf).min(s.a + s.cap).max(s.a + 1);
    dec.seek(start)?;
    let total = (target - start) as usize;
    let mut data = vec![0.0f32; total * ch];
    let mut done = 0;
    while done < total {
        if cancelled() {
            return Err("cancelled".into());
        }
        let k = (total - done).min(16384);
        let n = dec.read(&mut data[done * ch..(done + k) * ch])?;
        done += n;
        if n < k {
            break;
        }
    }
    data.truncate(done * ch);
    Ok(Region {
        loop_id: s.loop_id,
        b: s.b,
        start,
        end: start + done as u64,
        eof: done < total,
        ch,
        data,
    })
}

pub struct Job {
    pub session: u64,
    pub path: PathBuf,
    pub spec: Spec,
}

pub enum Outcome {
    Ready(Arc<Region>),
    Failed(u64),
}

/// Background loader. Keeps one decoder per session so repeated loop edits
/// skip re-probing. `latest` holds the newest loop id; older jobs are dropped.
pub fn spawn_loader(
    latest: Arc<AtomicU64>,
    deliver: impl Fn(Outcome) + Send + 'static,
) -> Sender<Job> {
    let (tx, rx) = mpsc::channel::<Job>();
    let _ = thread::Builder::new()
        .name("audio-loop-loader".into())
        .spawn(move || loader(rx, latest, deliver));
    tx
}

fn loader(rx: Receiver<Job>, latest: Arc<AtomicU64>, deliver: impl Fn(Outcome)) {
    let mut cached: Option<(u64, Decoder)> = None;
    while let Ok(mut job) = rx.recv() {
        while let Ok(newer) = rx.try_recv() {
            job = newer;
        }
        let id = job.spec.loop_id;
        if latest.load(Ordering::Acquire) != id {
            continue;
        }
        if cached.as_ref().is_none_or(|(s, _)| *s != job.session) {
            cached = Decoder::open(&job.path).ok().map(|d| (job.session, d));
        }
        let Some((_, dec)) = cached.as_mut() else {
            deliver(Outcome::Failed(id));
            continue;
        };
        let cancelled = || latest.load(Ordering::Acquire) != id;
        match build(dec, &job.spec, &cancelled) {
            Ok(r) if !cancelled() => deliver(Outcome::Ready(Arc::new(r))),
            Ok(_) => {}
            Err(_) if cancelled() => {}
            Err(_) => {
                cached = None;
                deliver(Outcome::Failed(id));
            }
        }
    }
}
