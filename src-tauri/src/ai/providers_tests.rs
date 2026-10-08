//! Tests for providers.rs.

use super::*;

fn ids(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn presets_are_consistent() {
    for p in PRESETS {
        assert!(!p.features.is_empty(), "{}", p.id);
        for f in p.features {
            // Custom servers have no default model; everything else names one or lists them.
            if p.base_url.is_empty() {
                assert!(p.default_model(*f).is_none());
            }
        }
        assert_eq!(p.local, p.key == KeyPolicy::None, "{}", p.id);
        assert!(
            p.base_url.is_empty() || !p.base_url.ends_with('/'),
            "{}",
            p.id
        );
    }
    let unique: std::collections::HashSet<_> = PRESETS.iter().map(|p| p.id).collect();
    assert_eq!(unique.len(), PRESETS.len());
}

#[test]
fn transcription_lists_keep_whisper_models() {
    let groq = find("groq").unwrap();
    let got = filter_models(
        groq,
        Feature::Transcribe,
        ids(&[
            "llama-3.3-70b",
            "whisper-large-v3-turbo",
            "whisper-large-v3",
        ]),
    );
    assert_eq!(got, ["whisper-large-v3", "whisper-large-v3-turbo"]);
    let custom = find("custom-transcribe").unwrap();
    assert_eq!(
        filter_models(custom, Feature::Transcribe, ids(&["parakeet"])),
        ["parakeet"]
    );
}

#[test]
fn chat_lists_drop_audio_image_and_embedding_models() {
    let openai = find("openai").unwrap();
    let got = filter_models(
        openai,
        Feature::Chat,
        ids(&[
            "gpt-5-mini",
            "whisper-1",
            "text-embedding-3-small",
            "gpt-4o-mini-transcribe",
            "dall-e-3",
            "gpt-5",
            "tts-1",
        ]),
    );
    assert_eq!(got, ["gpt-5", "gpt-5-mini"]);
}

#[test]
fn gemini_ids_lose_their_prefix() {
    let gemini = find("gemini").unwrap();
    let got = filter_models(
        gemini,
        Feature::Chat,
        ids(&["models/gemini-3-flash", "models/gemini-3-flash"]),
    );
    assert_eq!(got, ["gemini-3-flash"]);
}
