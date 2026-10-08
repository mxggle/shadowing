//! Manual, networked checks with real models. Not part of `npm run check`.
//!
//! SHADOWING_FIXTURES=<folder from scripts/make-fixtures.sh> \
//!   cargo test --manifest-path src-tauri/Cargo.toml real_ -- --ignored --nocapture
//!
//! Downloads into the app's real models folder (so the app can use them afterwards).

use super::download::{self, Spec};
use super::models;
use super::whisper::Whisper;
use crate::transcribe::{chunk, run, Job};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

fn models_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap())
        .join("Library/Application Support/dev.shadowing.app/models")
}

async fn fetch(id: &str, stop_after: Option<u64>) -> Result<(), String> {
    let m = models::find(id).unwrap();
    let dest = models_dir().join(m.file);
    if dest.is_file() {
        return Ok(());
    }
    let url = m.url();
    let spec = Spec {
        url: &url,
        dest: &dest,
        size: m.size,
        sha256: m.sha256,
    };
    let cancel = AtomicBool::new(false);
    let started = Instant::now();
    let mut shown = 0;
    let result = download::download(&spec, &cancel, |done, total| {
        let pct = done * 10 / total;
        if pct > shown {
            shown = pct;
            println!(
                "{id}: {}% ({:.0} s)",
                pct * 10,
                started.elapsed().as_secs_f64()
            );
        }
        if stop_after.is_some_and(|n| done >= n) {
            cancel.store(true, Ordering::Relaxed);
        }
    })
    .await;
    println!(
        "{id}: {result:?} after {:.0} s",
        started.elapsed().as_secs_f64()
    );
    result
}

#[tokio::test]
#[ignore]
async fn real_download_resumes_and_verifies() {
    let small = models::find("small-q5_1").unwrap();
    if models_dir().join(small.file).is_file() {
        println!("small already downloaded; skipping the resume check");
    } else {
        // Stop a third of the way, then resume from the .part file through HF's CDN redirect.
        assert_eq!(
            fetch("small-q5_1", Some(small.size / 3)).await.unwrap_err(),
            download::CANCELLED
        );
        let part = download::partial_len(&models_dir().join(small.file));
        println!("kept {part} bytes for resuming");
        assert!(part >= small.size / 3);
        fetch("small-q5_1", None).await.unwrap();
    }
    fetch("large-v3-turbo-q5_0", None).await.unwrap();
}

#[test]
#[ignore]
fn real_transcription_of_fixtures() {
    let fixtures = PathBuf::from(std::env::var("SHADOWING_FIXTURES").expect("SHADOWING_FIXTURES"));
    for id in ["small-q5_1", "large-v3-turbo-q5_0"] {
        let file = models_dir().join(models::find(id).unwrap().file);
        if !file.is_file() {
            println!("{id}: not downloaded, skipped");
            continue;
        }
        let loaded = Instant::now();
        let mut whisper = Whisper::load(&file).unwrap();
        println!(
            "\n== {id} (loaded in {:.1} s)",
            loaded.elapsed().as_secs_f64()
        );
        for (name, lang) in [("01 日本語 天気.m4a", "ja"), ("02 English VBR.mp3", "en")] {
            let job = Job {
                audio: &fixtures.join(name),
                language: Some(lang),
                plan: chunk::DEFAULT,
                cancel: Arc::new(AtomicBool::new(false)),
            };
            let started = Instant::now();
            let sentences = run(&job, &mut whisper, Arc::new(|_, _| {})).unwrap();
            println!("{name}: {:.2} s", started.elapsed().as_secs_f64());
            for s in &sentences {
                println!("  {:6.2}–{:6.2}  {}", s.start, s.end, s.text);
            }
        }
    }
}

/// SHADOWING_LONG=<a few minutes of speech>: speed per model, then cancelling mid-way.
#[test]
#[ignore]
fn real_speed_and_cancel_on_a_long_file() {
    let audio = PathBuf::from(std::env::var("SHADOWING_LONG").expect("SHADOWING_LONG"));
    for id in ["small-q5_1", "large-v3-turbo-q5_0"] {
        let file = models_dir().join(models::find(id).unwrap().file);
        if !file.is_file() {
            continue;
        }
        let mut whisper = Whisper::load(&file).unwrap();
        let job = Job {
            audio: &audio,
            language: Some("ja"),
            plan: chunk::DEFAULT,
            cancel: Arc::new(AtomicBool::new(false)),
        };
        let ticks = Arc::new(std::sync::Mutex::new(0usize));
        let count = ticks.clone();
        let started = Instant::now();
        let sentences = run(
            &job,
            &mut whisper,
            Arc::new(move |_, _| *count.lock().unwrap() += 1),
        )
        .unwrap();
        let secs = started.elapsed().as_secs_f64();
        let audio_secs = sentences.last().unwrap().end;
        println!(
            "{id}: {:.0} s of audio in {secs:.1} s ({:.0}× real time), {} sentences, {} progress updates",
            audio_secs,
            audio_secs / secs,
            sentences.len(),
            ticks.lock().unwrap()
        );
        println!("  first: {:?}", sentences.first().map(|s| &s.text));
        println!("  last:  {:?}", sentences.last().map(|s| &s.text));

        // Cancel one second in: must stop promptly with CANCELLED.
        let cancel = Arc::new(AtomicBool::new(false));
        let job = Job {
            cancel: cancel.clone(),
            ..job
        };
        let flag = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(1));
            flag.store(true, Ordering::Relaxed);
        });
        let started = Instant::now();
        let err = run(&job, &mut whisper, Arc::new(|_, _| {})).unwrap_err();
        println!(
            "  cancel: {err:?} after {:.2} s",
            started.elapsed().as_secs_f64()
        );
        assert_eq!(err, crate::transcribe::CANCELLED);
        // whisper.cpp checks the flag between steps, so it can take a couple of seconds.
        assert!(started.elapsed().as_secs_f64() < 5.0);
    }
}

/// SHADOWING_AUDIO=<file> SHADOWING_LANG=ja: prints the sentences as SRT
/// (how the bundled sample transcripts were drafted before hand-checking).
#[test]
#[ignore]
fn real_print_srt() {
    let audio = PathBuf::from(std::env::var("SHADOWING_AUDIO").expect("SHADOWING_AUDIO"));
    let lang = std::env::var("SHADOWING_LANG").unwrap_or_else(|_| "ja".into());
    let file = models_dir().join(models::find("large-v3-turbo-q8_0").unwrap().file);
    let mut whisper = Whisper::load(&file).unwrap();
    let job = Job {
        audio: &audio,
        language: Some(&lang),
        plan: chunk::DEFAULT,
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let stamp = |t: f64| {
        let ms = (t * 1000.0).round() as u64;
        format!(
            "{:02}:{:02}:{:02},{:03}",
            ms / 3_600_000,
            ms / 60_000 % 60,
            ms / 1000 % 60,
            ms % 1000
        )
    };
    for (i, s) in run(&job, &mut whisper, Arc::new(|_, _| {}))
        .unwrap()
        .iter()
        .enumerate()
    {
        println!(
            "{}\n{} --> {}\n{}\n",
            i + 1,
            stamp(s.start),
            stamp(s.end),
            s.text
        );
    }
}
