//! Control side (any thread): validates requests, builds sessions off the
//! audio thread, queues commands for the engine, and runs the status thread
//! that emits `player:*` events.

use super::decode::Decoder;
use super::engine::{self, Cmd, Engine, Shared};
use super::feed::RingFeed;
use super::output;
use super::region::{self, Job, Outcome, Spec};
use super::session::{self, Session};
use super::status::{self, lock, snapshot, CmdTx, Ctl, Track};
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
            ctl.shadow_repeats = 0;
            self.cmd
                .send(Cmd::Load(Box::new(session), start, autoplay))?;
        }
        self.emit();
        Ok(duration)
    }

    pub fn unload(&self) -> Result<(), String> {
        lock(&self.ctl).track = None;
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
            Some(Cmd::Play)
        })
    }

    pub fn pause(&self) -> Result<(), String> {
        self.with_track(|c| {
            c.shadow_playing = false;
            Some(Cmd::Pause)
        })
    }

    pub fn toggle(&self) -> Result<(), String> {
        let playing = self.status().playing;
        self.with_track(|c| {
            c.shadow_playing = !playing;
            Some(Cmd::Toggle)
        })
    }

    pub fn seek(&self, time: f64) -> Result<(), String> {
        if !time.is_finite() {
            return Err("无效的时间".into());
        }
        self.with_track(|c| {
            let t = c.track.as_ref()?;
            let secs = clamp_time(time, t.duration);
            let frame = ((secs * t.sr as f64).round() as u64).min(t.total.saturating_sub(1));
            c.shadow_time = secs;
            Some(Cmd::Seek(frame))
        })
    }

    pub fn set_rate(&self, rate: f64) -> Result<(), String> {
        if !rate.is_finite() {
            return Err("无效的速度".into());
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
