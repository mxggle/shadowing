//! Manual: merges a real YouTube video's picture and sound, downloaded with the
//! plugin's own yt-dlp, then opens the result the way the app opens audio.
//!
//! SHADOWING_URL=https://youtu.be/FFMoTdeD1aM cargo test --release real_mux -- --ignored --nocapture
//!
//! `SHADOWING_PLUGIN_DATA` keeps yt-dlp between runs. `SHADOWING_OUT=<folder>` keeps
//! video.mp4, audio.m4a and merged.mp4 there, and doesn't download again what is
//! already there (so the merge can be timed on its own).

use super::tests::{decode, seek};
use super::{merge, read};
use crate::{tools, Ctx};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

/// What the video plan downloads: H.264 up to 720p, and the sound the import takes now.
const FORMATS: [(&str, &str); 2] = [
    ("bestvideo[ext=mp4][vcodec^=avc1][height<=720]", "video.mp4"),
    ("bestaudio[ext=m4a]", "audio.m4a"),
];

fn env_path(key: &str, default: impl FnOnce() -> PathBuf) -> PathBuf {
    std::env::var_os(key)
        .map(PathBuf::from)
        .unwrap_or_else(default)
}

#[test]
#[ignore]
fn real_mux() {
    let url = std::env::var("SHADOWING_URL").unwrap_or("https://youtu.be/FFMoTdeD1aM".into());
    let tmp = tempfile::tempdir().unwrap();
    let dir = env_path("SHADOWING_OUT", || tmp.path().join("out"));
    let data = env_path("SHADOWING_PLUGIN_DATA", || tmp.path().join("data"));
    fs::create_dir_all(&dir).unwrap();
    fs::create_dir_all(&data).unwrap();
    let ctx = Ctx {
        data,
        cancel: Arc::new(AtomicBool::new(false)),
    };
    for (format, name) in FORMATS {
        if dir.join(name).is_file() {
            continue;
        }
        let tools = tools::ensure(&ctx).unwrap();
        let mut c = Command::new(&tools.ytdlp);
        // As the app runs the plugin: no ffmpeg on the PATH, so yt-dlp leaves the files as DASH.
        if cfg!(unix) {
            c.env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
        }
        c.args(["--ignore-config", "--no-playlist", "--no-progress"]);
        c.args(["-f", format, "-o"]).arg(dir.join(name));
        if let Some(js) = &tools.js {
            c.args(["--js-runtimes", js]);
        }
        c.args(["--", &url]);
        let started = Instant::now();
        assert!(c.status().unwrap().success(), "yt-dlp failed");
        println!("downloaded {name} in {:.1?}", started.elapsed());
    }

    let (video, audio) = (dir.join("video.mp4"), dir.join("audio.m4a"));
    let out = dir.join("merged.mp4");
    let started = Instant::now();
    merge(&video, &audio, &out, &mut |_, _| Ok(())).unwrap();
    let took = started.elapsed();
    let mb = |p: &Path| fs::metadata(p).unwrap().len() as f64 / 1e6;
    println!(
        "merged {:.1} MB + {:.1} MB into {:.1} MB in {took:.2?}",
        mb(&video),
        mb(&audio),
        mb(&out)
    );

    let merged = read::tracks(&out).unwrap();
    let originals = [&video, &audio].map(|p| read::tracks(p).unwrap().remove(0));
    for (m, o) in merged.iter().zip(&originals) {
        let seconds = m.media_duration() as f64 / m.timescale as f64;
        let kind = String::from_utf8_lossy(&m.handler);
        println!("{kind}: {} samples, {seconds:.3} s", m.samples.len());
        assert_eq!(m.samples.len(), o.samples.len());
        assert_eq!(m.media_duration(), o.media_duration());
    }
    let (_, rate, frames) = decode(&out);
    println!(
        "the app's decoder: {:.3} s of sound at {rate} Hz",
        frames as f64 / rate as f64
    );
    assert_eq!(frames, decode(&audio).2);
    let middle = merged[1].media_duration() as f64 / merged[1].timescale as f64 / 2.0;
    let landed = seek(&out, middle);
    println!("seeking to {middle:.3} s landed on {landed:.3} s");
    assert!((landed - middle).abs() < 0.03);
}
