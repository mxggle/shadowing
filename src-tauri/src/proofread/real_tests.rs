//! Manual check against the real explanation model, through the app's own
//! settings and Keychain sign-in. Not part of `npm run check`; macOS may ask
//! once to let the test read the Keychain item.
//!
//! SHADOWING_AUDIO=<file>[;<file>…] cargo test --manifest-path src-tauri/Cargo.toml \
//!   --release real_proofread -- --ignored --nocapture
//!
//! A track's saved transcript is used as it is; one without is transcribed on
//! this Mac (Large v3 Turbo, with underlines) and not saved. Nothing in the
//! app's data is changed: settings are read from a copy of state.json.

use super::{ask, chunks, marked};
use crate::ai::providers::Feature;
use crate::ai::secrets::{Keychain, Secrets};
use crate::ai::Target;
use crate::local::{models, whisper::Whisper};
use crate::store::Persisted;
use crate::transcribe::{chunk, run, Job};
use crate::{transcript, AppState};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Instant;

fn app_data() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap())
        .join("Library/Application Support/dev.shadowing.app")
}

#[tokio::test]
#[ignore]
async fn real_proofread() {
    let copy = tempfile::tempdir().unwrap();
    let state_path = copy.path().join("state.json");
    std::fs::copy(app_data().join("state.json"), &state_path).unwrap();
    let state = AppState {
        data: Mutex::new(Persisted::load(&state_path)),
        state_path,
        samples: None,
    };
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

    let file = models::find("large-v3-turbo-q8_0").unwrap().file;
    let mut whisper = None;
    for audio in std::env::var("SHADOWING_AUDIO")
        .expect("SHADOWING_AUDIO")
        .split(';')
    {
        let audio = Path::new(audio).canonicalize().unwrap();
        let key = audio.to_string_lossy().into_owned();
        let sentences = match transcript::load(&app_data().join("transcripts"), &key) {
            Some(t) => {
                println!("\n== {key}: saved transcript ({})", t.origin);
                t.sentences
            }
            None => {
                println!("\n== {key}: transcribed now, not saved");
                let w = whisper.get_or_insert_with(|| {
                    let path = app_data().join("models").join(file);
                    Whisper::load(&path, "large-v3-turbo-q8_0").unwrap()
                });
                let job = Job {
                    audio: &audio,
                    language: Some("ja"),
                    plan: chunk::DEFAULT,
                    cancel: Arc::new(AtomicBool::new(false)),
                };
                run(&job, w, Arc::new(|_, _| {})).unwrap()
            }
        };
        for (i, s) in sentences.iter().enumerate() {
            println!("  {i:3}  {}", marked(s));
        }
        for own in chunks(&sentences) {
            let started = Instant::now();
            let (reply, found) = ask(&target, &choice.model, &sentences, own).await.unwrap();
            println!(
                "-- reply in {:.1} s:\n{reply}",
                started.elapsed().as_secs_f64()
            );
            println!("-- kept:");
            for s in found {
                println!("  {:3}  {} → {}  ({})", s.index, s.from, s.to, s.reason);
            }
        }
    }
}
