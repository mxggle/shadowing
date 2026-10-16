//! One take's thread: owns the microphone stream (not `Send`), drains the mic
//! and the output tap, keeps 10 ms levels, reports them, and says when the
//! take can stop. Reading a paragraph on your own, it also follows which
//! sentence you're on (`follow.rs`). A sentence said several times in a row
//! (跟读方案) starts afresh each time (`Msg::Round`) with the mic left open:
//! only the last time is kept.

use super::follow::{Follow, Step};
use super::take::{Mode, Raw};
use super::vad::{self, Rules, Stop};
use super::{mic, rules, Level, Meta, Signals};
use crate::audio::tap::{Mark, TapRx};
use std::sync::atomic::Ordering::Relaxed;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

/// Longest take, whatever happens: the mic closes then. A sentence's (or an
/// A–B loop's) takes its own length a few times over; a paragraph may be long.
const MAX_TAKE_SECS: (f64, f64) = (120.0, 600.0);
const MAX_PARAGRAPH_SECS: f64 = 600.0;
/// A microphone that delivers only exact zeros this long is blocked (no permission).
const SILENT_MIC_SECS: f64 = 1.5;
const LEVEL_EVERY: Duration = Duration::from_millis(33);
/// The speech threshold is re-estimated this often (frames).
const THRESHOLD_EVERY: usize = 10;
const ERR_BLOCKED: &str = "麦克风没有声音：如果刚才弹出了使用麦克风的提示，点“允许”后再录一次；\
    否则请在“系统设置 → 隐私与安全性 → 麦克风”里允许 Shadowing";

pub enum Msg {
    /// Another time through: drop what was captured, wait for a new turn.
    Round,
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
        let said = (meta.end - meta.start).max(0.0) / meta.rate.clamp(0.5, 2.0);
        Self {
            max_secs: if paragraph {
                MAX_PARAGRAPH_SECS
            } else {
                (said * 3.0 + 30.0).clamp(MAX_TAKE_SECS.0, MAX_TAKE_SECS.1)
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
    let (mut follow, mut threshold) = (None::<Follow>, vad::threshold(&[]));
    if let Some((expected, r)) = plan.follow {
        follow = Some(Follow::new(expected));
        turn = Some(0);
        rules_now = Some(r);
    }
    let (mut error, mut afresh, mut dropped) = (None, false, 0usize);
    loop {
        match rx.recv_timeout(Duration::from_millis(10)) {
            Ok(Msg::Round) => afresh = true,
            Ok(Msg::Turn(r)) => {
                turn.get_or_insert(levels.len());
                rules_now = Some(r);
            }
            Ok(Msg::Step(by)) => {
                if let Some(f) = follow.as_mut() {
                    let to = (f.current as i64 + by as i64).max(0) as usize;
                    if let Some(Step::Next(i)) = f.jump(to, levels.len()) {
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
            if follow.is_none() {
                played.push(v); // reading on your own, nothing is played
            }
        }
        if std::mem::take(&mut afresh) {
            dropped += buf.len();
            buf.clear();
            levels.clear();
            drop_played(&mut marks, &mut played);
            (turn, rules_now, stopped) = (None, None, false);
            threshold = vad::threshold(&[]);
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
                Some(Step::Next(i)) => out.sentence(i),
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
        if secs > plan.max_secs {
            out.auto(Stop::Long);
            break;
        }
        let stop = match (turn, rules_now) {
            (Some(t), Some(r)) => vad::verdict(&levels, t, &r, threshold),
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
    out.ended();
    let _ = done.send(match error {
        Some(e) => Err(e),
        None => Ok(Raw {
            mic_at: later(mic.first_at.load(Relaxed), dropped, mic.rate),
            turn: turn.map_or(0, |t| t * frame),
            mic: buf,
            mic_rate: mic.rate,
            marks,
            played,
            followed: follow.map(|f| f.followed()),
        }),
    });
}

/// Drops the output blocks taken so far. Their samples come in before their
/// marks, so samples past the last mark (a block still on its way) stay.
fn drop_played(marks: &mut Vec<Mark>, played: &mut Vec<f32>) {
    let n: usize = marks.iter().map(|m| m.frames as usize).sum();
    played.drain(..n.min(played.len()));
    marks.clear();
}

/// Host time (ns) of the mic sample `n` samples after the one heard `at`.
fn later(at: u64, n: usize, rate: u32) -> u64 {
    at + (n as u128 * 1_000_000_000 / rate.max(1) as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_round_keeps_a_block_still_on_its_way() {
        let mark = |frames| Mark {
            at: 0,
            frames,
            rate: 48_000,
        };
        let mut marks = vec![mark(3), mark(2)];
        let mut played = vec![1.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0];
        drop_played(&mut marks, &mut played);
        assert!(marks.is_empty());
        assert_eq!(
            played,
            [3.0, 3.0],
            "the next block's samples, its mark to come"
        );
    }

    #[test]
    fn the_mic_timeline_moves_on_by_what_was_dropped() {
        assert_eq!(later(5_000_000_000, 48_000, 48_000), 6_000_000_000);
        assert_eq!(later(1, 0, 44_100), 1);
        // Hours of samples don't overflow.
        assert_eq!(later(0, 48_000 * 3600 * 10, 48_000), 36_000 * 1_000_000_000);
    }
}
