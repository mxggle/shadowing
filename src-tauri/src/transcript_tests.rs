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
        }],
        edited: false,
    }
}

fn edit(index: usize, text: &str) -> Edit {
    Edit {
        index,
        text: text.into(),
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
fn a_bad_edit_changes_nothing() {
    let mut t = transcript("a");
    assert!(apply_edits(&mut t, &[edit(0, "b"), edit(5, "c")]).is_err());
    assert!(apply_edits(&mut t, &[edit(0, " \n ")]).is_err());
    assert_eq!((t.sentences[0].text.as_str(), t.edited), ("a", false));
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
