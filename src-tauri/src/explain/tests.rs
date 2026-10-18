//! Tests for explanations: what is sent, and which replies are shown.

use super::reply::{parse, Part};
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
{"translation": " 今天去散步吧。 ", "parts": [
  {"text": "今日は", "reading": "きょうは", "meaning": "今天", "note": ""},
  {"text": "", "meaning": "空"},
  {"text": "散歩に", "reading": "さんぽに"},
  {"text": "公園", "reading": "こうえん", "meaning": "公园"},
  {"text": "行きましょう ", "reading": "いきましょう", "meaning": "", "note": " 提议一起做 "}
], "tone": " 轻松地提议 "}
```"#;
    let e = parse(reply, "今日は散歩に行きましょう。").unwrap();
    assert_eq!(e.translation, "今天去散步吧。");
    assert_eq!(e.tone, "轻松地提议");
    assert_eq!(
        e.parts,
        [
            Part {
                text: "今日は".into(),
                reading: "きょうは".into(),
                meaning: "今天".into(),
                note: "".into(),
            },
            Part {
                text: "行きましょう".into(),
                reading: "いきましょう".into(),
                meaning: "".into(),
                note: "提议一起做".into(),
            }
        ]
    );
}

#[test]
fn pieces_are_optional_and_capped() {
    let e = parse(r#"{"translation": "你好"}"#, "").unwrap();
    assert!(e.parts.is_empty() && e.tone.is_empty());
    let many: Vec<String> = (0..20)
        .map(|i| format!(r#"{{"text": "W{i}", "meaning": "m"}}"#))
        .collect();
    let sentence = (0..20)
        .map(|i| format!("w{i}"))
        .collect::<Vec<_>>()
        .join(" ");
    let e = parse(
        &format!(r#"{{"translation": "x", "parts": [{}]}}"#, many.join(",")),
        &sentence,
    )
    .unwrap();
    assert_eq!(e.parts.len(), 12);
    assert_eq!(e.parts[11].text, "W11");
}

#[test]
fn a_slip_in_one_piece_does_not_cost_the_answer() {
    // A repeated key (the last one counts), a null, a number, and the comma a piece was cut with.
    let reply = r#"{"translation": "据说在收集。", "tone": null, "parts": [
  {"text": "収集していたと", "reading": null, "note": "正在收集", "note": "ていた 表示过去持续"},
  {"text": "記者について、", "reading": "きしゃについて、", "meaning": "关于记者", "note": 3},
  {"text": "帰ってくる", "reading": "かえってくる", "meaning": "回来", "note": "回来"}
]}"#;
    let e = parse(reply, "記者について、収集していたと。帰ってくる").unwrap();
    assert_eq!(e.tone, "");
    let parts: Vec<_> = e
        .parts
        .iter()
        .map(|p| [&p.text[..], &p.reading, &p.meaning, &p.note])
        .collect();
    assert_eq!(
        parts,
        [
            ["収集していたと", "", "", "ていた 表示过去持续"],
            ["記者について", "きしゃについて", "关于记者", ""],
            ["帰ってくる", "かえってくる", "回来", ""],
        ]
    );
}

#[test]
fn a_reply_without_a_translation_is_not_an_explanation() {
    for bad in [
        "天气真好",
        "{}",
        r#"{"translation": "  "}"#,
        r#"{"translation": 3}"#,
    ] {
        assert!(parse(bad, "x").is_err(), "{bad}");
    }
}

fn answer(index: usize, text: &str, translation: &str) -> saved::Saved {
    saved::Saved {
        index,
        text: text.into(),
        lang: "zh".into(),
        explanation: super::Explanation {
            translation: translation.into(),
            ..Default::default()
        },
    }
}

#[test]
fn answers_are_kept_per_track_and_only_while_the_sentence_is_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let all = sentences(4);
    saved::save(dir.path(), "/a.mp3", &all, answer(1, "line 1", "一")).unwrap();
    saved::save(dir.path(), "/a.mp3", &all, answer(2, "line 2", "二")).unwrap();
    // Asking again replaces the earlier answer for that sentence.
    saved::save(dir.path(), "/a.mp3", &all, answer(1, "line 1", "一（新）")).unwrap();
    let kept = saved::load(dir.path(), "/a.mp3", &all);
    assert_eq!(
        kept.iter()
            .map(|a| (a.index, a.explanation.translation.as_str()))
            .collect::<Vec<_>>(),
        [(2, "二"), (1, "一（新）")]
    );
    assert!(saved::load(dir.path(), "/b.mp3", &all).is_empty());

    // Sentence 2 was corrected: its answer is no longer given back, and the next save drops it.
    let mut edited = all.clone();
    edited[2].text = "line two".into();
    assert_eq!(saved::load(dir.path(), "/a.mp3", &edited).len(), 1);
    saved::save(dir.path(), "/a.mp3", &edited, answer(3, "line 3", "三")).unwrap();
    assert_eq!(saved::load(dir.path(), "/a.mp3", &all).len(), 2);
    assert!(saved::load(dir.path(), "/a.mp3", &all)
        .iter()
        .all(|a| a.index != 2));

    saved::remove(dir.path(), "/a.mp3").unwrap();
    assert!(saved::load(dir.path(), "/a.mp3", &all).is_empty());
    saved::remove(dir.path(), "/a.mp3").unwrap();
}

#[test]
fn an_answer_in_the_other_language_does_not_replace_this_one() {
    let dir = tempfile::tempdir().unwrap();
    let all = sentences(2);
    saved::save(dir.path(), "/a.mp3", &all, answer(1, "line 1", "一")).unwrap();
    let english = saved::Saved {
        lang: "en".into(),
        ..answer(1, "line 1", "one")
    };
    saved::save(dir.path(), "/a.mp3", &all, english).unwrap();
    // The tests run with the interface in Chinese.
    let kept = saved::load(dir.path(), "/a.mp3", &all);
    assert_eq!(kept.len(), 1);
    assert_eq!(kept[0].explanation.translation, "一");
}

#[test]
fn answers_in_the_old_format_are_asked_again() {
    let dir = tempfile::tempdir().unwrap();
    let all = sentences(2);
    saved::save(dir.path(), "/a.mp3", &all, answer(0, "line 0", "零")).unwrap();
    let file = std::fs::read_dir(dir.path())
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let v1 = std::fs::read_to_string(&file)
        .unwrap()
        .replace(r#""version":2"#, r#""version":1"#);
    std::fs::write(&file, v1).unwrap();
    assert!(saved::load(dir.path(), "/a.mp3", &all).is_empty());
}

#[test]
fn a_damaged_file_means_no_answers_not_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let all = sentences(2);
    saved::save(dir.path(), "/a.mp3", &all, answer(0, "line 0", "零")).unwrap();
    let file = std::fs::read_dir(dir.path())
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    std::fs::write(&file, "{not json").unwrap();
    assert!(saved::load(dir.path(), "/a.mp3", &all).is_empty());
    saved::save(dir.path(), "/a.mp3", &all, answer(0, "line 0", "零")).unwrap();
    assert_eq!(saved::load(dir.path(), "/a.mp3", &all).len(), 1);
}

#[test]
fn answers_move_with_their_sentences_when_one_is_cut_in_two() {
    let dir = tempfile::tempdir().unwrap();
    let all = sentences(4);
    for (i, zh) in ["零", "一", "二", "三"].iter().enumerate() {
        saved::save(
            dir.path(),
            "/a.mp3",
            &all,
            answer(i, &format!("line {i}"), zh),
        )
        .unwrap();
    }
    // Sentence 1 cut in two: the ones after it move down one; its own answer
    // waits at the first part, where it no longer matches.
    saved::follow(dir.path(), "/a.mp3", |i| if i <= 1 { i } else { i + 1 }).unwrap();
    let mut cut = all.clone();
    cut.splice(1..2, [all[1].clone(), all[1].clone()]);
    cut[1].text = "li".into();
    cut[2].text = "ne 1".into();
    let kept = |sentences: &[Sentence]| -> Vec<(usize, String)> {
        saved::load(dir.path(), "/a.mp3", sentences)
            .into_iter()
            .map(|a| (a.index, a.explanation.translation))
            .collect()
    };
    assert_eq!(
        kept(&cut),
        [(0, "零".into()), (3, "二".into()), (4, "三".into())]
    );
    // ⌘Z: the sentence is back as it was, and so is its answer.
    saved::follow(
        dir.path(),
        "/a.mp3",
        |i| if i <= 2 { i.min(1) } else { i - 1 },
    )
    .unwrap();
    assert_eq!(kept(&all).len(), 4);
    // Nothing kept: nothing written.
    saved::follow(dir.path(), "/b.mp3", |i| i).unwrap();
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}
