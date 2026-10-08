//! Real output device. Run manually: `cargo test -- --ignored --nocapture`.

use super::*;
use crate::audio::{EventSink, Player, Status};
use std::sync::Mutex;
use std::time::Duration;

#[derive(Default)]
struct Recorder {
    statuses: Mutex<Vec<Status>>,
    errors: Mutex<Vec<String>>,
    ended: Mutex<Vec<String>>,
}

impl EventSink for Recorder {
    fn status(&self, s: &Status) {
        self.statuses.lock().unwrap().push(s.clone());
    }
    fn ended(&self, path: &str) {
        self.ended.lock().unwrap().push(path.to_string());
    }
    fn error(&self, _path: Option<&str>, message: &str) {
        self.errors.lock().unwrap().push(message.to_string());
    }
}

#[test]
#[ignore = "plays a quiet 1 s tone on the default output device"]
fn plays_tone_on_default_device() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tone.wav");
    write_wav(&path, 44_100, 44_100 * 3 / 2, |i| {
        let v = (i as f32 / 44_100.0 * 440.0 * std::f32::consts::TAU).sin() * 0.2;
        [v, v]
    });
    let rec = Arc::new(Recorder::default());
    let player = Player::new(rec.clone());
    player.set_volume(0.15).unwrap();
    let p = path.to_string_lossy().into_owned();
    let duration = player.load(p.clone(), path.clone(), 0.0, true).unwrap();
    assert!((duration - 1.5).abs() < 1e-6);
    std::thread::sleep(Duration::from_millis(1000));
    let t = player.status().time;
    player.pause().unwrap();
    std::thread::sleep(Duration::from_millis(100));
    let errors = rec.errors.lock().unwrap().clone();
    assert!(errors.is_empty(), "errors: {errors:?}");
    let n = rec.statuses.lock().unwrap().len();
    println!("after 1 s of playback: time {t:.3}s, {n} status events");
    assert!((0.8..1.2).contains(&t), "time after 1 s was {t}");
    assert!(n >= 20, "status events ~30 Hz, got {n}");
    // Play to the natural end.
    player.play().unwrap();
    std::thread::sleep(Duration::from_millis(900));
    assert_eq!(
        rec.ended.lock().unwrap().as_slice(),
        std::slice::from_ref(&p)
    );
    assert!(!player.status().playing);
}
