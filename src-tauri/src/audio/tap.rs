//! A copy of what the engine sends to the speakers, for the recorder: echo
//! removal needs the exact samples that were played and when. Filled by the
//! output callback (lock-free, never blocks; drops a block if the reader
//! fell behind), drained by the recorder thread.

use rtrb::{Consumer, Producer, RingBuffer};

/// One block as handed to the device.
#[derive(Clone, Copy, Debug)]
pub struct Mark {
    /// Host time (ns) at which its first frame is heard.
    pub at: u64,
    pub frames: u32,
    pub rate: u32,
    /// Where in the track (seconds) its first frame is; NaN when the track wasn't
    /// playing (a take of a video is mapped back onto the picture with it).
    pub src: f64,
}

pub struct Tap {
    samples: Producer<f32>,
    marks: Producer<Mark>,
}

pub struct TapRx {
    pub samples: Consumer<f32>,
    pub marks: Consumer<Mark>,
}

/// Room for `secs` of audio at 48 kHz between drains.
pub fn tap(secs: f64) -> (Tap, TapRx) {
    let n = (secs * 48_000.0) as usize;
    let (samples, samples_rx) = RingBuffer::new(n);
    let (marks, marks_rx) = RingBuffer::new(n / 64);
    (
        Tap { samples, marks },
        TapRx {
            samples: samples_rx,
            marks: marks_rx,
        },
    )
}

impl Tap {
    /// Mono copy of `out` (interleaved, `ch` channels), heard from host time `at` on,
    /// starting at `src` seconds into the track (NaN: not the track).
    pub fn push(&mut self, out: &[f32], ch: usize, rate: u32, at: u64, src: f64) {
        let frames = out.len() / ch.max(1);
        if frames == 0 || self.samples.slots() < frames || self.marks.slots() == 0 {
            return;
        }
        let Ok(chunk) = self.samples.write_chunk_uninit(frames) else {
            return;
        };
        chunk.fill_from_iter(out.chunks(ch).map(|f| match f {
            [l, r, ..] => (l + r) * 0.5,
            [m] => *m,
            [] => 0.0,
        }));
        let _ = self.marks.push(Mark {
            at,
            frames: frames as u32,
            rate,
            src,
        });
    }
}
