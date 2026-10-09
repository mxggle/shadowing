//! "解释这一句": asks the explanation model (see `ai::chat`) for a translation,
//! the words worth knowing and the grammar or speech points of one sentence, for
//! a learner who reads Chinese. It only explains; nothing in the transcript changes.

mod reply;
#[cfg(test)]
mod tests;

use crate::ai::chat::{self, Prompt};
use crate::ai::secrets::Secrets;
use crate::ai::{self, Target};
use crate::transcript::{self, Sentence};
use crate::AppState;
pub use reply::Explanation;
use tauri::State;

const SYSTEM: &str = r#"You help a Chinese-speaking language learner who is shadowing a recording (listening, then repeating it aloud). Explain ONE sentence from its transcript.

Reply with JSON only, no other text:
{"translation": "...", "words": [{"word": "散歩", "reading": "さんぽ", "meaning": "散步"}], "points": [{"point": "〜ましょう", "note": "提议一起做某事，「我们…吧」"}]}
- translation: a natural Simplified Chinese translation of the whole sentence. Use the lines around it to resolve who or what is meant. Keep the speaker's tone (casual stays casual).
- words: at most 8 words or fixed phrases an intermediate learner may not know, in the order they appear. word: as written in the sentence. reading: only for Japanese (kana for words that contain kanji), otherwise "". meaning: the Simplified Chinese meaning in this sentence, under 15 characters.
- points: at most 3 things worth noticing: a grammar pattern, a spoken-language feature (contraction, dropped sounds, filler, slang, dialect), or a nuance. point: the pattern or phrase. note: Simplified Chinese, under 40 characters.
Leave a list empty when there is nothing to say. Do not repeat the translation in the notes. The transcript was made by speech recognition, so if a word looks misheard, explain what it most likely is."#;

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

/// Explains one sentence of a track's transcript with the explanation model.
/// `text` is what the sentence said when it was asked for: if it has been
/// corrected since, the answer would belong to other words, so the ask is refused.
#[tauri::command]
pub async fn sentence_explain(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    path: String,
    index: usize,
    text: String,
) -> Result<Explanation, String> {
    let transcript = transcript::for_track(&state, &path)?.ok_or("这个音频没有字幕")?;
    let sentences = &transcript.sentences;
    if sentences.get(index).map(|s| s.text.as_str()) != Some(text.as_str()) {
        return Err("这一句刚被修改过，请再试一次".into());
    }
    let (target, model) = ai::chat_target(&state, &secrets).await?;
    ask(&target, &model, sentences, index).await
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
    reply::parse(&text)
}
