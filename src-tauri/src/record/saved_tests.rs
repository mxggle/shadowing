use super::*;
use crate::audio::decode::Decoder;

fn take(id: &str) -> Take {
    Take {
        id: id.into(),
        created: 1,
        start: 1.0,
        end: 2.5,
        text: "こんにちは".into(),
        mode: Mode::Shadow,
        rate: 0.85,
        duration: 0.5,
        original: (0.0, 0.2),
        mine: (0.25, 0.5),
        lag_ms: None,
        peaks: Peaks {
            original: vec![1, 2],
            mine: vec![3],
        },
        group: None,
        source: None,
        bluetooth: false,
    }
}

#[test]
fn add_list_delete() {
    let root = tempfile::tempdir().unwrap();
    let audio = "/music/a.mp3";
    assert!(list(root.path(), audio).is_empty());
    let (l, r) = (vec![0.5; 16_000], vec![-0.25; 8_000]);
    add(root.path(), audio, take("t1"), &l, &r).unwrap();
    add(root.path(), audio, take("t2"), &l, &r).unwrap();
    assert_eq!(
        list(root.path(), audio)
            .iter()
            .map(|t| t.id.as_str())
            .collect::<Vec<_>>(),
        ["t1", "t2"]
    );
    assert!(list(root.path(), "/music/b.mp3").is_empty(), "per track");

    // The file reads back (边听边说: stereo), 32 kHz, left and right as written.
    let mut d = Decoder::open(&wav_path(root.path(), audio, "t1")).unwrap();
    assert_eq!((d.sample_rate, d.channels), (crate::record::take::RATE, 2));
    let mut buf = vec![0.0; 2 * 4];
    d.read(&mut buf).unwrap();
    assert!((buf[0] - 0.5).abs() < 1e-3 && (buf[1] + 0.25).abs() < 1e-3);

    delete(root.path(), audio, "t1").unwrap();
    assert_eq!(list(root.path(), audio).len(), 1);
    assert!(!wav_path(root.path(), audio, "t1").exists());
}

#[test]
fn readings_keep_their_sentence_takes() {
    let root = tempfile::tempdir().unwrap();
    let audio = "/music/a.mp3";
    add(root.path(), audio, take("solo"), &[0.1], &[0.1]).unwrap();
    let part = |t: &str| ReadPart {
        start: 1.0,
        end: 2.0,
        mine: (0.0, 1.0),
        take: Some(t.into()),
    };
    let reading = Reading {
        id: "r1".into(),
        created: 2,
        start: 1.0,
        end: 5.0,
        mode: Mode::Read,
        rate: 1.0,
        duration: 4.0,
        parts: vec![part("r1-0"), part("r1-1")],
        original_secs: 4.0,
        mine_secs: 4.5,
        lag_ms: None,
        peaks: vec![],
        bluetooth: false,
    };
    let sound = (vec![0.0; 10], vec![0.2; 10]);
    let piece = |id: &str| {
        (
            Take {
                id: id.into(),
                group: Some("r1".into()),
                ..take(id)
            },
            Some(sound.clone()),
        )
    };
    add_reading(
        root.path(),
        audio,
        reading,
        &sound,
        vec![piece("r1-0"), piece("r1-1")],
    )
    .unwrap();
    assert_eq!(list(root.path(), audio).len(), 3);
    assert_eq!(readings(root.path(), audio)[0].parts.len(), 2);

    delete(root.path(), audio, "r1-0").unwrap();
    assert_eq!(
        readings(root.path(), audio)[0].parts[0].take,
        None,
        "unlinked"
    );

    delete_reading(root.path(), audio, "r1").unwrap();
    assert_eq!(
        list(root.path(), audio)
            .iter()
            .map(|t| t.id.as_str())
            .collect::<Vec<_>>(),
        ["solo"]
    );
    assert!(readings(root.path(), audio).is_empty());
    assert!(
        !wav_path(root.path(), audio, "r1").exists()
            && !wav_path(root.path(), audio, "r1-1").exists()
    );
}

#[test]
fn a_list_that_cant_be_read_is_kept_aside_not_overwritten() {
    let root = tempfile::tempdir().unwrap();
    let audio = "/music/a.mp3";
    add(root.path(), audio, take("t1"), &[0.1], &[0.1]).unwrap();
    let path = dir(root.path(), audio).join("takes.json");
    let damaged = fs::read_to_string(&path)
        .unwrap()
        .replace("\"shadow\"", "\"humming\"");
    fs::write(&path, &damaged).unwrap();
    assert!(list(root.path(), audio).is_empty());
    let aside = dir(root.path(), audio).join("takes.corrupt.json");
    assert_eq!(
        fs::read_to_string(&aside).unwrap(),
        damaged,
        "the old list is still there"
    );
    add(root.path(), audio, take("t2"), &[0.1], &[0.1]).unwrap();
    assert_eq!(list(root.path(), audio).len(), 1);
}

#[test]
fn only_listed_takes_are_deleted() {
    let root = tempfile::tempdir().unwrap();
    let audio = "/music/a.mp3";
    add(root.path(), audio, take("t1"), &[0.1], &[0.1]).unwrap();
    let outside = root.path().join("keep.wav");
    fs::write(&outside, b"x").unwrap();
    assert!(delete(root.path(), audio, "../../keep").is_err());
    assert!(delete(root.path(), audio, "t9").is_err());
    assert!(delete_reading(root.path(), audio, "r9").is_err());
    assert!(outside.exists());
    assert_eq!(list(root.path(), audio).len(), 1);
}
