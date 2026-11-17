use super::*;

fn s(text: &str) -> Sentence {
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
fn numbers_the_batch_after_its_context() {
    let sentences: Vec<Sentence> = ["一", "二", "三", "四", "五"].map(s).to_vec();
    let m = user_message(&sentences, &[3, 4]);
    assert!(m.starts_with("Earlier lines, for context only"));
    assert!(m.contains("- 一\n- 二\n- 三\n"));
    assert!(m.ends_with("Lines to translate:\n1. 四\n2. 五\n"));
    assert!(user_message(&sentences, &[0]).starts_with("Lines to translate:\n1. 一"));
}

#[test]
fn reads_numbered_answers_leniently() {
    let reply =
        "Here you go:\n```json\n{\"1\": \"今天好热\", \"3\": \" 是啊\\n真的 \", \"2\": \"\"}\n```";
    assert_eq!(
        parse(reply, 4).unwrap(),
        [
            Some("今天好热".to_string()),
            Some(String::new()),
            Some("是啊 真的".to_string()),
            None
        ]
    );
    let wrapped = r#"{"translations": {"1": "Hi"}}"#;
    assert_eq!(parse(wrapped, 1).unwrap(), [Some("Hi".to_string())]);
    assert!(parse("sorry", 1).is_err());
}

#[test]
fn only_known_languages() {
    assert_eq!(language("zh-Hans").unwrap(), "Simplified Chinese");
    assert!(language("xx").is_err());
}

#[test]
fn kept_by_text_and_language() {
    let dir = std::env::temp_dir().join(format!("shadowing-translate-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let audio = "/a/b.mp3";
    let sentences = vec![s("今日は"), s("暑いね")];
    let found = vec![
        ("今日は".into(), "今天".into()),
        ("暑いね".into(), "好热".into()),
    ];
    saved::save(&dir, audio, &sentences, "zh-Hans", found).unwrap();
    saved::save(
        &dir,
        audio,
        &sentences,
        "en",
        vec![("今日は".into(), "Today".into())],
    )
    .unwrap();
    let zh = saved::load(&dir, audio, &sentences, "zh-Hans");
    assert_eq!(zh.get("暑いね").map(String::as_str), Some("好热"));
    assert_eq!(saved::load(&dir, audio, &sentences, "en").len(), 1);
    // A corrected sentence has no translation, and saving again forgets the old text's.
    let edited = vec![s("今日は"), s("暑いよね")];
    assert_eq!(saved::load(&dir, audio, &edited, "zh-Hans").len(), 1);
    saved::save(
        &dir,
        audio,
        &edited,
        "zh-Hans",
        vec![("暑いよね".into(), "好热啊".into())],
    )
    .unwrap();
    assert_eq!(saved::load(&dir, audio, &sentences, "zh-Hans").len(), 1);
    assert!(saved::any(&dir, audio, "今日は").is_some());
    saved::remove(&dir, audio).unwrap();
    assert!(saved::load(&dir, audio, &edited, "zh-Hans").is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}
