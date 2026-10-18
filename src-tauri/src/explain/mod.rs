//! "解释这一句": asks the explanation model (see `ai::chat`) for a translation of
//! one sentence and what each piece of it means and does, for a learner who
//! reads Chinese. It only explains; nothing in the transcript changes.

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

const SYSTEM: &str = r#"You help a Chinese-speaking language learner who is shadowing a recording (listening, then repeating it aloud). Explain ONE sentence from its transcript piece by piece, so the learner understands every part of what they say, but keep it brief.

Reply with JSON only, no other text. For example, for 今日はちょっと散歩に行こっか。
{"translation": "今天要不要去散个步？", "parts": [{"text": "今日は", "reading": "きょうは", "meaning": "今天", "note": ""}, {"text": "ちょっと", "reading": "", "meaning": "稍微", "note": "让提议显得随意"}, {"text": "散歩に", "reading": "さんぽに", "meaning": "去散步", "note": "に 表示去的目的"}, {"text": "行こっか", "reading": "いこっか", "meaning": "去吧？", "note": "= 行こうか，口语缩约，轻松地提议"}], "tone": "随意地提议"}
- translation: a natural Simplified Chinese translation of the whole sentence. Use the lines around it to resolve who or what is meant. Keep the speaker's tone (casual stays casual).
- parts: the sentence split into pieces, in order, together covering all of it except punctuation. A piece is a word or short phrase with the particle or ending attached to it (散歩に, 行きました, 兵士や志願兵の情報を), or a grammar pattern that means something on its own (の, んだから, ようにする). Usually 2 to 6 pieces, at most 10: in a long sentence, keep easy words inside a longer piece rather than giving each its own. A one-word reply is one piece.
  - text: exactly as written in the sentence.
  - reading: only for Japanese, in kana, for a piece that contains kanji; otherwise "".
  - meaning: what the piece means here, Simplified Chinese, under 12 characters; "" for a piece that is only grammar.
  - note: what its grammar or form does, Simplified Chinese, under 30 characters: the dictionary form of a conjugated word, the full form of a contraction or slang (なんない = ならない), a dropped particle, the nuance of an ending. "" when the meaning says it all; never explain what a beginner knows (a plain は, が, を, に, で, or の between nouns).
- tone: how the speaker says it, for the learner to carry over when repeating it aloud (带点埋怨, 撒娇, 吃惊, 新闻播报的平稳语调), Simplified Chinese, under 15 characters; "" if nothing stands out.
The transcript was made by speech recognition, so if a word looks misheard, say in its note what it most likely is."#;

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

/// Moves a track's answers along with its sentences, after some were cut or
/// joined (`moved`: where sentence i is now; see `saved::follow`).
pub fn follow(state: &AppState, audio: &str, moved: impl Fn(usize) -> usize) {
    if let Err(e) = saved::follow(&dir(state), audio, moved) {
        eprintln!("could not move the kept explanations: {e}");
    }
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
        max_tokens: 3072,
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
