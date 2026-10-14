//! Playing a paragraph reading back: all of you straight through, you with
//! the original (跟着原文读), or sentence by sentence, the original then you
//! (from each sentence's own take). The webview gets which sentence each
//! stretch of the clip belongs to, to light it up as it plays.

use super::playback::{read, Lane, NEXT};
use super::saved::{self, Reading};
use super::take::{convert, RATE};
use super::watch::watch;
use crate::audio::Player;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::Ordering::Relaxed;
use std::thread;
use tauri::AppHandle;

/// Between the original and you, and between sentences, played in turns.
const TURN_GAP_SECS: f64 = 0.3;
const NEXT_GAP_SECS: f64 = 0.7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadingPart {
    /// Your whole reading.
    Mine,
    /// Your reading with the original (跟着原文读).
    Together,
    /// Each sentence: the original, then you.
    Turns,
}

/// `clip_at` seconds into the clip, sentence `part` (of the reading) plays on `lane` for `len` seconds.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stretch {
    pub clip_at: f64,
    pub len: f64,
    pub part: usize,
    pub lane: Lane,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPlaying {
    pub clip: u64,
    pub duration: f64,
    pub stretches: Vec<Stretch>,
}

/// Mono samples at `RATE` and what is where, for `what` of `reading`.
/// `whole` is the reading's file; `take(id)` a sentence take's.
pub fn render(
    reading: &Reading,
    whole: &(Vec<f32>, Vec<f32>),
    what: ReadingPart,
    take: impl Fn(&str) -> Option<(f64, f64, f64, f64, (Vec<f32>, Vec<f32>))>,
) -> (Vec<f32>, Vec<Stretch>) {
    let at = |s: f64| (s * RATE as f64).round().max(0.0) as usize;
    let (l, r) = whole;
    match what {
        ReadingPart::Mine | ReadingPart::Together => {
            let both = what == ReadingPart::Together;
            let out = (0..l.len().max(r.len()))
                .map(|i| {
                    let (a, b) = (
                        l.get(i).copied().unwrap_or(0.0),
                        r.get(i).copied().unwrap_or(0.0),
                    );
                    if both {
                        (a * 0.6 + b * 0.8).clamp(-1.0, 1.0)
                    } else {
                        b
                    }
                })
                .collect();
            let lane = if both { Lane::Both } else { Lane::Mine };
            let stretches = reading
                .parts
                .iter()
                .enumerate()
                .filter(|(_, p)| p.take.is_some())
                .map(|(part, p)| Stretch {
                    clip_at: p.mine.0,
                    len: p.mine.1 - p.mine.0,
                    part,
                    lane,
                })
                .collect();
            (out, stretches)
        }
        ReadingPart::Turns => {
            let mut out: Vec<f32> = Vec::new();
            let mut stretches = Vec::new();
            for (part, p) in reading.parts.iter().enumerate() {
                let Some((oa, ob, ma, mb, (tl, tr))) = p.take.as_deref().and_then(&take) else {
                    continue;
                };
                for (lane, (a, b), src) in
                    [(Lane::Original, (oa, ob), &tl), (Lane::Mine, (ma, mb), &tr)]
                {
                    let clip_at = out.len() as f64 / RATE as f64;
                    out.extend_from_slice(&src[at(a).min(src.len())..at(b).min(src.len())]);
                    stretches.push(Stretch {
                        clip_at,
                        len: b - a,
                        part,
                        lane,
                    });
                    let gap = if lane == Lane::Original {
                        TURN_GAP_SECS
                    } else {
                        NEXT_GAP_SECS
                    };
                    out.resize(out.len() + at(gap), 0.0);
                }
            }
            (out, stretches)
        }
    }
}

pub fn play_reading(
    app: AppHandle,
    player: &Player,
    root: &Path,
    audio: &str,
    id: &str,
    what: ReadingPart,
) -> Result<ReadingPlaying, String> {
    let reading = saved::readings(root, audio)
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("这次朗读不见了")?;
    let whole = read(&saved::wav_path(root, audio, id))?;
    let takes = saved::list(root, audio);
    let take = |tid: &str| {
        let t = takes.iter().find(|t| t.id == tid)?;
        let sound = read(&saved::wav_path(root, audio, tid)).ok()?;
        Some((t.original.0, t.original.1, t.mine.0, t.mine.1, sound))
    };
    let (samples, stretches) = render(&reading, &whole, what, take);
    let duration = samples.len() as f64 / RATE as f64;
    let rate = player.device_rate();
    let clip = NEXT.fetch_add(1, Relaxed);
    player.play_clip(clip, convert(&samples, RATE, rate), rate)?;
    thread::spawn(move || watch(app, clip));
    Ok(ReadingPlaying {
        clip,
        duration,
        stretches,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::record::saved::ReadPart;
    use crate::record::take::Mode;

    fn reading() -> Reading {
        let part = |s: f64, take: Option<&str>| ReadPart {
            start: s,
            end: s + 1.0,
            mine: (s, s + 0.8),
            take: take.map(Into::into),
        };
        Reading {
            id: "r".into(),
            created: 0,
            start: 0.0,
            end: 3.0,
            mode: Mode::Read,
            rate: 1.0,
            duration: 3.0,
            parts: vec![part(0.0, Some("a")), part(1.0, None), part(2.0, Some("b"))],
            original_secs: 3.0,
            mine_secs: 2.8,
            lag_ms: None,
            peaks: vec![],
        }
    }

    #[test]
    fn turns_play_each_said_sentence_original_first() {
        let sound = (
            vec![0.5f32; RATE as usize * 2],
            vec![-0.5f32; RATE as usize * 2],
        );
        let (out, s) = render(&reading(), &(vec![], vec![]), ReadingPart::Turns, |_| {
            Some((0.0, 0.5, 1.0, 1.5, sound.clone()))
        });
        let lanes: Vec<(usize, Lane)> = s.iter().map(|x| (x.part, x.lane)).collect();
        assert_eq!(
            lanes,
            [
                (0, Lane::Original),
                (0, Lane::Mine),
                (2, Lane::Original),
                (2, Lane::Mine)
            ]
        );
        assert!(
            (s[1].clip_at - 0.8).abs() < 1e-6,
            "after the original and a short gap"
        );
        assert!(
            (s[2].clip_at - 2.0).abs() < 1e-6,
            "after you and a longer gap"
        );
        assert_eq!(out[(RATE as f64 * 0.25) as usize], 0.5);
        assert_eq!(out[(RATE as f64 * 1.0) as usize], -0.5);
    }

    #[test]
    fn mine_plays_the_whole_file_and_marks_the_sentences() {
        let whole = (
            vec![0.1f32; RATE as usize * 3],
            vec![0.2f32; RATE as usize * 3],
        );
        let (out, s) = render(&reading(), &whole, ReadingPart::Mine, |_| None);
        assert_eq!(out.len(), RATE as usize * 3);
        assert!(out.iter().all(|&v| v == 0.2));
        assert_eq!(s.iter().map(|x| x.part).collect::<Vec<_>>(), [0, 2]);
    }
}
