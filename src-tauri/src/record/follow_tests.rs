use super::*;

/// Feeds speech (true) and pause (false) stretches, in seconds; returns the steps and the frames they came at.
fn read(f: &mut Follow, parts: &[(bool, f64)]) -> Vec<(usize, Step)> {
    let mut at = 0;
    let mut out = Vec::new();
    for &(voiced, secs) in parts {
        for _ in 0..frames(secs) {
            if let Some(s) = f.frame(at, voiced) {
                out.push((at, s));
            }
            at += 1;
        }
    }
    out
}

#[test]
fn follows_sentence_ends_but_not_short_pauses_inside() {
    let mut f = Follow::new(vec![2.0, 1.0, 2.0]);
    let steps = read(
        &mut f,
        &[
            (false, 0.5),
            (true, 0.6), // a breath inside the first sentence: not enough said yet
            (false, 0.4),
            (true, 1.3),
            (false, 0.5), // the end of the first
            (true, 1.0),
            (false, 0.4),
            (true, 2.1),
            (false, 2.0),
        ],
    );
    let kinds: Vec<Step> = steps.iter().map(|s| s.1).collect();
    assert_eq!(kinds, [Step::Next(1), Step::Next(2), Step::Done]);
    // The first move comes 0.3 s into the pause after "1.3 s" of speech (at 2.8 s + 0.3 s).
    assert_eq!(steps[0].0, frames(3.1) - 1);
}

#[test]
fn a_slow_reader_is_given_more_time() {
    let mut f = Follow::new(vec![1.2, 1.2, 1.2]);
    read(&mut f, &[(true, 1.6), (false, 0.4)]);
    assert_eq!(f.current, 1);
    // 1.6× the original, though one sentence moves the pace at most to 1.5×.
    assert!((f.pace() - 1.5).abs() < 0.05);
    // 0.7 s then a pause: at 1.5× pace half the sentence is 0.75 s, so not yet.
    let steps = read(&mut f, &[(true, 0.7), (false, 0.4)]);
    assert!(steps.is_empty());
}

#[test]
fn jumping_by_hand() {
    let mut f = Follow::new(vec![1.0, 1.0, 1.0]);
    assert_eq!(f.jump(2, 10), Some(Step::Next(2)));
    assert_eq!(f.jump(9, 20), None, "already on the last");
    assert_eq!(f.jump(1, 30), Some(Step::Next(1)));
}

/// Someone reading `lens` (seconds of speech per sentence, breaths inside
/// as (offset, length)), pausing `gap` between sentences. Returns where
/// the highlight moved and where each sentence really ended (frames).
fn reader(lens: &[(f64, &[(f64, f64)])], gap: f64) -> (Vec<(bool, f64)>, Vec<usize>) {
    let mut parts = vec![(false, 0.5)];
    let mut ends = Vec::new();
    let mut t = 0.5;
    for &(len, breaths) in lens {
        let mut said = 0.0;
        for &(at, pause) in breaths {
            parts.extend([(true, at - said), (false, pause)]);
            t += at - said + pause;
            said = at;
        }
        parts.push((true, len - said));
        t += len - said;
        ends.push(frames(t));
        parts.push((false, gap));
        t += gap;
    }
    parts.push((false, 2.0));
    (parts, ends)
}

/// Each move lands in the pause right after the sentence before it.
fn on_time(steps: &[(usize, Step)], ends: &[usize], gap: f64) {
    let moves: Vec<usize> = steps
        .iter()
        .filter(|s| matches!(s.1, Step::Next(_)))
        .map(|s| s.0)
        .collect();
    assert_eq!(moves.len(), ends.len() - 1, "{moves:?} vs {ends:?}");
    for (m, e) in moves.iter().zip(ends) {
        assert!(
            *m > *e && *m <= e + frames(gap),
            "moved at {m}, sentence ended at {e}"
        );
    }
    assert_eq!(steps.last().map(|s| s.1), Some(Step::Done));
}

#[test]
fn a_breath_halfway_through_a_long_sentence_doesnt_move_on() {
    // The case that used to run ahead, and stay ahead: a 0.35 s breath 2.4 s into a 4 s sentence.
    let none: &[(f64, f64)] = &[];
    let (parts, ends) = reader(
        &[(4.0, &[(2.4, 0.35)]), (3.0, none), (3.0, none), (3.0, none)],
        0.5,
    );
    let mut f = Follow::new(vec![4.0, 3.0, 3.0, 3.0]);
    on_time(&read(&mut f, &parts), &ends, 0.5);
}

#[test]
fn fast_and_slow_readers_are_followed() {
    let none: &[(f64, f64)] = &[];
    let expected = vec![2.0, 3.0, 2.0, 2.5, 2.0];
    // 0.8× the original's length, short pauses.
    let fast: Vec<(f64, &[(f64, f64)])> = expected.iter().map(|e| (e * 0.8, none)).collect();
    let (parts, ends) = reader(&fast, 0.45);
    on_time(
        &read(&mut Follow::new(expected.clone()), &parts),
        &ends,
        0.45,
    );
    // 1.3×, a breath in the middle of each.
    let breaths: Vec<[(f64, f64); 1]> = expected.iter().map(|e| [(e * 0.65, 0.3)]).collect();
    let slow: Vec<(f64, &[(f64, f64)])> = expected
        .iter()
        .zip(&breaths)
        .map(|(e, b)| (e * 1.3, &b[..]))
        .collect();
    let (parts, ends) = reader(&slow, 0.6);
    on_time(&read(&mut Follow::new(expected), &parts), &ends, 0.6);
}

#[test]
fn a_very_short_sentence_is_followed() {
    let none: &[(f64, f64)] = &[];
    // "はい": 0.35 s said, 0.6 s in the original with its edges.
    let (parts, ends) = reader(&[(2.0, none), (0.35, none), (2.0, none)], 0.5);
    let mut f = Follow::new(vec![2.2, 0.6, 2.2]);
    on_time(&read(&mut f, &parts), &ends, 0.5);
}

#[test]
fn hints_are_kept_per_boundary_and_going_back_undoes_them() {
    let mut f = Follow::new(vec![1.0, 1.0, 1.0, 1.0]);
    read(&mut f, &[(true, 1.0), (false, 0.4)]);
    let first = f.followed().hints[0].expect("moved on after the first");
    f.jump(2, 200);
    assert_eq!(f.followed().hints, vec![Some(first), Some(200), None]);
    // Too early: back to the second, then on again later.
    f.jump(1, 210);
    assert_eq!(f.followed().hints, vec![Some(first), None, None]);
    f.jump(2, 300);
    assert_eq!(f.followed().hints, vec![Some(first), Some(300), None]);
}

#[test]
fn reached_counts_the_sentence_you_started() {
    let mut f = Follow::new(vec![1.0, 1.0, 1.0, 1.0]);
    assert_eq!(f.followed().reached, 0);
    read(&mut f, &[(true, 1.0), (false, 0.4)]);
    assert_eq!(
        (f.current, f.followed().reached),
        (1, 1),
        "on the second, not started"
    );
    read(&mut f, &[(true, 0.3)]);
    assert_eq!(f.followed().reached, 2);
    let mut done = Follow::new(vec![1.0]);
    read(&mut done, &[(true, 1.0), (false, 2.0)]);
    assert_eq!(done.followed().reached, 1);
}
