//! "解释这一句": asks the explanation model (see `ai::chat`) for a translation,
//! the words worth knowing and the grammar or speech points of one sentence, for
//! a learner who reads Chinese. It only explains; nothing in the transcript changes.

#[cfg(test)]
mod real_tests;
mod reply;
pub mod saved;
#[cfg(test)]
mod tests;

use crate::ai::chat::{self, Prompt};
use crate::ai::secrets::Secrets;
use crate::ai::{self, Target};
use crate::transcript::{self, Sentence};
use crate::AppState;
pub use reply::Explanation;
use saved::Saved;
use tauri::State;

const SYSTEM: &str = r#"You help a Chinese-speaking language learner who is shadowing a recording (listening, then repeating it aloud). Explain ONE sentence from its transcript.

Reply with JSON only, no other text:
{"translation": "...", "words": [{"word": "散歩", "reading": "さんぽ", "meaning": "散步"}], "points": [{"point": "〜ましょう", "note": "提议一起做某事，「我们…吧」"}]}
- translation: a natural Simplified Chinese translation of the whole sentence. Use the lines around it to resolve who or what is meant. Keep the speaker's tone (casual stays casual).
- words: at most 8 words or fixed phrases an intermediate learner may not know, in the order they appear. Skip basic words and fillers that a beginner already knows; a short reply like "うん。" needs no word list. Only words that are in the sentence itself, not in the lines around it. word: exactly as written in the sentence. reading: only for Japanese (kana for words that contain kanji), otherwise "". meaning: the Simplified Chinese meaning in this sentence, under 15 characters.
- points: at most 3 things worth noticing: a grammar pattern, a spoken-language feature (contraction, dropped sounds, filler, slang, dialect), or a nuance. point: the pattern or phrase. note: Simplified Chinese, under 40 characters.
Leave a list empty when there is nothing to say; a very short sentence may need only the translation. Do not repeat the translation in the notes. The transcript was made by speech recognition, so if a word looks misheard, explain what it most likely is."#;

/// Lines of the transcript sent either side of the sentence, for context only.
const BEFORE: usize = 3;
const AFTER: usize = 2;

/// The request: the sentence, with a few lines either side.
fn user_message(sentences: &[Sentence], index: usize) -> String {
    let lines = |range: std::ops::Range<usize>| {
        range
            .map(|i| format!("- {}", sentences[i].text))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let from = index.saturating_sub(BEFORE);
    let to = (index + 1 + AFTER).min(sentences.len());
    let mut out = String::new();
    if from < index {
        out.push_str(&format!("Lines before it:\n{}\n\n", lines(from..index)));
    }
    out.push_str(&format!("Sentence to explain:\n{}", sentences[index].text));
    if index + 1 < to {
        out.push_str(&format!("\n\nLines after it:\n{}", lines(index + 1..to)));
    }
    out
}

/// Explains one sentence of a track's transcript with the explanation model, and
/// keeps the answer. `text` is what the sentence said when it was asked for: if it
/// has been corrected since, the answer would belong to other words, so the ask is refused.
#[tauri::command]
pub async fn sentence_explain(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    path: String,
    index: usize,
    text: String,
) -> Result<Explanation, String> {
    let (audio, transcript) = track(&state, &path)?;
    let sentences = &transcript.sentences;
    if sentences.get(index).map(|s| s.text.as_str()) != Some(text.as_str()) {
        return Err("这一句刚被修改过，请再试一次".into());
    }
    let (target, model) = ai::chat_target(&state, &secrets).await?;
    let explanation = ask(&target, &model, sentences, index).await?;
    // Failing to keep it shouldn't lose what was just paid for.
    let answer = Saved {
        index,
        text,
        explanation: explanation.clone(),
    };
    if let Err(e) = saved::save(&dir(&state), &audio, sentences, answer) {
        eprintln!("could not keep the explanation: {e}");
    }
    Ok(explanation)
}

/// The answers kept for a track that still match its sentences.
#[tauri::command]
pub fn sentence_explanations(state: State<AppState>, path: String) -> Result<Vec<Saved>, String> {
    let (audio, transcript) = track(&state, &path)?;
    Ok(saved::load(&dir(&state), &audio, &transcript.sentences))
}

fn dir(state: &AppState) -> std::path::PathBuf {
    state.data_dir().join("explanations")
}

/// The track's key (its canonical path) and the transcript it shows.
fn track(state: &AppState, path: &str) -> Result<(String, transcript::Transcript), String> {
    let audio = state.audio(path)?.to_string_lossy().into_owned();
    let transcript = transcript::for_track(state, path)?.ok_or("这个音频没有字幕")?;
    Ok((audio, transcript))
}

/// Forgets a track's answers (its transcript was removed).
pub fn forget(state: &AppState, audio: &str) {
    let _ = saved::remove(&dir(state), audio);
}

pub async fn ask(
    target: &Target,
    model: &str,
    sentences: &[Sentence],
    index: usize,
) -> Result<Explanation, String> {
    let prompt = Prompt {
        system: SYSTEM,
        user: &user_message(sentences, index),
        max_tokens: 2048,
    };
    let text = chat::complete(target, model, &prompt).await?;
    let mut explanation = reply::parse(&text, &sentences[index].text)?;
    explanation.source = format!(
        "{}{} · {model}",
        if target.preset.local { "本机 " } else { "" },
        target.preset.name
    );
    Ok(explanation)
}
