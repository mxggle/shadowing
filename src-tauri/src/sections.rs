//! Sections (对话段落): runs of sentences that belong together, like the
//! separate dialogs on a listening-test track. Found offline after a
//! transcription or import, at a pause that stands out from the rest or where
//! one set of voices hands over to another; the learner can split, merge and
//! name them. A transcript always has at least one, starting at sentence 0.

use crate::transcript::Sentence;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Section {
    /// Index of its first sentence.
    pub start: usize,
    /// The learner's name for it; the app shows "对话 2" without one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// A pause shorter than this never starts a section…
const MIN_PAUSE: f64 = 1.0;
/// …nor one less than this many times the usual pause between sentences…
const TIMES_USUAL: f64 = 3.0;
/// …nor one shorter than this share of all pauses (so at most ~1 in 10 is a break,
/// and material read slowly with long gaps after every sentence isn't chopped up).
const PERCENTILE: f64 = 0.9;
/// Fewest sentences in a section found by a pause.
const MIN_SENTENCES: usize = 2;
/// Sentences looked at on each side for a change of voices, and the fewest a
/// section needs before voices may end it.
const VOICE_WINDOW: usize = 4;
const MIN_VOICE_SENTENCES: usize = 3;
/// Longest title kept, in characters.
const MAX_TITLE: usize = 40;

/// One section covering everything.
pub fn whole() -> Vec<Section> {
    vec![Section {
        start: 0,
        title: None,
    }]
}

/// Where new sections start in a fresh transcript (always includes 0).
pub fn split(sentences: &[Sentence]) -> Vec<Section> {
    let n = sentences.len();
    let gaps: Vec<f64> = sentences
        .windows(2)
        .map(|w| (w[1].start - w[0].end).max(0.0))
        .collect();
    let mut starts = vec![0];
    if gaps.is_empty() {
        return whole();
    }
    let mut sorted = gaps.clone();
    sorted.sort_by(f64::total_cmp);
    let usual = sorted[sorted.len() / 2];
    let rare = sorted[(PERCENTILE * (sorted.len() - 1) as f64) as usize];
    let pause = MIN_PAUSE.max(TIMES_USUAL * usual).max(rare);

    for i in 1..n {
        let since = i - starts.last().unwrap();
        if since < MIN_SENTENCES || n - i < MIN_SENTENCES {
            continue;
        }
        let by_pause = gaps[i - 1] >= pause;
        let by_voices =
            since >= MIN_VOICE_SENTENCES && voices_change(sentences, i, *starts.last().unwrap());
        if by_pause || by_voices {
            starts.push(i);
        }
    }
    starts
        .into_iter()
        .map(|start| Section { start, title: None })
        .collect()
}

/// A dialog between two or more voices gives way to one between other voices
/// (A/B → C/D). A single voice on either side is a long turn, not a new dialog.
fn voices_change(sentences: &[Sentence], i: usize, section_start: usize) -> bool {
    let before = voices(&sentences[section_start.max(i.saturating_sub(VOICE_WINDOW))..i]);
    let after = voices(&sentences[i..(i + VOICE_WINDOW).min(sentences.len())]);
    before.len() >= 2 && after.len() >= 2 && before.iter().all(|v| !after.contains(v))
}

fn voices(sentences: &[Sentence]) -> Vec<u8> {
    let mut found: Vec<u8> = sentences.iter().filter_map(|s| s.speaker).collect();
    found.sort_unstable();
    found.dedup();
    found
}

/// Makes sections safe to show for `count` sentences: in order, no repeats,
/// none past the end, the first at sentence 0, titles trimmed (blank = none).
pub fn normalize(mut sections: Vec<Section>, count: usize) -> Vec<Section> {
    for s in &mut sections {
        s.title = s
            .title
            .as_deref()
            .map(|t| t.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|t| !t.is_empty())
            .map(|t| t.chars().take(MAX_TITLE).collect());
    }
    sections.retain(|s| s.start < count.max(1));
    sections.sort_by_key(|s| s.start);
    sections.dedup_by_key(|s| s.start);
    match sections.first_mut() {
        Some(first) if first.start == 0 => {}
        _ => sections.insert(0, whole().remove(0)),
    }
    sections
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sentences one second long, each `gap` seconds after the last, said by `who`.
    fn script(lines: &[(f64, Option<u8>)]) -> Vec<Sentence> {
        let mut t = 0.0;
        lines
            .iter()
            .map(|&(gap, speaker)| {
                t += gap;
                let s = Sentence {
                    start: t,
                    end: t + 1.0,
                    text: "x".into(),
                    speaker,
                    unsure: vec![],
                    times: vec![],
                };
                t += 1.0;
                s
            })
            .collect()
    }

    fn starts(sections: &[Section]) -> Vec<usize> {
        sections.iter().map(|s| s.start).collect()
    }

    fn quiet(gaps: &[f64]) -> Vec<Sentence> {
        script(&gaps.iter().map(|&g| (g, None)).collect::<Vec<_>>())
    }

    #[test]
    fn nothing_or_one_sentence_is_one_section() {
        assert_eq!(starts(&split(&[])), [0]);
        assert_eq!(starts(&split(&quiet(&[0.0]))), [0]);
    }

    #[test]
    fn a_pause_that_stands_out_starts_a_section() {
        let gaps = [0.0, 0.3, 0.4, 0.3, 0.5, 0.3, 2.6, 0.4, 0.3, 0.4, 0.3, 0.4];
        assert_eq!(starts(&split(&quiet(&gaps))), [0, 6]);
    }

    #[test]
    fn short_pauses_in_quick_speech_dont_split() {
        // A second is three times the usual pause here, but not a break.
        let gaps = [0.0, 0.2, 0.9, 0.2, 0.3, 0.2, 0.3, 0.2, 0.2, 0.3];
        assert_eq!(starts(&split(&quiet(&gaps))), [0]);
    }

    #[test]
    fn evenly_slow_reading_is_not_chopped_up() {
        // Room to repeat after every sentence: long pauses, but all alike.
        let gaps = [0.0, 3.0, 3.2, 2.9, 3.1, 3.0, 3.3, 3.0, 2.8, 3.1];
        assert_eq!(starts(&split(&quiet(&gaps))), [0]);
    }

    #[test]
    fn a_pause_right_at_either_end_leaves_no_lone_sentence() {
        let gaps = [0.0, 4.0, 0.3, 0.3, 0.4, 0.3, 0.4, 0.3, 0.3, 4.0];
        assert_eq!(starts(&split(&quiet(&gaps))), [0]);
    }

    #[test]
    fn one_dialog_handing_over_to_other_voices_starts_a_section() {
        let (a, b, c, d) = (Some(0), Some(1), Some(2), Some(3));
        let lines = [a, b, a, b, a, c, d, c, d, c].map(|v| (0.3, v));
        assert_eq!(starts(&split(&script(&lines))), [0, 5]);
    }

    #[test]
    fn a_long_turn_by_one_voice_is_not_a_new_dialog() {
        let (a, b, c) = (Some(0), Some(1), Some(2));
        let lines = [a, b, a, b, a, a, a, a, b, c, b].map(|v| (0.3, v));
        assert_eq!(starts(&split(&script(&lines))), [0]);
    }

    #[test]
    fn voices_coming_back_keep_the_dialog_together() {
        let (a, b, c) = (Some(0), Some(1), Some(2));
        let lines = [a, b, a, b, c, a, c, b, a, b].map(|v| (0.3, v));
        assert_eq!(starts(&split(&script(&lines))), [0]);
    }

    #[test]
    fn normalize_repairs_what_it_is_given() {
        let s = |start, title: Option<&str>| Section {
            start,
            title: title.map(str::to_string),
        };
        let fixed = normalize(
            vec![
                s(5, Some("  会話\n 2 ")),
                s(2, Some("   ")),
                s(5, None),
                s(9, None),
            ],
            8,
        );
        assert_eq!(fixed, [s(0, None), s(2, None), s(5, Some("会話 2"))]);
        assert_eq!(normalize(vec![], 0), whole());
        let long = "あ".repeat(60);
        assert_eq!(
            normalize(vec![s(0, Some(&long))], 1)[0]
                .title
                .as_ref()
                .unwrap()
                .chars()
                .count(),
            MAX_TITLE
        );
    }
}
