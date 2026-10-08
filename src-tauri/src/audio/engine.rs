//! Real-time core, run inside the audio callback (or a test loop): applies
//! queued commands, pulls source frames through loop/stretch/resample stages
//! and writes device frames. Lock-free and allocation-free in steady state;
//! anything it drops is handed to the `Trash` queue and freed elsewhere.

use super::region::Region;
use super::session::Session;
use rtrb::{Consumer, Producer};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering::Relaxed};
use std::sync::Arc;

/// Fade used for play/pause/seek so cuts never click.
const FADE_SECS: f32 = 0.004;
const VOLUME_RAMP_SECS: f32 = 0.02;

pub const CMD_QUEUE: usize = 256;
pub const TRASH_QUEUE: usize = 64;
pub const EV_CHANGED: u32 = 1;
pub const EV_ENDED: u32 = 2;

pub enum Cmd {
    Load(Box<Session>, u64, bool),
    Unload,
    Play,
    Pause,
    Toggle,
    Seek(u64),
    Rate(f64),
    Volume(f32),
    Loop(Option<(u64, u64)>, u64),
    Region(Arc<Region>),
    RegionFailed(u64),
}

pub enum Trash {
    Session(#[allow(dead_code)] Box<Session>),
    Region(#[allow(dead_code)] Arc<Region>),
}

/// State the engine publishes for other threads.
#[derive(Default)]
pub struct Shared {
    time: AtomicU64,
    playing: AtomicBool,
    pub session: AtomicU64,
    pub applied: AtomicU64,
    events: AtomicU32,
    repeats: AtomicU32,
    /// Producing sound (playing or fading); the output thread may idle otherwise.
    pub audible: AtomicBool,
    pub dev_rate: AtomicU32,
}

impl Shared {
    pub fn time(&self) -> f64 {
        f64::from_bits(self.time.load(Relaxed))
    }
    pub fn playing(&self) -> bool {
        self.playing.load(Relaxed)
    }
    /// Passes completed by the current A–B loop.
    pub fn repeats(&self) -> u32 {
        self.repeats.load(Relaxed)
    }
    pub fn take_events(&self) -> u32 {
        self.events.swap(0, Relaxed)
    }
}

pub struct Engine {
    cmds: Consumer<Cmd>,
    trash: Producer<Trash>,
    shared: Arc<Shared>,
    session: Option<Box<Session>>,
    dev_sr: u32,
    playing: bool,
    fade: f32,
    fade_target: f32,
    pending_seek: Option<u64>,
    pending_pause: bool,
    vol: f32,
    vol_target: f32,
    rate: f64,
    last_time: f64,
}

impl Engine {
    pub fn new(
        cmds: Consumer<Cmd>,
        trash: Producer<Trash>,
        shared: Arc<Shared>,
        dev_sr: u32,
    ) -> Self {
        shared.dev_rate.store(dev_sr, Relaxed);
        Self {
            cmds,
            trash,
            shared,
            session: None,
            dev_sr,
            playing: false,
            fade: 0.0,
            fade_target: 0.0,
            pending_seek: None,
            pending_pause: false,
            vol: 1.0,
            vol_target: 1.0,
            rate: 1.0,
            last_time: 0.0,
        }
    }

    /// Engine plus its queues, for tests and offline rendering.
    #[cfg(test)]
    pub fn with_queues(dev_sr: u32) -> (Self, Producer<Cmd>, Consumer<Trash>, Arc<Shared>) {
        let (tx, rx) = rtrb::RingBuffer::new(CMD_QUEUE);
        let (trash_tx, trash_rx) = rtrb::RingBuffer::new(TRASH_QUEUE);
        let shared = Arc::new(Shared::default());
        (
            Self::new(rx, trash_tx, shared.clone(), dev_sr),
            tx,
            trash_rx,
            shared,
        )
    }

    /// New device format (called with the stream stopped).
    pub fn set_output(&mut self, dev_sr: u32) {
        if dev_sr == self.dev_sr {
            return;
        }
        self.dev_sr = dev_sr;
        self.shared.dev_rate.store(dev_sr, Relaxed);
        if let Some(s) = self.session.as_mut() {
            s.set_dev_rate(dev_sr);
        }
    }

    fn bin(&mut self, t: Trash) {
        let _ = self.trash.push(t); // full queue: dropped here (rare)
    }

    fn apply_commands(&mut self) {
        while let Ok(cmd) = self.cmds.pop() {
            self.apply(cmd);
            self.shared.applied.fetch_add(1, Relaxed);
        }
    }

    fn apply(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Load(mut s, start, autoplay) => {
                if let Some(old) = self.session.take() {
                    self.bin(Trash::Session(old));
                }
                if s.dev_sr != self.dev_sr {
                    s.set_dev_rate(self.dev_sr);
                }
                s.stage.set_rate(self.rate);
                s.seek(start.min(s.total.saturating_sub(1)));
                self.shared.session.store(s.id, Relaxed);
                self.shared.events.store(0, Relaxed);
                self.last_time = start as f64 / s.sr as f64;
                self.session = Some(s);
                self.playing = autoplay;
                self.fade = 0.0;
                self.fade_target = if autoplay { 1.0 } else { 0.0 };
                self.pending_seek = None;
                self.pending_pause = false;
            }
            Cmd::Unload => {
                self.shared.events.store(0, Relaxed);
                if let Some(old) = self.session.take() {
                    self.bin(Trash::Session(old));
                }
                self.playing = false;
                self.fade = 0.0;
            }
            Cmd::Play => self.play(),
            Cmd::Pause => self.pause(),
            Cmd::Toggle => {
                if self.playing && !self.pending_pause {
                    self.pause()
                } else {
                    self.play()
                }
            }
            Cmd::Seek(t) => {
                let Some(s) = self.session.as_mut() else {
                    return;
                };
                let t = t.min(s.total.saturating_sub(1));
                s.ended = false;
                if self.playing && self.fade > 0.0 {
                    self.pending_seek = Some(t);
                    self.fade_target = 0.0;
                } else {
                    s.seek(t);
                }
            }
            Cmd::Rate(r) => {
                self.rate = r;
                if let Some(s) = self.session.as_mut() {
                    s.stage.set_rate(r);
                }
            }
            Cmd::Volume(v) => self.vol_target = v.clamp(0.0, 1.0),
            Cmd::Loop(ab, id) => {
                if let Some(s) = self.session.as_mut() {
                    s.reader.set_loop(ab, id);
                }
            }
            Cmd::Region(r) => match self.session.as_mut() {
                Some(s) => s.reader.offer_region(r),
                None => self.bin(Trash::Region(r)),
            },
            Cmd::RegionFailed(id) => {
                if let Some(s) = self.session.as_mut() {
                    s.reader.region_failed(id);
                }
            }
        }
    }

    fn play(&mut self) {
        let Some(s) = self.session.as_mut() else {
            return;
        };
        if s.ended {
            s.seek(0);
        }
        self.playing = true;
        self.pending_pause = false;
        if self.pending_seek.is_none() {
            self.fade_target = 1.0;
        }
    }

    fn pause(&mut self) {
        if !self.playing {
            return;
        }
        if self.fade > 0.0 {
            self.pending_pause = true;
            self.fade_target = 0.0;
        } else {
            self.playing = false;
        }
    }

    /// Fade-out finished: perform the deferred seek and/or pause.
    fn finish_fade(&mut self) {
        if let (Some(t), Some(s)) = (self.pending_seek.take(), self.session.as_mut()) {
            s.seek(t);
        }
        if self.pending_pause {
            self.pending_pause = false;
            self.playing = false;
        } else if self.playing {
            self.fade_target = 1.0;
        }
    }

    /// Renders `out` (interleaved, `dev_ch` channels). `device_pending` is how
    /// many frames the device still has queued before `out` will be heard.
    pub fn render(&mut self, out: &mut [f32], dev_ch: usize, device_pending: usize) {
        self.apply_commands();
        if let Some(s) = self.session.as_mut() {
            s.reader.maintain();
        }
        let frames = out.len() / dev_ch;
        let fade_step = 1.0 / (FADE_SECS * self.dev_sr as f32);
        let vol_step = 1.0 / (VOLUME_RAMP_SECS * self.dev_sr as f32);
        let mut i = 0;
        while i < frames {
            let Some(s) = self.session.as_deref_mut() else {
                break;
            };
            if !self.playing && self.fade <= 0.0 {
                break;
            }
            if s.dev_off >= s.dev_len && !s.produce() {
                if self.fade_target <= 0.0 && (self.pending_seek.is_some() || self.pending_pause) {
                    // Nothing left to fade out: apply the deferred seek/pause now.
                    self.fade = 0.0;
                    self.finish_fade();
                    continue;
                }
                break; // starved: decoder has not caught up yet
            }
            let ch = s.ch;
            let k = ((s.dev_len - s.dev_off) / ch).min(frames - i);
            let mut used = 0;
            let mut faded_out = false;
            while used < k {
                self.fade = step(self.fade, self.fade_target, fade_step);
                self.vol = step(self.vol, self.vol_target, vol_step);
                let src = &s.dev[s.dev_off + used * ch..][..ch];
                let dst = &mut out[(i + used) * dev_ch..(i + used + 1) * dev_ch];
                map_channels(src, dst, self.fade * self.vol);
                used += 1;
                if self.fade <= 0.0 && self.fade_target <= 0.0 {
                    faded_out = true;
                    break;
                }
            }
            s.dev_off += used * ch;
            i += used;
            if faded_out {
                self.finish_fade();
            }
        }
        out[i * dev_ch..].fill(0.0);
        self.publish(if i > 0 { device_pending } else { 0 });
    }

    fn publish(&mut self, device_pending: usize) {
        let Some(s) = self.session.as_deref_mut() else {
            self.shared.repeats.store(0, Relaxed);
            self.shared.playing.store(false, Relaxed);
            self.shared.audible.store(false, Relaxed);
            return;
        };
        for r in s.reader.retired.drain(..) {
            let _ = self.trash.push(Trash::Region(r));
        }
        let (idx, pos) = s.heard(device_pending);
        let time = pos.map_or(self.last_time, |p| p as f64 / s.sr as f64);
        let mut events = 0;
        if self.playing && s.reader.eof_feed.is_some_and(|e| idx >= e as f64) {
            s.ended = true;
            self.playing = false;
            self.fade = 0.0;
            self.fade_target = 0.0;
            events |= EV_ENDED | EV_CHANGED;
        }
        if self.playing && time + 0.05 < self.last_time {
            events |= EV_CHANGED; // loop wrap became audible
        }
        self.last_time = time;
        self.shared.time.store(time.to_bits(), Relaxed);
        self.shared.repeats.store(s.reader.wraps, Relaxed);
        self.shared
            .playing
            .store(self.playing && !self.pending_pause, Relaxed);
        self.shared
            .audible
            .store(self.playing || self.fade > 0.0, Relaxed);
        if events != 0 {
            self.shared.events.fetch_or(events, Relaxed);
        }
    }
}

fn step(v: f32, target: f32, step: f32) -> f32 {
    if v < target {
        (v + step).min(target)
    } else if v > target {
        (v - step).max(target)
    } else {
        v
    }
}

/// Engine channels (1 or 2) → device channels; extra device channels get silence.
fn map_channels(src: &[f32], dst: &mut [f32], g: f32) {
    match (src.len(), dst.len()) {
        (1, 1) => dst[0] = src[0] * g,
        (1, _) => {
            dst.fill(0.0);
            dst[0] = src[0] * g;
            dst[1] = src[0] * g;
        }
        (_, 1) => dst[0] = (src[0] + src[1]) * 0.5 * g,
        _ => {
            dst.fill(0.0);
            dst[0] = src[0] * g;
            dst[1] = src[1] * g;
        }
    }
}
