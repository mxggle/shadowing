//! Tests for transcript.rs.

use super::*;

fn transcript(text: &str) -> Transcript {
    Transcript {
        source: Source::Imported,
        origin: "a.srt".into(),
        sentences: vec![Sentence {
            start: 1.0,
            end: 2.0,
            text: text.into(),
            speaker: None,
            unsure: Vec::new(),
            times: Vec::new(),
        }],
        edited: false,
        sections: sections::whole(),
    }
}

fn edit(index: usize, text: &str) -> Edit {
    Edit {
        index,
        text: text.into(),
        unsure: Vec::new(),
    }
}

#[test]
fn edits_change_only_the_text_and_make_the_copy_the_apps_own() {
    let mut t = transcript("寝蔵アート");
    t.source = Source::Sidecar;
    t.sentences[0].speaker = Some(1);
    assert!(!serde_json::to_string(&t).unwrap().contains("edited"));
    apply_edits(&mut t, &[edit(0, " 寝相アート\n って？ ")]).unwrap();
    let s = &t.sentences[0];
    assert_eq!(
        (s.text.as_str(), s.start, s.end, s.speaker),
        ("寝相アート って？", 1.0, 2.0, Some(1))
    );
    assert_eq!((t.source, t.edited), (Source::Imported, true));
}

#[test]
fn edits_keep_only_underlines_that_fit_the_new_text() {
    let mut t = transcript("寝蔵アート");
    t.sentences[0].unsure = vec![[1, 2]];
    apply_edits(&mut t, &[edit(0, "寝相アート")]).unwrap();
    assert!(t.sentences[0].unsure.is_empty());
    let mut kept = edit(0, "寝相アートと𠮷");
    kept.unsure = vec![[2, 5], [6, 8], [7, 9], [3, 3]];
    apply_edits(&mut t, &[kept]).unwrap();
    assert_eq!(t.sentences[0].unsure, [[2, 5], [6, 8]]);
}

#[test]
fn a_bad_edit_changes_nothing() {
    let mut t = transcript("a");
    assert!(apply_edits(&mut t, &[edit(0, "b"), edit(5, "c")]).is_err());
    assert!(apply_edits(&mut t, &[edit(0, " \n ")]).is_err());
    assert_eq!((t.sentences[0].text.as_str(), t.edited), ("a", false));
}

#[test]
fn character_times_move_with_an_edit_and_are_saved_as_pairs() {
    let mut t = transcript("寝蔵アート");
    assert!(!serde_json::to_string(&t).unwrap().contains("times"));
    t.sentences[0].times = vec![(0, 1.0), (1, 1.25), (2, 1.5), (4, 1.75)];
    apply_edits(&mut t, &[edit(0, "あ、寝相アート")]).unwrap();
    assert_eq!(
        t.sentences[0].times,
        [(2, 1.0), (3, 1.25), (4, 1.5), (6, 1.75)]
    );
    let json = serde_json::to_string(&t.sentences[0]).unwrap();
    assert!(
        json.contains(r#""times":[[2,1.0],[3,1.25],[4,1.5],[6,1.75]]"#),
        "{json}"
    );
    let back: Sentence = serde_json::from_str(&json).unwrap();
    assert_eq!(back.times, t.sentences[0].times);
}

#[test]
fn save_load_remove_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    assert!(load(dir.path(), "/m/a.mp3").is_none());
    save(dir.path(), "/m/a.mp3", &transcript("hi")).unwrap();
    assert_eq!(
        load(dir.path(), "/m/a.mp3").unwrap().sentences[0].text,
        "hi"
    );
    assert!(load(dir.path(), "/m/b.mp3").is_none());
    remove(dir.path(), "/m/a.mp3").unwrap();
    remove(dir.path(), "/m/a.mp3").unwrap(); // already gone is fine
    assert!(load(dir.path(), "/m/a.mp3").is_none());
}

#[test]
fn files_from_before_sections_get_them_on_load_and_bad_ones_are_repaired() {
    let dir = tempfile::tempdir().unwrap();
    let old = r#"{"version":1,"audio":"/m/a.mp3","transcript":{"source":"transcribed","origin":"x",
        "sentences":[{"start":0,"end":1,"text":"a"},{"start":1.2,"end":2,"text":"b"}]}}"#;
    fs::write(stored_path(dir.path(), "/m/a.mp3"), old).unwrap();
    assert_eq!(
        load(dir.path(), "/m/a.mp3").unwrap().sections,
        sections::whole()
    );

    let mut t = transcript("hi");
    t.sections = vec![Section {
        start: 3,
        title: Some(" 会話 ".into()),
    }];
    save(dir.path(), "/m/a.mp3", &t).unwrap();
    assert_eq!(
        load(dir.path(), "/m/a.mp3").unwrap().sections,
        sections::whole()
    );
}

#[test]
fn sidecar_prefers_exact_name_then_language_tags() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    let audio = d.join("ep1.mp3");
    for f in [
        "ep1.mp3",
        "ep1.5.mp3",
        "ep10.srt",
        "ep1.notes.txt",
        "ep1.5.srt",
    ] {
        fs::write(d.join(f), b"x").unwrap();
    }
    assert!(find_sidecar(&audio).is_none());
    fs::write(d.join("ep1.ja.vtt"), b"x").unwrap();
    assert_eq!(find_sidecar(&audio).unwrap(), d.join("ep1.ja.vtt"));
    fs::write(d.join("ep1.SRT"), b"x").unwrap();
    assert_eq!(find_sidecar(&audio).unwrap(), d.join("ep1.SRT"));
    assert!(find_sidecar(&d.join("ep2.mp3")).is_none());
}

#[test]
fn reads_subtitle_with_origin() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lesson.srt");
    fs::write(&path, "1\n00:00:00,500 --> 00:00:01,000\nこんにちは\n").unwrap();
    let t = read_subtitle(&path, Source::Sidecar).unwrap();
    assert_eq!((t.origin.as_str(), t.sentences.len()), ("lesson.srt", 1));
}
