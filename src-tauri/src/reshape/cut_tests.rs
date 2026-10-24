//! Tests for cut.rs.

use super::*;

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

fn round(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

#[test]
fn cuts_where_the_cursor_is_and_trims_both_parts() {
    let cut = |text: &str, at| cut_text(text, at).map(|c| (c.first, c.second, c.second_from));
    let ja = "おはようございます。今日もよろしく。";
    assert_eq!(
        cut(ja, 10),
        Some(("おはようございます。".into(), "今日もよろしく。".into(), 10))
    );
    let en = "Hello there. How are you?";
    assert_eq!(
        cut(en, 12),
        Some(("Hello there.".into(), "How are you?".into(), 13))
    );
    assert_eq!(
        cut(en, 13),
        Some(("Hello there.".into(), "How are you?".into(), 13))
    );
    // Nothing to say on one side: not a cut.
    assert_eq!(cut(ja, 0), None);
    assert_eq!(cut(ja, 18), None);
    assert_eq!(cut(ja, 99), None);
    assert_eq!(cut("「はい」", 1), None);
    // A character outside the BMP is two units; inside it counts as before it.
    assert_eq!(cut("𠮷野家です", 1), None);
    assert_eq!(
        cut("𠮷野家です", 2),
        Some(("𠮷".into(), "野家です".into(), 2))
    );
}

#[test]
fn a_cut_shares_out_the_underlines_and_times_by_where_they_are() {
    let mut x = s(1.0, 4.0, "傘を持ってきましたか？");
    x.unsure = vec![[0, 1], [3, 6]];
    x.speaker = Some(2);
    x.times = vec![(0, 1.0), (3, 1.8), (4, 2.3), (9, 3.5)];
    let [a, b] = halves(&x, cut_text(&x.text, 4).unwrap(), (2.0, 2.2));
    assert_eq!(
        (a.start, a.end, a.text.as_str(), a.unsure.as_slice()),
        (1.0, 2.0, "傘を持っ", &[[0, 1], [3, 4]][..])
    );
    assert_eq!(
        (b.start, b.end, b.text.as_str(), b.unsure.as_slice()),
        (2.2, 4.0, "てきましたか？", &[[0, 2]][..])
    );
    assert_eq!(
        (a.times.as_slice(), b.times.as_slice()),
        (&[(0, 1.0), (3, 1.8)][..], &[(0, 2.3), (5, 3.5)][..])
    );
    assert_eq!((a.speaker, b.speaker), (Some(2), Some(2)));
    // The space trimmed from the start of the second part shifts its underlines.
    let mut x = s(0.0, 3.0, "I want ambrella now");
    x.unsure = vec![[7, 15]];
    let [a, b] = halves(&x, cut_text(&x.text, 6).unwrap(), (1.0, 1.0));
    assert!(a.unsure.is_empty());
    assert_eq!(
        (b.text.as_str(), b.unsure.as_slice()),
        ("ambrella now", &[[0, 8]][..])
    );
}

#[test]
fn the_cut_is_guessed_from_how_far_through_the_words_it_is() {
    let mut x = s(10.0, 13.0, "おはよう。元気？");
    let cut = cut_text(&x.text, 5).unwrap();
    assert!((ratio(&x, &cut) - 4.0 / 6.0).abs() < 1e-9);
    // Timed by transcription: when 元 is said.
    x.times = vec![
        (0, 10.0),
        (1, 10.2),
        (2, 10.4),
        (3, 10.6),
        (5, 12.4),
        (6, 12.6),
    ];
    assert!((ratio(&x, &cut) - 0.8).abs() < 1e-9);
    // Six seconds: looked for up to 1.5 s either way (30% would be more).
    let (t, lo, hi) = guess(&s(10.0, 16.0, ""), 0.5);
    assert_eq!((t, round(lo), round(hi)), (13.0, 11.5, 14.5));
    // Two seconds: 0.6 s either way, never closer than 0.1 s to an end.
    let (t, lo, hi) = guess(&s(0.0, 2.0, ""), 0.9);
    assert_eq!((round(t), round(lo), round(hi)), (1.8, 1.2, 1.9));
    let (t, _, _) = guess(&s(0.0, 2.0, ""), 0.01);
    assert_eq!(round(t), 0.1, "not right at the start");
    let (t, lo, hi) = guess(&s(5.0, 5.1, ""), 0.9);
    assert!(
        (t - 5.05).abs() < 1e-9 && hi < lo,
        "too short to look: the middle"
    );
}

/// Loudness track from (seconds, dB) spans.
fn track(spans: &[(f64, f32)]) -> Vec<f32> {
    spans
        .iter()
        .flat_map(|&(secs, db)| std::iter::repeat_n(db, (secs / snap::FRAME_SECS).round() as usize))
        .collect()
}

#[test]
fn the_cut_moves_onto_a_pause_near_the_guess() {
    // From 10 s: speech, a pause 10.9–11.2, speech.
    let db = track(&[(0.9, -20.0), (0.3, -65.0), (1.2, -20.0)]);
    let (end, start) = cut_times(11.5, 10.0, 12.4, &db, 10.0);
    assert_eq!((round(end), round(start)), (10.98, 11.2));
    // All speech: right at the guess.
    assert_eq!(
        cut_times(11.5, 10.0, 12.4, &track(&[(2.4, -20.0)]), 10.0),
        (11.5, 11.5)
    );
    assert_eq!(
        cut_times(11.5, 10.0, 12.4, &[], 10.0),
        (11.5, 11.5),
        "audio that couldn't be read"
    );
}

#[test]
fn a_pause_is_followed_out_past_where_it_was_looked_for() {
    // A pause 11.0–11.5; looked for in 10.2–11.2, so only its start is in reach.
    let db = track(&[(1.0, -20.0), (0.5, -65.0), (1.0, -20.0)]);
    let (end, start) = cut_times(10.7, 10.2, 11.2, &db, 10.0);
    assert_eq!((round(end), round(start)), (11.08, 11.5));
    // Out of reach: not used.
    assert_eq!(cut_times(10.4, 10.0, 10.8, &db, 10.0), (10.4, 10.4));
}

#[test]
fn a_moment_of_digital_silence_doesnt_hide_the_pause() {
    // A dropout at 10.5 s far quieter than the pause at 11.0–11.3 s.
    let db = track(&[
        (0.5, -20.0),
        (0.02, -100.0),
        (0.48, -20.0),
        (0.3, -60.0),
        (0.7, -20.0),
    ]);
    let (end, start) = cut_times(11.1, 10.0, 12.0, &db, 10.0);
    assert_eq!((round(end), round(start)), (11.08, 11.3));
}

#[test]
fn the_quiet_before_the_first_word_or_after_the_last_is_no_place_to_cut() {
    // Silence, speech, a pause 11.5–11.7, speech, silence: the sentence's
    // times reach past its words (as a subtitle file's can).
    let db = track(&[
        (0.3, -90.0),
        (1.2, -20.0),
        (0.2, -65.0),
        (0.8, -20.0),
        (0.5, -90.0),
    ]);
    for t in [10.4, 12.4] {
        let (end, start) = cut_times(t, 10.0, 13.0, &db, 10.0);
        assert_eq!((round(end), round(start)), (11.58, 11.7), "guessed at {t}");
    }
}

#[test]
fn a_longer_pause_further_away_wins_only_by_enough() {
    // A short pause 10.4–10.56 and a longer one 11.5–11.9.
    let db = track(&[
        (0.4, -20.0),
        (0.16, -60.0),
        (0.94, -20.0),
        (0.4, -60.0),
        (0.5, -20.0),
    ]);
    let (_, near) = cut_times(10.6, 10.0, 12.4, &db, 10.0);
    assert_eq!(round(near), 10.56);
    let (_, far) = cut_times(11.0, 10.0, 12.4, &db, 10.0);
    assert_eq!(round(far), 11.9);
}
