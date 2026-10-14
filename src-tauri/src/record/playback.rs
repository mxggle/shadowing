//! Playing a take back, as an engine clip over the paused track: the original
//! as you heard it, you, the two one after the other (听完再说) or together
//! (边听边说, the way it sounded while you shadowed). The webview gets where
//! each part of the clip comes from in the file, to move a playhead on the
//! right waveform, and `recorder:clip` events while it plays.

use super::saved::{self, Take};
use super::take::{convert, RATE};
use crate::audio::decode::Decoder;
use crate::audio::Player;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Silence between the original and you when they're played in turn.
const GAP_SECS: f64 = 0.4;

static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum What {
    Original,
    Mine,
    /// Original, a short gap, then you.
    Compare,
    /// Both at once, in step.
    Together,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Lane {
    Original,
    Mine,
    Both,
}

/// `clip_at` seconds into the clip, the file from `from` to `to` is heard on `lane`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub lane: Lane,
    pub from: f64,
    pub to: f64,
    pub clip_at: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playing {
    pub clip: u64,
    pub parts: Vec<Part>,
    pub duration: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipStatus {
    clip: u64,
    secs: f64,
    playing: bool,
}

/// Which stretches of the file make up the clip, in order.
pub fn parts(take: &Take, what: What) -> Vec<Part> {
    let part = |lane, (from, to): (f64, f64), clip_at| Part {
        lane,
        from,
        to,
        clip_at,
    };
    let (o, m) = (take.original, take.mine);
    match what {
        What::Original => vec![part(Lane::Original, o, 0.0)],
        What::Mine => vec![part(Lane::Mine, m, 0.0)],
        What::Compare => vec![
            part(Lane::Original, o, 0.0),
            part(Lane::Mine, m, o.1 - o.0 + GAP_SECS),
        ],
        What::Together => vec![part(Lane::Both, (o.0.min(m.0), o.1.max(m.1)), 0.0)],
    }
}

/// Mono samples at `RATE` for `parts`, from the take's left / right channels.
pub fn render(left: &[f32], right: &[f32], parts: &[Part]) -> Vec<f32> {
    let at = |s: f64| (s * RATE as f64).round().max(0.0) as usize;
    let mut out = Vec::new();
    for p in parts {
        out.resize(at(p.clip_at).max(out.len()), 0.0);
        for i in at(p.from)..at(p.to) {
            let (l, r) = (
                left.get(i).copied().unwrap_or(0.0),
                right.get(i).copied().unwrap_or(0.0),
            );
            out.push(match p.lane {
                Lane::Original => l,
                Lane::Mine => r,
                Lane::Both => (l * 0.6 + r * 0.8).clamp(-1.0, 1.0),
            });
        }
    }
    out
}

fn read(path: &Path) -> Result<(Vec<f32>, Vec<f32>), String> {
    let mut d = Decoder::open(path).map_err(|_| "这条录音的文件不见了".to_string())?;
    let mut all = Vec::new();
    let mut buf = vec![0.0; 4096 * d.channels];
    loop {
        let n = d.read(&mut buf)?;
        if n == 0 {
            break;
        }
        all.extend_from_slice(&buf[..n * d.channels]);
    }
    let ch = d.channels.max(1);
    let lane = |c: usize| all.chunks(ch).map(|f| f[c.min(ch - 1)]).collect();
    Ok((lane(0), lane(1)))
}

pub fn play(
    app: AppHandle,
    player: &Player,
    root: &Path,
    audio: &str,
    id: &str,
    what: What,
) -> Result<Playing, String> {
    let take = saved::list(root, audio)
        .into_iter()
        .find(|t| t.id == id)
        .ok_or("这条录音不见了")?;
    let (left, right) = read(&saved::wav_path(root, audio, id))?;
    let parts = parts(&take, what);
    let samples = render(&left, &right, &parts);
    let duration = samples.len() as f64 / RATE as f64;
    let rate = player.device_rate();
    let clip = NEXT.fetch_add(1, Relaxed);
    player.play_clip(clip, convert(&samples, RATE, rate), rate)?;
    thread::spawn(move || watch(app, clip));
    Ok(Playing {
        clip,
        parts,
        duration,
    })
}

/// Reports the clip's position until it ends or another replaces it.
fn watch(app: AppHandle, clip: u64) {
    use tauri::Manager;
    let player = app.state::<Player>();
    // The engine picks the clip up at its next callback.
    thread::sleep(Duration::from_millis(30));
    loop {
        let now = player.clip();
        let playing = now.is_some_and(|(id, _)| id == clip);
        let secs = now.filter(|_| playing).map_or(0.0, |(_, s)| s);
        let _ = app.emit(
            "recorder:clip",
            ClipStatus {
                clip,
                secs,
                playing,
            },
        );
        if !playing {
            return;
        }
        thread::sleep(Duration::from_millis(33));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::record::saved::Peaks;
    use crate::record::take::Mode;

    fn take() -> Take {
        Take {
            id: "1".into(),
            created: 0,
            start: 0.0,
            end: 1.0,
            text: String::new(),
            mode: Mode::Listen,
            rate: 1.0,
            duration: 2.0,
            original: (0.1, 0.6),
            mine: (1.0, 1.9),
            lag_ms: None,
            peaks: Peaks {
                original: vec![],
                mine: vec![],
            },
        }
    }

    #[test]
    fn compare_plays_the_original_then_you() {
        let p = parts(&take(), What::Compare);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].lane, Lane::Original);
        assert!(
            (p[1].clip_at - 0.9).abs() < 1e-9,
            "after the original and a gap"
        );
        let (l, r) = (vec![0.5; 64_000], vec![-0.25; 64_000]);
        let out = render(&l, &r, &p);
        let at = |s: f64| (s * RATE as f64) as usize;
        assert_eq!(out.len(), at(0.9) + at(0.9));
        assert_eq!(out[at(0.2)], 0.5);
        assert_eq!(out[at(0.7)], 0.0, "the gap");
        assert_eq!(out[at(1.2)], -0.25);
    }

    #[test]
    fn together_mixes_the_whole_stretch() {
        let p = parts(&take(), What::Together);
        assert_eq!((p[0].from, p[0].to), (0.1, 1.9));
        let out = render(&[0.5; 64_000], &[0.5; 64_000], &p);
        assert!(out.iter().all(|&v| (v - 0.7).abs() < 1e-6));
    }
}
