//! Control side (any thread): validates requests, builds sessions off the
//! audio thread, queues commands for the engine, and runs the status thread
//! that emits `player:*` events.

use super::clip::Clip;
use super::decode::Decoder;
use super::engine::{self, Cmd, Engine, Shared};
use super::feed::RingFeed;
use super::output;
use super::region::{self, Job, Outcome, Spec};
use super::session::{self, Session};
use super::status::{self, lock, snapshot, CmdTx, Ctl, Track};
use super::tap::Tap;
use super::{EventSink, Status};
use rtrb::RingBuffer;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

const REGION_CAP_SECS: f64 = 60.0;

pub struct Player {
    cmd: Arc<CmdTx>,
    shared: Arc<Shared>,
    ctl: Arc<Mutex<Ctl>>,
    sink: Arc<dyn EventSink>,
    loop_latest: Arc<AtomicU64>,
    loader: Mutex<Sender<Job>>,
    next_session: AtomicU64,
}

impl Player {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        let (cmd_tx, cmd_rx) = RingBuffer::new(engine::CMD_QUEUE);
        let (trash_tx, trash_rx) = RingBuffer::new(engine::TRASH_QUEUE);
        let shared = Arc::new(Shared::default());
        let engine = Engine::new(cmd_rx, trash_tx, shared.clone(), output::default_rate());
        let out = output::spawn(Arc::new(Mutex::new(engine)), shared.clone(), sink.clone());
        let cmd = Arc::new(CmdTx::new(cmd_tx, out));
        let loop_latest = Arc::new(AtomicU64::new(0));
        let deliver_cmd = cmd.clone();
        let loader = region::spawn_loader(loop_latest.clone(), move |o| {
            let _ = deliver_cmd.send(match o {
                Outcome::Ready(r) => Cmd::Region(r),
                Outcome::Failed(id) => Cmd::RegionFailed(id),
            });
        });
        let player = Self {
            cmd,
            shared,
            ctl: Arc::new(Mutex::new(Ctl::default())),
            sink,
            loop_latest,
            loader: Mutex::new(loader),
            next_session: AtomicU64::new(0),
        };
        status::spawn(
            &player.cmd,
            &player.shared,
            &player.ctl,
            &player.sink,
            trash_rx,
        );
        player
    }

    pub fn status(&self) -> Status {
        snapshot(&self.cmd, &self.shared, &mut lock(&self.ctl)).0
    }

    fn emit(&self) {
        self.sink.status(&self.status());
    }

    /// `path` is echoed in events; `file` is the validated canonical path.
    pub fn load(
        &self,
        path: String,
        file: PathBuf,
        start_at: f64,
        autoplay: bool,
    ) -> Result<f64, String> {
        let dec = Decoder::open(&file)?;
        let (sr, ch) = (dec.sample_rate, dec.channels);
        let frames = dec.frames.unwrap_or(0);
        let duration = frames as f64 / sr as f64;
        let total = if frames > 0 { frames } else { u64::MAX / 4 };
        let id = self.next_session.fetch_add(1, Relaxed) + 1;
        let (sink, p) = (self.sink.clone(), path.clone());
        let feed = RingFeed::spawn(dec, Arc::new(move |msg: String| sink.error(Some(&p), &msg)));
        let start_secs = clamp_time(start_at, duration);
        let start = (start_secs * sr as f64).round() as u64;
        {
            let mut ctl = lock(&self.ctl);
            let dev_sr = self.shared.dev_rate.load(Relaxed);
            let session = Session::new(id, Box::new(feed), sr, ch, total, dev_sr, ctl.rate);
            self.loop_latest.fetch_add(1, Relaxed);
            ctl.track = Some(Track {
                id,
                path,
                file,
                sr,
                total,
                duration,
            });
            ctl.shadow_time = start_secs;
            ctl.shadow_playing = autoplay;
            ctl.held = false;
            ctl.shadow_repeats = 0;
            self.cmd
                .send(Cmd::Load(Box::new(session), start, autoplay))?;
        }
        self.emit();
        Ok(duration)
    }

    pub fn unload(&self) -> Result<(), String> {
        let mut ctl = lock(&self.ctl);
        ctl.track = None;
        ctl.held = false;
        drop(ctl);
        self.loop_latest.fetch_add(1, Relaxed);
        self.cmd.send(Cmd::Unload)?;
        self.emit();
        Ok(())
    }

    fn with_track(&self, f: impl FnOnce(&mut Ctl) -> Option<Cmd>) -> Result<(), String> {
        let cmd = {
            let mut ctl = lock(&self.ctl);
            if ctl.track.is_none() {
                return Ok(());
            }
            f(&mut ctl)
        };
        if let Some(cmd) = cmd {
            self.cmd.send(cmd)?;
            self.emit();
        }
        Ok(())
    }

    pub fn play(&self) -> Result<(), String> {
        self.with_track(|c| {
            c.shadow_playing = true;
            c.held = false;
            Some(Cmd::Play)
        })
    }

    pub fn pause(&self) -> Result<(), String> {
        self.with_track(|c| {
            c.shadow_playing = false;
            c.held = false;
            Some(Cmd::Pause)
        })
    }

    /// A recording paused: the track pauses where it is, a range (`play_range`)
    /// keeping its end, so `resume_held` plays the rest of it.
    pub fn hold(&self) -> Result<(), String> {
        self.with_track(|c| {
            c.shadow_playing = false;
            c.held = true;
            Some(Cmd::Hold(true))
        })
    }

    /// The recording goes on: the track plays on if `hold` paused it while it
    /// played and nothing has moved it since. Returns whether it does (a range
    /// that ended before the hold doesn't).
    pub fn resume_held(&self) -> Result<bool, String> {
        let mut going = false;
        self.with_track(|c| {
            going = std::mem::take(&mut c.held) && self.shared.held();
            c.shadow_playing |= going;
            Some(Cmd::Hold(false))
        })?;
        Ok(going)
    }

    pub fn toggle(&self) -> Result<(), String> {
        let playing = self.status().playing;
        self.with_track(|c| {
            c.shadow_playing = !playing;
            c.held = false;
            Some(Cmd::Toggle)
        })
    }

    pub fn seek(&self, time: f64) -> Result<(), String> {
        if !time.is_finite() {
            return Err(crate::i18n::pick("无效的时间", "Invalid time").into());
        }
        self.with_track(|c| {
            let t = c.track.as_ref()?;
            let secs = clamp_time(time, t.duration);
            let frame = ((secs * t.sr as f64).round() as u64).min(t.total.saturating_sub(1));
            c.shadow_time = secs;
            c.held = false;
            Some(Cmd::Seek(frame))
        })
    }

    pub fn set_rate(&self, rate: f64) -> Result<(), String> {
        if !rate.is_finite() {
            return Err(crate::i18n::pick("无效的速度", "Invalid speed").into());
        }
        let rate = rate.clamp(0.5, 2.0);
        lock(&self.ctl).rate = rate;
        self.cmd.send(Cmd::Rate(rate))?;
        self.emit();
        Ok(())
    }

    pub fn set_volume(&self, volume: f64) -> Result<(), String> {
        let v = if volume.is_finite() {
            volume.clamp(0.0, 1.0)
        } else {
            1.0
        };
        self.cmd.send(Cmd::Volume(v as f32))
    }

    /// Plays `a`..`b` once (ignoring any loop) and pauses at `b`.
    pub fn play_range(&self, a: f64, b: f64) -> Result<(), String> {
        if !(a.is_finite() && b.is_finite() && b > a) {
            return Err(crate::i18n::pick("无效的时间", "Invalid time").into());
        }
        self.seek(a)?;
        let stop = {
            let c = lock(&self.ctl);
            let Some(t) = c.track.as_ref() else {
                return Ok(());
            };
            ((b * t.sr as f64).round() as u64).min(t.total)
        };
        self.cmd.send(Cmd::Range(Some(stop)))?;
        self.play()
    }

    /// Starts (or with `None`, stops) copying the output for the recorder.
    pub fn set_tap(&self, tap: Option<Tap>) -> Result<(), String> {
        self.cmd.send(Cmd::Tap(tap.map(Box::new)))
    }

    /// Device rate clips must be prepared at.
    pub fn device_rate(&self) -> u32 {
        self.shared.dev_rate.load(Relaxed)
    }

    /// Plays mono `samples` (at `device_rate`) over the output, pausing the track.
    pub fn play_clip(&self, id: u64, samples: Vec<f32>, rate: u32) -> Result<(), String> {
        {
            let mut c = lock(&self.ctl);
            if c.track.is_some() {
                c.shadow_playing = false;
            }
            c.held = false;
        }
        self.cmd
            .send(Cmd::Clip(Some(Box::new(Clip::new(id, samples, rate)))))?;
        self.emit();
        Ok(())
    }

    pub fn stop_clip(&self) -> Result<(), String> {
        self.cmd.send(Cmd::Clip(None))
    }

    /// Pauses the clip playing (where it is) or lets it go on.
    pub fn hold_clip(&self, on: bool) -> Result<(), String> {
        self.cmd.send(Cmd::HoldClip(on))
    }

    /// The clip playing now is paused.
    pub fn clip_held(&self) -> bool {
        self.shared.clip_held.load(Relaxed)
    }

    /// The clip playing now and how far in it is (seconds).
    pub fn clip(&self) -> Option<(u64, f64)> {
        let id = self.shared.clip.load(Relaxed);
        (id != 0).then(|| (id, self.shared.clip_ms.load(Relaxed) as f64 / 1000.0))
    }

    /// Whether clip `id` played to its end (rather than being stopped, e.g. by playing the track).
    pub fn clip_finished(&self, id: u64) -> bool {
        self.shared.clip_done.load(Relaxed) == id
    }

    pub fn set_loop(&self, a: Option<f64>, b: Option<f64>) -> Result<(), String> {
        let id = self.loop_latest.fetch_add(1, Relaxed) + 1;
        let mut ctl = lock(&self.ctl);
        ctl.shadow_repeats = 0;
        let Some(t) = ctl.track.as_ref() else {
            return Ok(());
        };
        let to_frame = |x: f64| (x.max(0.0) * t.sr as f64).round() as u64;
        let ab = match (a, b) {
            (Some(a), Some(b)) if a.is_finite() && b.is_finite() && b > a => {
                let (a, b) = (to_frame(a), to_frame(b).min(t.total));
                (b > a).then_some((a, b))
            }
            _ => None,
        };
        let job = ab.map(|(a, b)| Job {
            session: t.id,
            path: t.file.clone(),
            spec: Spec {
                loop_id: id,
                a,
                b,
                history: session::history_frames(t.sr),
                xf: (t.sr as f64 * session::XF_SECS).round() as u64,
                cap: (t.sr as f64 * REGION_CAP_SECS) as u64,
            },
        });
        drop(ctl);
        self.cmd.send(Cmd::Loop(ab, id))?;
        if let (Some(job), Ok(loader)) = (job, self.loader.lock()) {
            let _ = loader.send(job);
        }
        Ok(())
    }
}

fn clamp_time(t: f64, duration: f64) -> f64 {
    let t = if t.is_finite() { t.max(0.0) } else { 0.0 };
    if duration > 0.0 {
        t.min(duration)
    } else {
        t
    }
}
