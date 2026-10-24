//! Tests for sentences.rs.

use super::*;

fn seg(start: f64, end: f64, text: &str) -> Segment {
    Segment {
        start,
        end,
        text: text.into(),
        avg_logprob: Some(-0.2),
        no_speech_prob: Some(0.01),
    }
}

fn words(list: &[(&str, f64, f64)]) -> Vec<Word> {
    list.iter()
        .map(|&(w, start, end)| Word {
            word: w.into(),
            start,
            end,
            probability: None,
        })
        .collect()
}

fn summary(s: &[Sentence]) -> Vec<(String, f64, f64)> {
    s.iter()
        .map(|s| {
            (
                s.text.clone(),
                (s.start * 100.0).round() / 100.0,
                (s.end * 100.0).round() / 100.0,
            )
        })
        .collect()
}

#[test]
fn english_sentences_take_their_words_times() {
    let v = Verbose {
        segments: vec![
            seg(0.0, 3.0, " Hello there. How are"),
            seg(3.0, 5.0, " you? Fine."),
        ],
        words: words(&[
            ("Hello", 0.2, 0.6),
            ("there", 0.7, 1.1),
            ("How", 1.8, 2.0),
            ("are", 2.0, 2.3),
            ("you", 3.1, 3.4),
            ("Fine", 4.2, 4.6),
        ]),
    };
    let built = build(vec![(0.0, v)], &[]);
    assert_eq!(
        summary(&built),
        [
            ("Hello there.".into(), 0.2, 1.1),
            ("How are you?".into(), 1.8, 3.4),
            ("Fine.".into(), 4.2, 4.6)
        ]
    );
    // A word at a time.
    assert_eq!(built[1].times, [(0, 1.8), (4, 2.0), (8, 3.1)]);
}

#[test]
fn japanese_without_spaces() {
    let v = Verbose {
        segments: vec![
            seg(0.0, 4.0, "今日はいい天気ですね。散歩に"),
            seg(4.0, 6.0, "行きましょう。"),
        ],
        words: words(&[
            ("今日", 0.0, 0.5),
            ("は", 0.5, 0.7),
            ("いい", 0.7, 1.0),
            ("天気", 1.0, 1.5),
            ("ですね", 1.5, 2.2),
            ("散歩", 2.8, 3.3),
            ("に", 3.3, 3.5),
            ("行きましょう", 4.1, 5.2),
        ]),
    };
    let built = build(vec![(0.0, v)], &[]);
    assert_eq!(
        summary(&built),
        [
            ("今日はいい天気ですね。".into(), 0.0, 2.2),
            ("散歩に行きましょう。".into(), 2.8, 5.2)
        ]
    );
    // Each character is timed, spread across its word.
    assert_eq!(
        built[0].times,
        [
            (0, 0.0),
            (1, 0.25),
            (2, 0.5),
            (3, 0.7),
            (4, 0.85),
            (5, 1.0),
            (6, 1.25),
            (7, 1.5),
            (8, 1.73),
            (9, 1.97)
        ]
    );
    assert_eq!(built[1].times[2..5], [(2, 3.3), (3, 4.1), (4, 4.28)]);
}

#[test]
fn letters_of_a_word_that_runs_on_over_a_pause_stay_together() {
    let v = Verbose {
        segments: vec![seg(0.0, 4.0, "はい。")],
        words: words(&[("はい", 1.0, 4.0)]),
    };
    assert_eq!(build(vec![(0.0, v)], &[])[0].times, [(0, 1.0), (1, 1.3)]);
}

#[test]
fn pieces_are_offset_and_hallucinations_dropped() {
    let first = Verbose {
        segments: vec![seg(0.0, 2.0, " One.")],
        words: words(&[("One", 0.5, 1.0)]),
    };
    let mut fake = seg(3.0, 6.0, "ご視聴ありがとうございました");
    fake.no_speech_prob = Some(0.9);
    fake.avg_logprob = Some(-1.4);
    let second = Verbose {
        segments: vec![seg(0.0, 2.0, " Two."), fake],
        words: words(&[
            ("Two", 0.4, 0.9),
            ("ご視聴", 3.0, 4.0),
            ("ありがとうございました", 4.0, 6.0),
        ]),
    };
    assert_eq!(
        summary(&build(vec![(0.0, first), (600.0, second)], &[])),
        [("One.".into(), 0.5, 1.0), ("Two.".into(), 600.4, 600.9)]
    );
}

#[test]
fn without_words_times_are_spread_over_the_segment() {
    let v = Verbose {
        segments: vec![seg(0.0, 4.0, "Aa. Bb.")],
        words: vec![],
    };
    let built = build(vec![(0.0, v)], &[]);
    assert_eq!(
        summary(&built),
        [("Aa.".into(), 0.0, 2.0), ("Bb.".into(), 2.0, 4.0)]
    );
    assert!(
        built.iter().all(|s| s.times.is_empty()),
        "no character times"
    );
}

#[test]
fn abbreviations_decimals_and_quotes_stay_together() {
    assert_eq!(
        split_sentences("Mr. Smith paid 3.5 dollars. \"Really?\" she asked. 「はい。」そうです…"),
        [
            "Mr. Smith paid 3.5 dollars.",
            "\"Really?\"",
            "she asked.",
            "「はい。」",
            "そうです…"
        ]
    );
}

#[test]
fn long_sentences_split_at_the_middle_comma() {
    let text = "one two, three four, five six";
    let v = Verbose {
        segments: vec![seg(0.0, 30.0, text)],
        words: vec![],
    };
    let got = summary(&build(vec![(0.0, v)], &[]));
    assert_eq!(
        got.iter().map(|g| g.0.as_str()).collect::<Vec<_>>(),
        ["one two,", "three four,", "five six"]
    );
    assert!(got.windows(2).all(|w| w[0].2 <= w[1].1 + 1e-9));
}

#[test]
fn unpunctuated_segments_are_sentences_of_their_own() {
    // What large-v3-turbo returns for a Japanese dialogue without a language hint.
    let v = Verbose {
        segments: vec![
            seg(0.0, 4.3, "あーどうしようたかしの熱が下がらない"),
            seg(4.3, 7.1, "今日は日曜日だしな"),
            seg(7.1, 10.0, "病院はどこもお休みだろ"),
            seg(10.0, 14.4, "ん?寝蔵アート?何それ?"),
        ],
        words: vec![],
    };
    let got = build(vec![(0.0, v)], &[]);
    assert_eq!(
        got.iter().map(|s| s.text.as_str()).collect::<Vec<_>>(),
        [
            "あーどうしようたかしの熱が下がらない",
            "今日は日曜日だしな",
            "病院はどこもお休みだろ",
            "ん?",
            "寝蔵アート?",
            "何それ?"
        ]
    );
}

#[test]
fn unpunctuated_english_carries_on_into_a_lowercase_segment() {
    let v = Verbose {
        segments: vec![
            seg(0.0, 2.0, " So I went to the"),
            seg(2.0, 4.0, " store and bought milk"),
            seg(4.0, 6.0, " Then I came home"),
        ],
        words: vec![],
    };
    let got = build(vec![(0.0, v)], &[]);
    assert_eq!(
        got.iter().map(|s| s.text.as_str()).collect::<Vec<_>>(),
        ["So I went to the store and bought milk", "Then I came home"]
    );
}

#[test]
fn a_space_between_cjk_characters_ends_a_sentence() {
    assert_eq!(
        split_sentences("来週はパーティーですね そうですね 今 SNS で話題"),
        ["来週はパーティーですね", "そうですね", "今 SNS で話題"]
    );
}

#[test]
fn long_sentences_without_a_comma_split_at_the_pause() {
    // 20 s of speech, quiet from 12.0 to 12.6 s.
    let frame = 0.02;
    let db: Vec<f32> = (0..1000)
        .map(|i| {
            let t = i as f64 * frame;
            if (12.0..12.6).contains(&t) {
                -70.0
            } else {
                -20.0
            }
        })
        .collect();
    let v = Verbose {
        segments: vec![seg(0.0, 20.0, "あいうえおかきくけこさしすせそたちつてと")],
        words: words(&[
            ("あいうえおかきくけこさし", 0.0, 12.0),
            ("すせそたちつてと", 12.6, 20.0),
        ]),
    };
    let got = summary(&build(vec![(0.0, v)], &db));
    assert_eq!(
        got,
        [
            ("あいうえおかきくけこさし".into(), 0.0, 12.0),
            ("すせそたちつてと".into(), 12.6, 20.0)
        ]
    );
}
