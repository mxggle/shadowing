//! Tests for cutting and joining sentences.

use super::*;
use crate::transcript::Source;

fn s(start: f64, end: f64, text: &str) -> Sentence {
    Sentence {
        start,
        end,
        text: text.into(),
        speaker: None,
        unsure: Vec::new(),
        times: Vec::new(),
    }
}

fn section(start: usize, title: Option<&str>) -> Section {
    Section {
        start,
        title: title.map(str::to_string),
    }
}

/// Five sentences two seconds apart, in sections from 0, 2 ("駅で") and 4.
fn transcript() -> Transcript {
    let lines = ["一。", "二。", "三。", "四。", "五。"];
    Transcript {
        source: Source::Sidecar,
        origin: "a.srt".into(),
        sentences: lines
            .iter()
            .enumerate()
            .map(|(i, t)| s(i as f64 * 2.0, i as f64 * 2.0 + 1.5, t))
            .collect(),
        edited: false,
        sections: vec![section(0, None), section(2, Some("駅で")), section(4, None)],
    }
}

fn starts(t: &Transcript) -> Vec<usize> {
    t.sections.iter().map(|s| s.start).collect()
}

fn texts(t: &Transcript) -> Vec<&str> {
    t.sentences.iter().map(|s| s.text.as_str()).collect()
}

fn round(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

#[test]
fn sentences_after_the_change_move_and_the_changed_ones_go() {
    let cut = Change {
        at: 2,
        removed: 1,
        added: 2,
    };
    assert_eq!(
        [0, 1, 2, 3].map(|i| cut.moved(i)),
        [Some(0), Some(1), None, Some(4)]
    );
    let join = Change {
        at: 2,
        removed: 2,
        added: 1,
    };
    assert_eq!(
        [1, 2, 3, 4].map(|i| join.moved(i)),
        [Some(1), None, None, Some(3)]
    );
}

#[test]
fn joins_without_a_space_only_in_chinese_and_japanese() {
    assert_eq!(join("おはよう。", "元気？"), "おはよう。元気？");
    assert_eq!(join("你好，", "最近怎么样？"), "你好，最近怎么样？");
    assert_eq!(join("Hello.", "How are you?"), "Hello. How are you?");
    assert_eq!(
        join("안녕하세요.", "반갑습니다."),
        "안녕하세요. 반갑습니다."
    );
    assert_eq!(join("OK", "です"), "OKです");
    assert_eq!(join("「行こう」", "って"), "「行こう」って");
}

#[test]
fn a_join_spans_both_and_keeps_both_sets_of_underlines_and_times() {
    let mut a = s(1.0, 2.0, "傘を");
    a.unsure = vec![[0, 1]];
    a.times = vec![(0, 1.0), (1, 1.4)];
    let mut b = s(2.3, 3.5, "持ってきた？");
    b.unsure = vec![[0, 2]];
    b.times = vec![(0, 2.3), (4, 3.1)];
    b.speaker = Some(1);
    let m = merge(&a, &b);
    assert_eq!(
        (m.start, m.end, m.text.as_str()),
        (1.0, 3.5, "傘を持ってきた？")
    );
    assert_eq!(m.unsure, [[0, 1], [2, 4]]);
    assert_eq!(m.times, [(0, 1.0), (1, 1.4), (2, 2.3), (6, 3.1)]);
    assert_eq!(
        m.speaker,
        Some(1),
        "the second's voice when the first has none"
    );
    a.speaker = Some(0);
    assert_eq!(merge(&a, &b).speaker, Some(0));
    let mut b = s(2.3, 3.5, "is here");
    b.unsure = vec![[0, 2]];
    let m = merge(&s(1.0, 2.0, "the ambrella"), &b);
    assert_eq!(
        (m.text.as_str(), m.unsure.as_slice()),
        ("the ambrella is here", &[[13, 15]][..])
    );
}

/// A mono WAV: a tone, silence from `quiet` to `sound` seconds, then the tone again, 3 s in all.
fn speech_with_a_pause(dir: &Path, quiet: f64, sound: f64) -> std::path::PathBuf {
    let path = dir.join("speech.wav");
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(&path, spec).unwrap();
    for i in 0..16_000 * 3 {
        let t = i as f64 / 16_000.0;
        let on = !(quiet..sound).contains(&t);
        let v = if on {
            ((t * 220.0 * std::f64::consts::TAU).sin() * 12_000.0) as i16
        } else {
            0
        };
        w.write_sample(v).unwrap();
    }
    w.finalize().unwrap();
    path
}

#[test]
fn a_cut_lands_on_the_pause_in_the_audio_and_sections_move_along() {
    let dir = tempfile::tempdir().unwrap();
    // Sentence 1 runs 2.0–3.5 here; its two halves are said with a pause 2.5–2.8.
    let audio = speech_with_a_pause(dir.path(), 2.5, 2.8);
    let mut t = transcript();
    t.sentences[1] = s(2.0, 3.0, "ああ。いいえ、違います。");
    let change = split(&mut t, 1, 3, &audio).unwrap();
    assert_eq!(
        change,
        Change {
            at: 1,
            removed: 1,
            added: 2
        }
    );
    assert_eq!(
        texts(&t),
        [
            "一。",
            "ああ。",
            "いいえ、違います。",
            "三。",
            "四。",
            "五。"
        ]
    );
    let (a, b) = (&t.sentences[1], &t.sentences[2]);
    assert_eq!(
        (a.start, round(a.end), round(b.start), b.end),
        (2.0, 2.58, 2.8, 3.0)
    );
    // The sections at sentences 2 and 4 now start one later, still named.
    assert_eq!(
        t.sections,
        [section(0, None), section(3, Some("駅で")), section(5, None)]
    );
    assert_eq!((t.source, t.edited), (Source::Imported, true));
}

#[test]
fn without_the_audio_the_cut_is_where_the_words_say() {
    let mut t = transcript();
    t.sentences[0] = s(0.0, 1.6, "はい。そうです。");
    split(&mut t, 0, 3, Path::new("/no/such.mp3")).unwrap();
    // "はい" is 2 of the 6 sounds said.
    assert_eq!(round(t.sentences[0].end), 0.53);
    assert_eq!(t.sentences[0].end, t.sentences[1].start);
    assert!(split(&mut t, 0, 0, Path::new("/no/such.mp3")).is_err());
    assert!(split(&mut t, 99, 1, Path::new("/no/such.mp3")).is_err());
}

#[test]
fn a_join_across_a_section_start_ends_that_section() {
    let mut t = transcript();
    let merged = merge(&t.sentences[1], &t.sentences[2]);
    let change = replace(&mut t, 1, 2, vec![merged]);
    assert_eq!(
        change,
        Change {
            at: 1,
            removed: 2,
            added: 1
        }
    );
    assert_eq!(texts(&t), ["一。", "二。三。", "四。", "五。"]);
    assert_eq!(starts(&t), [0, 3]);
    // Joining the first sentence of a section with the next keeps the section.
    let mut t = transcript();
    let merged = merge(&t.sentences[2], &t.sentences[3]);
    replace(&mut t, 2, 2, vec![merged]);
    assert_eq!(
        t.sections,
        [section(0, None), section(2, Some("駅で")), section(3, None)]
    );
}

#[test]
fn undo_puts_the_sentences_and_sections_back() {
    let before = transcript();
    let mut t = before.clone();
    let merged = merge(&t.sentences[1], &t.sentences[2]);
    replace(&mut t, 1, 2, vec![merged]);
    let change = restore(
        &mut t,
        1,
        1,
        before.sentences[1..3].to_vec(),
        before.sections.clone(),
    )
    .unwrap();
    assert_eq!(
        change,
        Change {
            at: 1,
            removed: 1,
            added: 2
        }
    );
    assert_eq!(t.sentences, before.sentences);
    assert_eq!(t.sections, before.sections);
}

#[test]
fn undo_refuses_what_no_longer_fits() {
    let mut t = transcript();
    let back = |t: &mut Transcript, at, count, sentences: Vec<Sentence>| {
        restore(t, at, count, sentences, sections::whole())
    };
    assert!(back(&mut t, 1, 0, vec![s(2.0, 3.0, "x")]).is_err());
    assert!(back(&mut t, 4, 2, vec![s(8.0, 9.0, "x")]).is_err());
    assert!(back(&mut t, 1, 1, vec![]).is_err());
    assert!(back(&mut t, 1, 1, vec![s(2.0, 3.0, " ")]).is_err());
    // Out of order with the sentences around it.
    assert!(back(&mut t, 1, 1, vec![s(5.0, 5.5, "x")]).is_err());
    assert!(back(&mut t, 1, 1, vec![s(2.0, 1.0, "x")]).is_err());
    assert_eq!(texts(&t), texts(&transcript()), "nothing changed");
    // Underlines and times that don't fit the text are dropped.
    let mut x = s(2.0, 3.0, "二");
    x.unsure = vec![[0, 1], [0, 5]];
    x.times = vec![(0, 2.1), (3, 2.5)];
    back(&mut t, 1, 1, vec![x]).unwrap();
    assert_eq!(t.sentences[1].unsure, [[0, 1]]);
    assert_eq!(t.sentences[1].times, [(0, 2.1)]);
}
