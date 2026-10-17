//! Manual: a real plugin end to end, without the app window (smoke.ts covers the
//! window with a fake plugin). Runs the plugin through rpc.rs, takes its files
//! with accept.rs, then plays the audio with the app's decoder and reads the subtitles.
//!
//! scripts/build-plugin.sh youtube
//! SHADOWING_URL=https://youtu.be/FFMoTdeD1aM cargo test --manifest-path src-tauri/Cargo.toml real_plugin -- --ignored --nocapture
//!
//! `SHADOWING_PLUGIN` is the built plugin folder (default plugins/youtube/dist/youtube);
//! `SHADOWING_PLUGIN_DATA` keeps the plugin's downloads (yt-dlp) between runs.

use super::accept::{self, Made};
use super::manifest::Manifest;
use super::rpc::Process;
use crate::audio::decode::Decoder;
use crate::transcript::{self, Source};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Instant;

fn env_path(key: &str, default: impl FnOnce() -> PathBuf) -> PathBuf {
    std::env::var_os(key)
        .map(PathBuf::from)
        .unwrap_or_else(default)
}

#[test]
#[ignore]
fn real_plugin_import() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let plugin = env_path("SHADOWING_PLUGIN", || {
        repo.join("plugins/youtube/dist/youtube")
    });
    let url = std::env::var("SHADOWING_URL").unwrap_or("https://youtu.be/FFMoTdeD1aM".into());
    let manifest =
        Manifest::read(&plugin).expect("build the plugin first: scripts/build-plugin.sh youtube");
    let importer = manifest
        .importer_for(&url)
        .expect("the plugin takes this link")
        .clone();
    let tmp = tempfile::tempdir().unwrap();
    let data = env_path("SHADOWING_PLUGIN_DATA", || tmp.path().join("data"));
    std::fs::create_dir_all(&data).unwrap();

    let program = plugin.join(manifest.program_path().unwrap());
    let mut process = Process::spawn(&program, &data).unwrap();
    let never = AtomicBool::new(false);
    let mut last = String::new();
    let mut print = |method: &str, params: &Value| {
        let message = params["message"].as_str().unwrap_or(method).to_string();
        if message != last {
            println!("  {message}");
            last = message;
        }
    };
    let hello = json!({ "protocol": 1, "appVersion": "test", "dataDir": data });
    process
        .call("initialize", hello, &never, &mut print)
        .unwrap();

    let started = Instant::now();
    let ask = json!({ "url": url, "importer": importer.id });
    let resolved = process
        .call("import/resolve", ask, &never, &mut print)
        .unwrap();
    println!("resolved in {:.1?}: {resolved}", started.elapsed());
    let title = resolved["title"].as_str().unwrap().to_string();
    let spoken = resolved["language"].as_str().unwrap_or_default();
    let subtitles = resolved["subtitles"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|s| s["lang"].as_str())
        .find(|lang| !spoken.is_empty() && lang.starts_with(spoken))
        .map(String::from);

    let staging = tmp.path().join("job");
    std::fs::create_dir_all(&staging).unwrap();
    let started = Instant::now();
    let run =
        json!({ "url": url, "importer": importer.id, "outDir": staging, "subtitles": subtitles });
    let result = process.call("import/run", run, &never, &mut print).unwrap();
    println!("downloaded in {:.1?}: {result}", started.elapsed());

    let made: Vec<Made> = serde_json::from_value(result["files"].clone()).unwrap();
    let picked = accept::pick(&staging, &made).unwrap();
    let root = tmp.path().join("library");
    std::fs::create_dir_all(&root).unwrap();
    let dest = accept::place(&picked.audio, &root, "YouTube", &title).unwrap();
    println!("placed at {}", dest.strip_prefix(&root).unwrap().display());

    let mut decoder = Decoder::open(&dest).unwrap();
    let mut buf = vec![0f32; 4096 * decoder.channels];
    let mut frames = 0u64;
    loop {
        let n = decoder.read(&mut buf).unwrap();
        if n == 0 {
            break;
        }
        frames += n as u64;
    }
    let seconds = frames as f64 / decoder.sample_rate as f64;
    println!(
        "decoded {seconds:.2} s (the site says {})",
        resolved["duration"]
    );
    if let Some(duration) = resolved["duration"].as_f64() {
        assert!(
            (seconds - duration).abs() < 1.5,
            "decoded {seconds} s of {duration} s"
        );
    }

    match picked.subtitle {
        Some((file, lang)) => {
            let t = transcript::read_subtitle(&file, Source::Imported).unwrap();
            println!(
                "subtitles ({lang}): {} sentences, first: {:?}",
                t.sentences.len(),
                t.sentences.first().map(|s| &s.text)
            );
            assert!(!t.sentences.is_empty());
        }
        None => println!("no subtitles (asked for {subtitles:?})"),
    }
}
