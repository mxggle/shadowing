use super::*;

const S: u64 = 1000;
const T0: u64 = 1_760_000_000_000;

/// Status events every 100 ms while playing from `from` to `to` (seconds after T0).
fn play(c: &mut Clock, seq: &mut u64, audio: &str, from: u64, to: u64) {
    let mut t = T0 + from * S;
    while t <= T0 + to * S {
        *seq += 1;
        c.status(t, *seq, Some(audio), true);
        t += 100;
    }
    *seq += 1;
    c.status(T0 + to * S, *seq, Some(audio), false);
}

#[test]
fn short_pauses_count_long_ones_split() {
    let (mut c, mut seq) = (Clock::default(), 0);
    play(&mut c, &mut seq, "/a.mp3", 0, 10);
    // Paused 20 s to repeat the sentence, then played again.
    play(&mut c, &mut seq, "/a.mp3", 30, 40);
    // Walked away for 10 minutes.
    play(&mut c, &mut seq, "/a.mp3", 640, 650);
    let s = c.sessions();
    assert_eq!(s.len(), 2);
    assert_eq!((s[0].end - s[0].start, s[0].played), (40 * S, 20 * S));
    assert_eq!((s[1].end - s[1].start, s[1].played), (10 * S, 10 * S));
}

#[test]
fn activity_keeps_a_pause_alive_but_never_starts_a_session() {
    let (mut c, mut seq) = (Clock::default(), 0);
    c.activity(T0);
    assert!(!c.is_open());
    play(&mut c, &mut seq, "/a.mp3", 0, 10);
    // Reading an explanation for 3 minutes, clicking now and then.
    for t in [60, 120, 180] {
        c.activity(T0 + t * S);
    }
    let s = c.sessions();
    assert_eq!((s[0].end - s[0].start, s[0].played), (180 * S, 10 * S));
    // Too late: nothing more counts.
    c.activity(T0 + 300 * S);
    assert_eq!(c.sessions()[0].end, T0 + 180 * S);
}

#[test]
fn other_audio_or_unload_ends_the_session() {
    let (mut c, mut seq) = (Clock::default(), 0);
    play(&mut c, &mut seq, "/a.mp3", 0, 10);
    play(&mut c, &mut seq, "/b.mp3", 12, 20);
    seq += 1;
    assert!(c.status(T0 + 21 * S, seq, None, false));
    let s = c.sessions();
    assert_eq!(
        s.iter().map(|s| s.audio.as_str()).collect::<Vec<_>>(),
        ["/a.mp3", "/b.mp3"]
    );
    assert!(!c.is_open());
}

#[test]
fn sleeping_while_playing_does_not_count() {
    let (mut c, mut seq) = (Clock::default(), 0);
    play(&mut c, &mut seq, "/a.mp3", 0, 10);
    seq += 1;
    c.status(T0 + 10 * S, seq, Some("/a.mp3"), true);
    // Lid closed for an hour; the status thread wakes up still "playing".
    play(&mut c, &mut seq, "/a.mp3", 3610, 3620);
    let total: u64 = c.sessions().iter().map(|s| s.played).sum();
    assert_eq!(total, 20 * S);
}

#[test]
fn clock_going_back_starts_a_new_session() {
    let (mut c, mut seq) = (Clock::default(), 0);
    play(&mut c, &mut seq, "/a.mp3", 100, 110);
    play(&mut c, &mut seq, "/a.mp3", 0, 10);
    assert_eq!(c.sessions().len(), 2);
}

#[test]
fn stale_status_is_ignored() {
    let mut c = Clock::default();
    c.status(T0, 5, Some("/a.mp3"), true);
    c.status(T0 + 2 * S, 7, Some("/a.mp3"), false);
    // An older "playing" status arriving late must not make the pause count as playback.
    c.status(T0 + 2 * S, 6, Some("/a.mp3"), true);
    c.status(T0 + 30 * S, 8, Some("/a.mp3"), true);
    c.status(T0 + 36 * S, 9, Some("/a.mp3"), false);
    assert_eq!(c.sessions()[0].played, 8 * S);
}

#[test]
fn recording_on_your_own_is_practice() {
    // 自己读: nothing plays; the recorder says so every 100 ms for 3 minutes.
    let mut c = Clock::default();
    let mut t = T0;
    while t <= T0 + 180 * S {
        c.busy(t, "/a.mp3", Doing::Recording);
        t += 100;
    }
    c.busy(T0 + 180 * S, "/a.mp3", Doing::Paused);
    let s = c.sessions();
    assert_eq!(s.len(), 1, "kept, though nothing was played");
    assert_eq!((s[0].end - s[0].start, s[0].played), (180 * S, 0));
}

#[test]
fn listening_to_takes_is_playback_and_recording_keeps_a_pause() {
    let (mut c, mut seq) = (Clock::default(), 0);
    // The sentence plays, then you speak for 4 s, then your take plays for 6 s.
    play(&mut c, &mut seq, "/a.mp3", 0, 3);
    for k in 0..=40 {
        c.busy(T0 + 3 * S + k * 100, "/a.mp3", Doing::Recording);
    }
    for k in 0..=60 {
        c.busy(T0 + 7 * S + k * 100, "/a.mp3", Doing::Playing);
    }
    c.busy(T0 + 13 * S, "/a.mp3", Doing::Paused);
    let s = c.sessions();
    assert_eq!((s[0].end - s[0].start, s[0].played), (13 * S, 9 * S));
    // A recording left hanging (no word for longer than the idle limit) counts no further.
    c.busy(T0 + 20 * S, "/a.mp3", Doing::Recording);
    c.busy(T0 + 200 * S, "/a.mp3", Doing::Recording);
    assert_eq!(c.sessions()[0].end, T0 + 20 * S);
}

#[test]
fn tiny_sessions_are_dropped() {
    let (mut c, mut seq) = (Clock::default(), 0);
    play(&mut c, &mut seq, "/a.mp3", 0, 3);
    assert!(c.sessions().is_empty());
    assert!(!c.close());
    assert!(c.done.is_empty());
}

#[test]
fn the_original_playing_during_a_take_is_playback() {
    // 听完再说: the sentence plays for 3 s while the recorder is already listening.
    let mut c = Clock::default();
    for k in 0..=30u64 {
        c.status(T0 + k * 100, k + 1, Some("/a.mp3"), true);
        c.busy(T0 + k * 100 + 50, "/a.mp3", Doing::Recording);
    }
    c.status(T0 + 3 * S + 60, 100, Some("/a.mp3"), false);
    for k in 1..=40u64 {
        c.busy(T0 + 3 * S + k * 100, "/a.mp3", Doing::Recording);
    }
    c.busy(T0 + 7 * S, "/a.mp3", Doing::Paused);
    let s = c.sessions();
    assert_eq!((s[0].end - s[0].start, s[0].played), (7 * S, 3 * S + 60));
}
