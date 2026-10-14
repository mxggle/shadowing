//! One take's thread: owns the microphone stream (not `Send`), drains the mic
//! and the output tap, keeps 10 ms levels, reports them, and says when the
//! take can stop. Reading a paragraph on your own, it also follows which
//! sentence you're on (`follow.rs`).

use super::follow::{Follow, Step};
use super::take::{Mode, Raw};
use super::vad::{self, Rules, Stop};
use super::{mic, rules, Level, Meta, Signals};
use crate::audio::tap::TapRx;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

/// Longest take, whatever happens; a paragraph may be long.
const MAX_TAKE_SECS: f64 = 120.0;
const MAX_PARAGRAPH_SECS: f64 = 600.0;
/// A microphone that delivers only exact zeros this long is blocked (no permission).
const SILENT_MIC_SECS: f64 = 1.5;
const LEVEL_EVERY: Duration = Duration::from_millis(33);
/// The speech threshold is re-estimated this often (frames).
const THRESHOLD_EVERY: usize = 10;
const ERR_BLOCKED: &str =
    "麦克风没有声音：请在“系统设置 → 隐私与安全性 → 麦克风”里允许 Shadowing，然后再试";

pub enum Msg {
    Turn(Rules),
    /// By hand, reading on your own: next (+1) / previous (−1) sentence.
    Step(i32),
    Stop,
}

/// What the session needs to know about the take up front.
pub struct Plan {
    max_secs: f64,
    /// Reading on your own: the original's length of each sentence (the
    /// session starts with your turn; nothing is played first).
    follow: Option<(Vec<f64>, Rules)>,
}

impl Plan {
    pub fn of(meta: &Meta) -> Self {
        let paragraph = !meta.sentences.is_empty();
        let follow = (meta.mode == Mode::Read).then(|| {
            let expected = if paragraph {
                meta.sentences.iter().map(|s| s.end - s.start).collect()
            } else {
                vec![meta.end - meta.start]
            };
            (expected, rules(meta))
        });
        Self {
            max_secs: if paragraph {
                MAX_PARAGRAPH_SECS
            } else {
                MAX_TAKE_SECS
            },
            follow,
        }
    }
}

pub fn run(
    out: impl Signals,
    plan: Plan,
    mut tap_rx: TapRx,
    rx: Receiver<Msg>,
    ready: Sender<Result<String, String>>,
    done: Sender<Result<Raw, String>>,
) {
    let mut mic = match mic::open(4.0) {
        Ok(m) => m,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    let opened = Instant::now();
    while mic.first_at.load(Relaxed) == 0 {
        if opened.elapsed() > Duration::from_secs(2) {
            let _ = ready.send(Err("麦克风没有响应".into()));
            return;
        }
        thread::sleep(Duration::from_millis(5));
    }
    let _ = ready.send(Ok(mic.name.clone()));
    let frame = (mic.rate as f64 * vad::FRAME_SECS) as usize;
    let (mut buf, mut levels) = (Vec::<f32>::new(), Vec::<f32>::new());
    let (mut marks, mut played) = (Vec::new(), Vec::new());
    let (mut turn, mut rules_now, mut stopped) = (None::<usize>, None::<Rules>, false);
    let (mut last_emit, mut loudest, mut sound) = (Instant::now(), f32::MIN, false);
    let (mut follow, mut hints, mut threshold) = (None::<Follow>, Vec::new(), vad::threshold(&[]));
    if let Some((expected, r)) = plan.follow {
        follow = Some(Follow::new(expected));
        turn = Some(0);
        rules_now = Some(r);
    }
    let mut error = None;
    loop {
        match rx.recv_timeout(Duration::from_millis(10)) {
            Ok(Msg::Turn(r)) => {
                turn.get_or_insert(levels.len());
                rules_now = Some(r);
            }
            Ok(Msg::Step(by)) => {
                if let Some(f) = follow.as_mut() {
                    let to = (f.current as i64 + by as i64).max(0) as usize;
                    if let Some(Step::Next(i)) = f.jump(to) {
                        hints.push(levels.len());
                        out.sentence(i);
                    }
                }
            }
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        while let Ok(v) = mic.samples.pop() {
            sound |= v != 0.0;
            buf.push(v);
        }
        while let Ok(m) = tap_rx.marks.pop() {
            marks.push(m);
        }
        while let Ok(v) = tap_rx.samples.pop() {
            played.push(v);
        }
        while (levels.len() + 1) * frame <= buf.len() {
            let at = levels.len();
            let l = vad::level(&buf[at * frame..][..frame]);
            loudest = loudest.max(l);
            levels.push(l);
            if at % THRESHOLD_EVERY == 0 {
                threshold = vad::threshold(&levels);
            }
            match follow.as_mut().and_then(|f| f.frame(at, l > threshold)) {
                Some(Step::Next(i)) => {
                    hints.push(at);
                    out.sentence(i);
                }
                Some(Step::Done) if !stopped => {
                    stopped = true;
                    out.auto(Stop::Pause);
                }
                _ => {}
            }
        }
        let secs = buf.len() as f64 / mic.rate as f64;
        if mic.failed.load(Relaxed) {
            error = Some("麦克风断开了".to_string());
        } else if secs > SILENT_MIC_SECS && !sound {
            error = Some(ERR_BLOCKED.to_string());
        }
        if let Some(e) = error.as_ref() {
            out.error(e);
            break;
        }
        let stop = match (turn, rules_now) {
            _ if secs > plan.max_secs => Some(Stop::Long),
            (Some(t), Some(r)) => vad::verdict(&levels, t, &r),
            _ => None,
        };
        if let Some(stop) = stop.filter(|_| !stopped) {
            stopped = true;
            out.auto(stop);
        }
        if last_emit.elapsed() >= LEVEL_EVERY && loudest > f32::MIN {
            out.level(&Level {
                level: ((loudest + 60.0) / 60.0).clamp(0.0, 1.0),
                speaking: loudest > threshold,
                secs: turn.map_or(0.0, |t| (levels.len() - t) as f64 * vad::FRAME_SECS),
            });
            last_emit = Instant::now();
            loudest = f32::MIN;
        }
    }
    drop(mic.stream);
    let _ = done.send(match error {
        Some(e) => Err(e),
        None => Ok(Raw {
            mic_at: mic.first_at.load(Relaxed),
            turn: turn.map_or(0, |t| t * frame),
            mic: buf,
            mic_rate: mic.rate,
            marks,
            played,
            hints,
        }),
    });
}
