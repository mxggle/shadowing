//! Tests for explanations: what is sent, and which replies are shown.

use super::reply::{parse, Point, Word};
use super::*;

fn sentences(n: usize) -> Vec<Sentence> {
    (0..n)
        .map(|i| Sentence {
            start: i as f64,
            end: i as f64 + 1.0,
            text: format!("line {i}"),
            speaker: None,
            unsure: Vec::new(),
        })
        .collect()
}

#[test]
fn the_sentence_is_sent_with_a_few_lines_around_it() {
    let all = sentences(10);
    assert_eq!(
        user_message(&all, 5),
        "Lines before it:\n- line 2\n- line 3\n- line 4\n\nSentence to explain:\nline 5\n\nLines after it:\n- line 6\n- line 7"
    );
    assert_eq!(
        user_message(&all, 0),
        "Sentence to explain:\nline 0\n\nLines after it:\n- line 1\n- line 2"
    );
    assert_eq!(
        user_message(&all, 9),
        "Lines before it:\n- line 6\n- line 7\n- line 8\n\nSentence to explain:\nline 9"
    );
    assert_eq!(
        user_message(&sentences(1), 0),
        "Sentence to explain:\nline 0"
    );
}

#[test]
fn reads_a_reply_wrapped_in_a_fence_and_tidies_it() {
    let reply = r#"好的:
```json
{"translation": " 今天天气真好。 ", "words": [
  {"word": "散歩", "reading": "さんぽ", "meaning": "散步"},
  {"word": "", "meaning": "空"},
  {"word": "天気", "reading": "てんき"}
], "points": [
  {"point": "〜ましょう", "note": "提议一起做"},
  {"point": "は", "note": ""}
]}
```"#;
    let e = parse(reply).unwrap();
    assert_eq!(e.translation, "今天天气真好。");
    assert_eq!(
        e.words,
        [Word {
            word: "散歩".into(),
            reading: "さんぽ".into(),
            meaning: "散步".into()
        }]
    );
    assert_eq!(
        e.points,
        [Point {
            point: "〜ましょう".into(),
            note: "提议一起做".into()
        }]
    );
}

#[test]
fn lists_are_optional_and_capped() {
    let e = parse(r#"{"translation": "你好"}"#).unwrap();
    assert!(e.words.is_empty() && e.points.is_empty());
    let many: Vec<String> = (0..12)
        .map(|i| format!(r#"{{"word": "w{i}", "meaning": "m"}}"#))
        .collect();
    let e = parse(&format!(
        r#"{{"translation": "x", "words": [{}]}}"#,
        many.join(",")
    ))
    .unwrap();
    assert_eq!(e.words.len(), 8);
    assert_eq!(e.words[7].word, "w7");
}

#[test]
fn a_reply_without_a_translation_is_not_an_explanation() {
    for bad in [
        "天气真好",
        "{}",
        r#"{"translation": "  "}"#,
        r#"{"translation": 3}"#,
    ] {
        assert!(parse(bad).is_err(), "{bad}");
    }
}
