//! Manual check against the real explanation model, through the app's own
//! settings and Keychain sign-in. Not part of `npm run check`; macOS may ask
//! once to let the test read the Keychain item.
//!
//! SHADOWING_AUDIO=<file> [SHADOWING_SENTENCES=2,5,16] cargo test \
//!   --manifest-path src-tauri/Cargo.toml --release real_explain -- --ignored --nocapture
//!
//! Uses the track's saved transcript (nothing is transcribed or saved) and
//! explains the listed sentences (default: a spread). Settings are read from a
//! copy of state.json, so the app's data is not changed.

use super::ask;
use crate::ai::providers::Feature;
use crate::ai::secrets::{Keychain, Secrets};
use crate::ai::Target;
use crate::store::Persisted;
use crate::{transcript, AppState};
use std::path::PathBuf;
use std::time::Instant;

fn app_data() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap())
        .join("Library/Application Support/dev.shadowing.app")
}

#[tokio::test]
#[ignore]
async fn real_explain() {
    let copy = tempfile::tempdir().unwrap();
    let state_path = copy.path().join("state.json");
    std::fs::copy(app_data().join("state.json"), &state_path).unwrap();
    let data = Persisted::load(&state_path);
    let state = AppState::new(state_path, data, None);
    let secrets = Secrets(Box::new(Keychain::new().unwrap()));
    let choice = state.read(|d| d.ai.choice(Feature::Chat).clone());
    let id = choice
        .provider
        .clone()
        .expect("no explanation service chosen");
    let target = Target::resolve(&state, &secrets, &id)
        .unwrap()
        .ready(&secrets)
        .await
        .unwrap();
    println!("model: {id} · {}", choice.model);

    let audio = std::fs::canonicalize(std::env::var("SHADOWING_AUDIO").expect("SHADOWING_AUDIO"))
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let sentences = transcript::load(&app_data().join("transcripts"), &audio)
        .expect("no saved transcript for this audio")
        .sentences;
    let picks: Vec<usize> = std::env::var("SHADOWING_SENTENCES")
        .unwrap_or_else(|_| "2,4,5,16,22,42".into())
        .split(',')
        .map(|n| n.trim().parse().unwrap())
        .collect();
    for i in picks {
        let started = Instant::now();
        let e = ask(&target, &choice.model, &sentences, i).await;
        println!(
            "\n[{i}] {}   ({:.1} s)",
            sentences[i].text,
            started.elapsed().as_secs_f64()
        );
        match e {
            Err(e) => println!("  失败：{e}"),
            Ok(e) => {
                println!("  译文：{}", e.translation);
                for p in e.parts {
                    println!("  {} ({}) {} · {}", p.text, p.reading, p.meaning, p.note);
                }
                if !e.tone.is_empty() {
                    println!("  语气：{}", e.tone);
                }
            }
        }
    }
}
