//! Tests for proofreading: what is sent, and which replies become suggestions.

use super::reply::{check, parse, Suggestion};
use super::*;

fn sentence(text: &str) -> Sentence {
    Sentence {
        start: 0.0,
        end: 1.0,
        text: text.into(),
        speaker: None,
        unsure: Vec::new(),
        times: Vec::new(),
    }
}

#[test]
fn unsure_parts_are_bracketed_in_utf16_ranges() {
    let mut s = sentence("ねえ、寝蔵アートって知ってる?");
    s.unsure = vec![[4, 5]];
    assert_eq!(marked(&s), "ねえ、寝〔蔵〕アートって知ってる?");
    let mut s = sentence("𠮷野家と来た");
    s.unsure = vec![[2, 3], [5, 6], [9, 12]];
    assert_eq!(marked(&s), "𠮷〔野〕家と〔来〕た");
}

#[test]
fn long_transcripts_go_in_chunks_with_context_around_them() {
    let line = "あ".repeat(1500);
    let sentences: Vec<Sentence> = (0..7).map(|_| sentence(&line)).collect();
    let parts = chunks(&sentences);
    assert_eq!(parts, [0..2, 2..4, 4..6, 6..7]);
    let message = user_message(&sentences, &parts[1]);
    assert!(message.starts_with("Fix only lines 2–3; the others are context.\n\n0: "));
    assert!(message.ends_with(&format!("6: {line}")));

    let short = [sentence("一行目。"), sentence("二行目。")];
    assert_eq!(chunks(&short), vec![0..2usize]);
    assert_eq!(user_message(&short, &(0..2)), "0: 一行目。\n1: 二行目。");
    assert!(chunks(&[]).is_empty());
}

#[test]
fn replies_are_read_through_fences_prose_and_string_ids() {
    let sentences = [
        sentence("ねえ、寝蔵アートって知ってる?"),
        sentence("ん?寝蔵アート?"),
    ];
    let reply = "Here you go:\n```json\n{\"fixes\": [{\"id\": \"1\", \"from\": \"寝蔵\", \"to\": \"寝相\", \"reason\": \"睡相\"}]}\n```";
    assert_eq!(
        check(&sentences, 0..2, parse(reply).unwrap()),
        [Suggestion {
            index: 1,
            from: "寝蔵".into(),
            to: "寝相".into(),
            reason: "睡相".into()
        }]
    );
    assert!(parse(r#"{"fixes": []}"#).unwrap().is_empty());
    assert!(parse("I could not find anything.").is_err());
    assert!(parse("} nope {").is_err());
}

#[test]
fn only_small_exact_fixes_in_the_chunk_survive() {
    let sentences = [
        sentence("ねえ、寝蔵アート"),
        sentence("寝蔵と寝蔵"),
        sentence("何それ?"),
        sentence("私、これが来たいなー。"),
    ];
    let fix = |id: usize, from: &str, to: &str| {
        format!(r#"{{"id": {id}, "from": "{from}", "to": "{to}"}}"#)
    };
    let fixes = [
        fix(0, "寝〔蔵〕", "寝相"),    // brackets copied by mistake: still fine
        fix(0, "寝〔蔵〕", "寝相"),    // the same fix twice
        fix(1, "寝蔵", "寝相"),        // ambiguous: twice in the line
        fix(2, "何それ?", "何それ？"), // punctuation only
        fix(2, "それ", ""),            // deleting words
        fix(3, "これが来たいなー", "これが着たいと思っているのですが"), // a rewrite
        fix(3, "来たい", "着たい"),
        fix(3, "見たい", "着たい"), // not in the line
        fix(9, "x", "y"),           // no such line
    ];
    let reply = format!(r#"{{"fixes": [{}]}}"#, fixes.join(","));
    let got: Vec<(usize, String, String)> = check(&sentences, 0..4, parse(&reply).unwrap())
        .into_iter()
        .map(|s| (s.index, s.from, s.to))
        .collect();
    assert_eq!(
        got,
        [
            (0, "寝蔵".into(), "寝相".into()),
            (3, "来たい".into(), "着たい".into())
        ]
    );
    // Lines sent only as context are not the chunk's to fix.
    let reply = format!(r#"{{"fixes": [{}]}}"#, fix(3, "来たい", "着たい"));
    assert!(check(&sentences, 0..3, parse(&reply).unwrap()).is_empty());
}

#[test]
fn reasons_come_in_english_when_the_interface_is() {
    let en = super::system(true);
    assert!(en.contains(super::REASON_EN));
    assert!(!en.contains("Simplified Chinese"));
    assert!(!en.contains("应为"));
    assert_eq!(super::system(false), super::SYSTEM);
}
