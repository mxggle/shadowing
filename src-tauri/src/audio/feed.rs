//! Source frames for the engine. `RingFeed` is the production path: a decoder
//! thread streams frames into a lock-free ring the audio callback reads from.
//! `DirectFeed` decodes synchronously on the caller's thread (tests, offline).

use super::decode::Decoder;
use rtrb::{Consumer, Producer, RingBuffer};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

pub trait Feed: Send {
    /// Restart delivery at source frame `pos` (asynchronous for `RingFeed`).
    fn request(&mut self, pos: u64);
    /// Frames of the current request readable right now.
    fn available(&mut self) -> usize;
    /// Reads up to `dst.len() / ch` frames; returns frames read.
    fn read(&mut self, dst: &mut [f32]) -> usize;
    /// The current request reached end of stream and everything was read.
    fn ended(&mut self) -> bool;
}

#[cfg(test)]
pub struct DirectFeed {
    dec: Decoder,
    eof: bool,
}

#[cfg(test)]
impl DirectFeed {
    pub fn new(dec: Decoder) -> Self {
        Self { dec, eof: false }
    }
}

#[cfg(test)]
impl Feed for DirectFeed {
    fn request(&mut self, pos: u64) {
        self.eof = self.dec.seek(pos).is_err();
    }
    fn available(&mut self) -> usize {
        if self.eof {
            0
        } else {
            usize::MAX / 4
        }
    }
    fn read(&mut self, dst: &mut [f32]) -> usize {
        if self.eof {
            return 0;
        }
        let want = dst.len() / self.dec.channels;
        let n = self.dec.read(dst).unwrap_or(0);
        if n < want {
            self.eof = true;
        }
        n
    }
    fn ended(&mut self) -> bool {
        self.eof
    }
}

/// Marks in the sample stream: `at` is the cumulative sample count at which
/// the marker takes effect. Pushed *before* the samples it describes.
#[derive(Clone, Copy)]
enum Marker {
    Start { gen: u64, at: u64 },
    End { gen: u64, at: u64 },
}

impl Marker {
    fn at(&self) -> u64 {
        match *self {
            Marker::Start { at, .. } | Marker::End { at, .. } => at,
        }
    }
}

const RING_SECS: usize = 2;
const IDLE_SLEEP: Duration = Duration::from_millis(4);

pub struct RingFeed {
    req: Producer<(u64, u64)>,
    samples: Consumer<f32>,
    markers: Consumer<Marker>,
    ch: usize,
    popped: u64,
    want_gen: u64,
    head_gen: u64,
    head_end: bool,
    unsent: Option<u64>,
}

pub type ErrorFn = Arc<dyn Fn(String) + Send + Sync>;

impl RingFeed {
    /// Moves `dec` to a new decoder thread. The thread exits when the feed is dropped.
    pub fn spawn(dec: Decoder, on_error: ErrorFn) -> Self {
        let ch = dec.channels;
        let (req, req_rx) = RingBuffer::new(16);
        let (sample_tx, samples) = RingBuffer::new(RING_SECS * dec.sample_rate as usize * ch);
        let (marker_tx, markers) = RingBuffer::new(64);
        let _ = thread::Builder::new()
            .name("audio-decode".into())
            .spawn(move || produce(dec, req_rx, sample_tx, marker_tx, on_error));
        Self {
            req,
            samples,
            markers,
            ch,
            popped: 0,
            want_gen: 0,
            head_gen: 0,
            head_end: false,
            unsent: None,
        }
    }

    /// Applies due markers and throws away samples of superseded requests.
    fn sync(&mut self) {
        if let Some(pos) = self.unsent.take() {
            self.send(pos);
        }
        loop {
            let slots = self.samples.slots(); // read before markers (see Marker)
            while let Ok(m) = self.markers.peek() {
                if m.at() > self.popped {
                    break;
                }
                match *m {
                    Marker::Start { gen, .. } => (self.head_gen, self.head_end) = (gen, false),
                    Marker::End { gen, .. } => self.head_end |= gen == self.head_gen,
                }
                let _ = self.markers.pop();
            }
            if self.head_gen == self.want_gen {
                return;
            }
            let n = self.bounded(slots);
            if n == 0 {
                return;
            }
            if let Ok(chunk) = self.samples.read_chunk(n) {
                chunk.commit_all();
            }
            self.popped += n as u64;
        }
    }

    /// Samples readable before the next marker.
    fn bounded(&self, slots: usize) -> usize {
        match self.markers.peek() {
            Ok(m) => slots.min((m.at() - self.popped) as usize),
            Err(_) => slots,
        }
    }

    fn send(&mut self, pos: u64) {
        if self.req.push((self.want_gen, pos)).is_err() {
            self.unsent = Some(pos);
        }
    }
}

impl Feed for RingFeed {
    fn request(&mut self, pos: u64) {
        self.want_gen += 1;
        self.send(pos);
    }
    fn available(&mut self) -> usize {
        self.sync();
        if self.head_gen != self.want_gen {
            return 0;
        }
        let slots = self.samples.slots();
        self.bounded(slots) / self.ch
    }
    fn read(&mut self, dst: &mut [f32]) -> usize {
        let n = self.available().min(dst.len() / self.ch);
        if n == 0 {
            return 0;
        }
        if let Ok(chunk) = self.samples.read_chunk(n * self.ch) {
            let (a, b) = chunk.as_slices();
            dst[..a.len()].copy_from_slice(a);
            dst[a.len()..a.len() + b.len()].copy_from_slice(b);
            chunk.commit_all();
        }
        self.popped += (n * self.ch) as u64;
        n
    }
    fn ended(&mut self) -> bool {
        self.available() == 0 && self.head_gen == self.want_gen && self.head_end
    }
}

fn produce(
    mut dec: Decoder,
    mut req: Consumer<(u64, u64)>,
    mut samples: Producer<f32>,
    mut markers: Producer<Marker>,
    on_error: ErrorFn,
) {
    let ch = dec.channels;
    let mut buf = vec![0.0f32; 4096 * ch];
    let mut pushed: u64 = 0;
    let mut gen = 0;
    let mut streaming = false;
    let push_marker = |markers: &mut Producer<Marker>, m: Marker, req: &Consumer<(u64, u64)>| {
        while markers.push(m).is_err() {
            if req.is_abandoned() {
                return;
            }
            thread::sleep(IDLE_SLEEP);
        }
    };
    loop {
        if req.is_abandoned() {
            return;
        }
        let mut latest = None;
        while let Ok(r) = req.pop() {
            latest = Some(r);
        }
        if let Some((g, pos)) = latest {
            gen = g;
            push_marker(&mut markers, Marker::Start { gen, at: pushed }, &req);
            streaming = match dec.seek(pos) {
                Ok(()) => true,
                Err(e) => {
                    on_error(e);
                    push_marker(&mut markers, Marker::End { gen, at: pushed }, &req);
                    false
                }
            };
        }
        if !streaming {
            thread::sleep(IDLE_SLEEP);
            continue;
        }
        let n = match dec.read(&mut buf) {
            Ok(n) => n,
            Err(e) => {
                on_error(e);
                0
            }
        };
        if n == 0 {
            push_marker(&mut markers, Marker::End { gen, at: pushed }, &req);
            streaming = false;
            continue;
        }
        let mut off = 0;
        while off < n * ch {
            let k = (samples.slots().min(n * ch - off) / ch) * ch;
            if k == 0 {
                if req.slots() > 0 || req.is_abandoned() {
                    break; // a newer request wins; drop the rest of this block
                }
                thread::sleep(IDLE_SLEEP);
                continue;
            }
            let _ = samples.push_entire_slice(&buf[off..off + k]);
            pushed += k as u64;
            off += k;
        }
    }
}
