//! The real speakers and microphone, nobody talking: plays four seconds of the
//! Japanese sample out loud while recording, then measures how much of it echo
//! removal takes back out (this is the no-headphones case). Run by hand:
//! `cargo test --manifest-path src-tauri/Cargo.toml real_record -- --ignored --nocapture`
//! (`SHADOWING_OUT=<dir>` keeps the recordings: mic | cleaned, and what was played;
//! `SHADOWING_OUTPUT_DEVICE=Speakers SHADOWING_INPUT_DEVICE="MacBook Pro Microphone"` picks
//! the built-in ones while headphones are the default).

use super::take::{self, Raw, RATE};
use super::{echo, mic, saved, vad};
use crate::audio::{tap, EventSink, Player, Status};
use std::path::Path;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

struct Quiet;
impl EventSink for Quiet {
    fn status(&self, _: &Status) {}
    fn ended(&self, _: &str) {}
    fn error(&self, _: Option<&str>, m: &str) {
        eprintln!("player: {m}");
    }
}

fn db(x: &[f32]) -> f32 {
    vad::level(x)
}

#[test]
#[ignore = "plays audio out loud and records the microphone"]
fn real_record_echo() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("samples/ja/ごんぎつね.mp3");
    let player = Player::new(Arc::new(Quiet));
    player.set_volume(0.6).unwrap();
    player
        .load(path.to_string_lossy().into(), path.clone(), 1.0, false)
        .unwrap();
    let mut mic = mic::open(4.0).expect("microphone");
    let opened = Instant::now();
    while mic.first_at.load(Relaxed) == 0 {
        assert!(
            opened.elapsed() < Duration::from_secs(3),
            "no microphone callbacks"
        );
        thread::sleep(Duration::from_millis(5));
    }
    let (t, mut rx) = tap::tap(4.0);
    player.set_tap(Some(t)).unwrap();
    thread::sleep(Duration::from_millis(300));
    player.play_range(1.0, 11.0).unwrap();
    let (mut buf, mut marks, mut played) = (Vec::new(), Vec::new(), Vec::new());
    let started = Instant::now();
    while started.elapsed() < Duration::from_millis(11_000) {
        thread::sleep(Duration::from_millis(10));
        while let Ok(v) = mic.samples.pop() {
            buf.push(v);
        }
        while let Ok(m) = rx.marks.pop() {
            marks.push(m);
        }
        while let Ok(v) = rx.samples.pop() {
            played.push(v);
        }
    }
    player.set_tap(None).unwrap();
    drop(mic.stream);
    assert!(
        buf.iter().any(|&v| v != 0.0),
        "the microphone gave only silence (permission?)"
    );
    println!(
        "mic {} Hz, {:.1} s; tap {} blocks, {} Hz",
        mic.rate,
        buf.len() as f64 / mic.rate as f64,
        marks.len(),
        marks[0].rate
    );

    let raw = Raw {
        mic_at: mic.first_at.load(Relaxed),
        turn: buf.len(),
        mic: buf,
        mic_rate: mic.rate,
        marks,
        played,
        hints: vec![],
    };
    let mic32 = take::convert(&raw.mic, raw.mic_rate, RATE);
    let secs = raw.mic.len() as f64 / raw.mic_rate as f64;
    let heard = take::place(&raw.marks, &raw.played, raw.mic_at, secs);
    let cleaned = echo::cancel(&mic32, &heard, RATE);
    let active = (RATE as usize / 2)..(RATE as usize * 10);
    let (before, after) = (db(&mic32[active.clone()]), db(&cleaned[active.clone()]));
    println!("while the original played: mic {before:.1} dBFS → {after:.1} dBFS after echo removal ({:.1} dB less)", before - after);
    let quiet = (mic32.len() - RATE as usize / 4)..mic32.len();
    println!("room noise afterwards: {:.1} dBFS", db(&mic32[quiet]));
    if let Ok(dir) = std::env::var("SHADOWING_OUT") {
        let dir = Path::new(&dir);
        std::fs::write(
            dir.join("mic-vs-cleaned.wav"),
            saved::stereo_wav(&mic32, &cleaned),
        )
        .unwrap();
        std::fs::write(dir.join("played.wav"), saved::stereo_wav(&heard, &heard)).unwrap();
    }
    assert!(
        before > -60.0,
        "the mic didn't hear the speakers (headphones?): {before}"
    );
    // Room noise (fans, the street) stays; the echo goes down to near it.
    assert!(
        before - after > 8.0,
        "echo only reduced by {:.1} dB",
        before - after
    );
}

/// Talking over the original, on a real echo: the recording kept by
/// `real_record_echo` (SHADOWING_OUT) plus a clean English voice mixed in at a
/// normal speaking level. How much of the voice survives echo removal, and
/// how much echo is left where the voice pauses.
#[test]
#[ignore = "needs a recording from real_record_echo in SHADOWING_OUT"]
fn real_record_double_talk() {
    let dir = std::env::var("SHADOWING_OUT").expect("SHADOWING_OUT");
    let dir = Path::new(&dir);
    let read = |name: &str| -> (Vec<f32>, Vec<f32>) {
        let mut d = crate::audio::decode::Decoder::open(&dir.join(name)).unwrap();
        let mut all = vec![0.0; d.frames.unwrap() as usize * 2];
        let n = d.read(&mut all).unwrap();
        all.truncate(n * 2);
        (
            all.iter().step_by(2).copied().collect(),
            all.iter().skip(1).step_by(2).copied().collect(),
        )
    };
    let (mic, _) = read("mic-vs-cleaned.wav");
    let (heard, _) = read("played.wav");
    let voice_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("samples/en/The Tale of Peter Rabbit.mp3");
    let mut pcm = crate::transcribe::pcm::Pcm16k::open(&voice_path).unwrap();
    let mut v16 = Vec::new();
    while pcm.read_into(&mut v16).unwrap() && v16.len() < 16_000 * 7 {}
    let mut voice = take::convert(&v16, 16_000, RATE);
    // Speaking level at the laptop: about −28 dBFS while talking.
    let g = 10f32.powf((-28.0 - db(&voice)) / 20.0);
    voice.iter_mut().for_each(|v| *v *= g);
    let at = RATE as usize * 2;
    let mut both = mic.clone();
    for (i, v) in voice.iter().enumerate() {
        if let Some(m) = both.get_mut(at + i) {
            *m += v;
        }
    }
    let out = echo::cancel(&both, &heard, RATE);
    let echo_only = (RATE as usize / 2)..at;
    println!(
        "echo alone: {:.1} → {:.1} dBFS (room {:.1})",
        db(&both[echo_only.clone()]),
        db(&out[echo_only.clone()]),
        db(&mic[mic.len() - RATE as usize / 4..])
    );
    let talk = at..(at + voice.len()).min(out.len());
    let envelope = |x: &[f32]| -> Vec<f32> { x.chunks(320).map(|c| db(c).max(-60.0)).collect() };
    let corr = |a: &[f32], b: &[f32]| {
        let n = a.len().min(b.len()) as f32;
        let (ma, mb) = (a.iter().sum::<f32>() / n, b.iter().sum::<f32>() / n);
        let cov: f32 = a.iter().zip(b).map(|(x, y)| (x - ma) * (y - mb)).sum();
        let va: f32 = a.iter().map(|x| (x - ma).powi(2)).sum();
        let vb: f32 = b.iter().map(|y| (y - mb).powi(2)).sum();
        cov / (va * vb).sqrt()
    };
    let v = envelope(&voice[..talk.len()]);
    println!(
        "voice loudness contour followed: mic {:.2}, after echo removal {:.2}; level {:.1} vs voice {:.1} dBFS",
        corr(&envelope(&both[talk.clone()]), &v),
        corr(&envelope(&out[talk.clone()]), &v),
        db(&out[talk.clone()]),
        db(&voice)
    );
    std::fs::write(dir.join("double-talk.wav"), saved::stereo_wav(&both, &out)).unwrap();
}

#[test]
#[ignore = "needs a recording from real_record_echo in SHADOWING_OUT"]
fn real_record_short_takes() {
    let dir = std::env::var("SHADOWING_OUT").expect("SHADOWING_OUT");
    let read = |name: &str| -> Vec<f32> {
        let mut d = crate::audio::decode::Decoder::open(&Path::new(&dir).join(name)).unwrap();
        let mut all = vec![0.0; d.frames.unwrap() as usize * 2];
        let n = d.read(&mut all).unwrap();
        all.truncate(n * 2);
        all.iter().step_by(2).copied().collect()
    };
    let (mic, heard) = (read("mic-vs-cleaned.wav"), read("played.wav"));
    for secs in [3usize, 4, 6, 8, 11] {
        let n = (secs * RATE as usize).min(mic.len());
        let out = echo::cancel(&mic[..n], &heard[..n], RATE);
        let r = RATE as usize / 2..n;
        println!(
            "{secs:>2} s: {:.1} → {:.1} dBFS",
            db(&mic[r.clone()]),
            db(&out[r])
        );
        if secs == 11 {
            std::fs::write(
                Path::new(&dir).join("now.wav"),
                saved::stereo_wav(&mic[..n], &out),
            )
            .unwrap();
        }
    }
}

/// Signals from a take, collected: auto stops, errors, level events, sentences moved to.
type Signalled = (Vec<super::Stop>, Vec<String>, usize, Vec<usize>);
#[derive(Clone, Default)]
struct Caught(Arc<std::sync::Mutex<Signalled>>);
impl super::Signals for Caught {
    fn level(&self, _: &super::Level) {
        self.0.lock().unwrap().2 += 1;
    }
    fn auto(&self, stop: super::Stop) {
        self.0.lock().unwrap().0.push(stop);
    }
    fn sentence(&self, i: usize) {
        self.0.lock().unwrap().3.push(i);
    }
    fn error(&self, m: &str) {
        self.0.lock().unwrap().1.push(m.to_string());
    }
}

/// A stand-in learner: macOS `say` through the built-in speakers, `after` seconds from now.
fn learner_says(after: f64, text: &str) -> std::process::Child {
    std::process::Command::new("sh")
        .arg("-c")
        .arg(format!(
            "sleep {after}; say -a 'MacBook Pro Speakers' -v Kyoko '{text}'"
        ))
        .spawn()
        .expect("say")
}

fn wait_for(what: &str, secs: f64, mut done: impl FnMut() -> bool) {
    let start = Instant::now();
    while !done() {
        assert!(
            start.elapsed().as_secs_f64() < secs,
            "timed out waiting for {what}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

/// A whole take, as the app does it, on the real speakers and microphone:
/// 听完再说 then 边听边说, each stopping by itself once the "learner" stops.
#[test]
#[ignore = "plays audio out loud, speaks with `say` and records the microphone"]
fn real_record_takes() {
    use super::{Meta, Mode, Recorder};
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("samples/ja/ごんぎつね.mp3");
    let audio = path.to_string_lossy().into_owned();
    let player = Player::new(Arc::new(Quiet));
    player.set_volume(0.6).unwrap();
    player
        .load(audio.clone(), path.clone(), 0.0, false)
        .unwrap();
    let root = tempfile::tempdir().unwrap();
    let recorder = Recorder::default();
    let (a, b) = (1.0, 4.5);
    let line = "これは、わたしが小さいときに、聞いたお話です";
    for mode in [Mode::Listen, Mode::Shadow] {
        let caught = Caught::default();
        let meta = Meta {
            audio: audio.clone(),
            start: a,
            end: b,
            text: line.into(),
            mode,
            rate: 1.0,
            sentences: vec![],
        };
        let mic = recorder
            .begin(caught.clone(), &player, meta, path.clone())
            .expect("begin");
        println!("\n{mode:?}: recording with {mic}");
        let started = Instant::now();
        player.play_range(a, b).unwrap();
        let mut say = learner_says(
            if mode == Mode::Listen {
                b - a + 0.6
            } else {
                0.4
            },
            line,
        );
        wait_for("the original", 10.0, || !player.status().playing);
        recorder.turn();
        println!("original done at {:.1} s", started.elapsed().as_secs_f64());
        wait_for("the take to stop by itself", 20.0, || {
            !caught.0.lock().unwrap().0.is_empty()
        });
        let stop = caught.0.lock().unwrap().0[0];
        println!(
            "stopped ({stop:?}) at {:.1} s",
            started.elapsed().as_secs_f64()
        );
        let _ = say.wait();
        let t = Instant::now();
        let take = recorder
            .finish(&player, root.path())
            .expect("finish")
            .takes
            .pop()
            .expect("a take");
        let (o, m) = (take.original, take.mine);
        println!(
            "built in {:.2} s: file {:.1} s, original {:.2}–{:.2}, you {:.2}–{:.2}, lag {:?} ms; {} level events",
            t.elapsed().as_secs_f64(), take.duration, o.0, o.1, m.0, m.1, take.lag_ms, caught.0.lock().unwrap().2
        );
        assert_eq!(stop, super::Stop::Pause);
        assert!(
            caught.0.lock().unwrap().1.is_empty(),
            "errors: {:?}",
            caught.0.lock().unwrap().1
        );
        assert!((o.1 - o.0 - (b - a)).abs() < 0.6, "the original's length");
        assert!(m.1 - m.0 > 1.5, "your voice was kept");
        if mode == Mode::Listen {
            assert!(m.0 > o.1 - 0.2, "you come after the original");
        } else {
            assert!(
                take.lag_ms.is_some_and(|l| (100..1500).contains(&l)),
                "a lag was measured"
            );
        }
        if let Ok(dir) = std::env::var("SHADOWING_OUT") {
            let wav = saved::wav_path(root.path(), &audio, &take.id);
            std::fs::copy(wav, Path::new(&dir).join(format!("take-{mode:?}.wav"))).unwrap();
        }
    }
    assert_eq!(saved::list(root.path(), &audio).len(), 2);
}

/// A paragraph in one go, as the app does it: three sentences of the sample,
/// read by `say` with pauses between them — on its own (自己读: the highlight
/// should follow, and it should end by itself), then along with the original.
#[test]
#[ignore = "plays audio out loud, speaks with `say` and records the microphone"]
fn real_record_paragraph() {
    use super::{Meta, Mode, Recorder, Sentence};
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("samples/ja/ごんぎつね.mp3");
    let audio = path.to_string_lossy().into_owned();
    let player = Player::new(Arc::new(Quiet));
    player.set_volume(0.6).unwrap();
    player
        .load(audio.clone(), path.clone(), 0.0, false)
        .unwrap();
    let root = tempfile::tempdir().unwrap();
    let recorder = Recorder::default();
    let lines = [
        (0.25, 6.25, "これは、私が小さいときに、村の茂平というおじいさんからきいたお話です。"),
        (7.5, 17.0, "むかしは、私たちの村のちかくの、中山というところに小さなお城があって、中山さまというおとのさまが、おられたそうです。"),
        (18.25, 24.6, "その中山から、少しはなれた山の中に、「ごん狐」という狐がいました。"),
    ];
    let sentences: Vec<Sentence> = lines
        .iter()
        .map(|&(start, end, text)| Sentence {
            start,
            end,
            text: text.into(),
        })
        .collect();
    let spoken = lines
        .iter()
        .map(|l| l.2)
        .collect::<Vec<_>>()
        .join("[[slnc 700]]");
    for mode in [Mode::Read, Mode::Shadow] {
        let caught = Caught::default();
        let meta = Meta {
            audio: audio.clone(),
            start: 0.25,
            end: 24.6,
            text: String::new(),
            mode,
            rate: 1.0,
            sentences: sentences.clone(),
        };
        let mic = recorder
            .begin(caught.clone(), &player, meta, path.clone())
            .expect("begin");
        println!("\n{mode:?}: recording with {mic}");
        let started = Instant::now();
        if mode == Mode::Shadow {
            player.play_range(0.25, 24.6).unwrap();
        }
        let mut say = learner_says(if mode == Mode::Read { 0.5 } else { 0.4 }, &spoken);
        if mode == Mode::Shadow {
            wait_for("the original", 40.0, || !player.status().playing);
            recorder.turn();
        }
        wait_for("the reading to stop by itself", 60.0, || {
            !caught.0.lock().unwrap().0.is_empty()
        });
        let _ = say.wait();
        let moved = caught.0.lock().unwrap().3.clone();
        println!(
            "stopped at {:.1} s; highlight moved to {moved:?}",
            started.elapsed().as_secs_f64()
        );
        let t = Instant::now();
        let done = recorder.finish(&player, root.path()).expect("finish");
        let r = done.reading.expect("a reading");
        println!(
            "built in {:.2} s: {} takes; you {:.1} s, original {:.1} s, lag {:?}",
            t.elapsed().as_secs_f64(),
            done.takes.len(),
            r.mine_secs,
            r.original_secs,
            r.lag_ms
        );
        for p in &r.parts {
            println!(
                "  sentence {:.2}–{:.2}: you {:.2}–{:.2}",
                p.start, p.end, p.mine.0, p.mine.1
            );
        }
        assert!(caught.0.lock().unwrap().1.is_empty(), "errors");
        assert_eq!(done.takes.len(), 3, "a take per sentence");
        assert!(
            r.parts.windows(2).all(|w| w[0].mine.1 <= w[1].mine.0),
            "in order, not overlapping"
        );
        if mode == Mode::Read {
            assert_eq!(moved, [1, 2], "the highlight followed");
        }
        if let Ok(dir) = std::env::var("SHADOWING_OUT") {
            std::fs::copy(
                saved::wav_path(root.path(), &audio, &r.id),
                Path::new(&dir).join(format!("reading-{mode:?}.wav")),
            )
            .unwrap();
        }
    }
}
