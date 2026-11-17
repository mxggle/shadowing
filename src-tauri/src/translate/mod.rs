//! 译文: a translation under every sentence. The explanation model (see `ai::chat`) translates
//! a track's sentences a batch at a time (the page asks batch by batch, so it can show
//! progress and stop when the track changes); answers are kept per track in app data
//! (`translations/`, saved.rs), keyed by the sentence's text. Subtitles that come with a
//! translation (bilingual.rs) don't need any of this.

mod saved;
#[cfg(test)]
mod tests;

use crate::ai::chat::{self, Prompt};
use crate::ai::secrets::Secrets;
use crate::ai::{self, Target};
use crate::transcript::{self, Sentence, Translations};
use crate::AppState;
use serde_json::Value;
use tauri::State;

/// Most sentences one request translates.
pub const BATCH: usize = 30;
/// Lines before the batch sent along, so its first lines have their context.
const BEFORE: usize = 3;

/// The languages a track can be translated into: code → its name for the model.
const LANGUAGES: &[(&str, &str)] = &[
    ("zh-Hans", "Simplified Chinese"),
    ("zh-Hant", "Traditional Chinese"),
    ("en", "English"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("es", "Spanish"),
    ("fr", "French"),
    ("de", "German"),
];

fn language(code: &str) -> Result<&'static str, String> {
    LANGUAGES
        .iter()
        .find(|(c, _)| *c == code)
        .map(|(_, name)| *name)
        .ok_or_else(|| tr!("不支持翻译成 {code}", "Can't translate into {code}"))
}

fn system(language: &str) -> String {
    format!(
        r#"You translate the transcript of a recording for a language learner who is shadowing it (listening, then repeating it aloud) and reads {language}.
Translate each numbered line into natural {language}. Keep the speaker's tone (casual stays casual, polite stays polite), and use the lines around it to resolve who or what is meant, but translate each line on its own: never merge, split or skip lines.
If a line is already in {language}, its translation is "".
The transcript was made by speech recognition, so translate a word that looks misheard as what it most likely is.
Reply with JSON only, no other text, one key per numbered line: {{"1": "…", "2": "…"}}"#
    )
}

/// The request: the batch's lines numbered from 1, after a few earlier lines for context.
fn user_message(sentences: &[Sentence], indices: &[usize]) -> String {
    let mut out = String::new();
    let first = indices.first().copied().unwrap_or(0);
    let from = first.saturating_sub(BEFORE);
    if from < first {
        out.push_str("Earlier lines, for context only (don't translate them):\n");
        for s in &sentences[from..first] {
            out.push_str(&format!("- {}\n", s.text));
        }
        out.push('\n');
    }
    out.push_str("Lines to translate:\n");
    for (n, &i) in indices.iter().enumerate() {
        out.push_str(&format!("{}. {}\n", n + 1, sentences[i].text));
    }
    out
}

/// The model's reply → the translation of each line it answered (by position in the batch).
fn parse(reply: &str, count: usize) -> Result<Vec<Option<String>>, String> {
    let json: Value = chat::json_object(reply)
        .and_then(|j| serde_json::from_str(j).ok())
        .ok_or_else(|| {
            crate::i18n::pick(
                "AI 的回复不是要求的格式，可以再试一次或换一个模型",
                "The AI's reply wasn't in the expected format. Try again or choose another model.",
            )
            .to_string()
        })?;
    // Some models wrap the answer ({"translations": {…}}).
    let json = match json.as_object() {
        Some(o) if o.len() == 1 && o.values().all(Value::is_object) => {
            o.values().next().cloned().unwrap_or_default()
        }
        _ => json,
    };
    Ok((1..=count)
        .map(|n| {
            json[n.to_string()]
                .as_str()
                .map(|t| t.trim().replace('\n', " "))
        })
        .collect())
}

/// Translates sentences `indices` (at most `BATCH`) of a track into `lang`, keeps the answers
/// and gives back every kept translation of the track in that language. `texts`: what the
/// sentences said when asked; one that has since changed is skipped.
#[tauri::command]
pub async fn translate_sentences(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    path: String,
    lang: String,
    indices: Vec<usize>,
) -> Result<Translations, String> {
    let name = language(&lang)?;
    let (audio, sentences) = track(&state, &path)?;
    let mut indices: Vec<usize> = indices
        .into_iter()
        .filter(|&i| i < sentences.len())
        .collect();
    indices.sort_unstable();
    indices.dedup();
    indices.truncate(BATCH);
    if !indices.is_empty() {
        let (target, model) = ai::chat_target(&state, &secrets).await?;
        let answers = ask(&target, &model, name, &sentences, &indices).await?;
        let found: Vec<(String, String)> = indices
            .iter()
            .zip(answers)
            .filter_map(|(&i, a)| Some((sentences[i].text.clone(), a?)))
            .collect();
        if found.is_empty() {
            return Err(crate::i18n::pick(
                "AI 没有给出译文，可以再试一次或换一个模型",
                "The AI gave no translations. Try again or choose another model.",
            )
            .into());
        }
        if let Err(e) = saved::save(&dir(&state), &audio, &sentences, &lang, found) {
            eprintln!("could not keep the translations: {e}");
        }
    }
    Ok(saved::load(&dir(&state), &audio, &sentences, &lang))
}

/// The translations kept for a track's sentences in `lang`.
#[tauri::command]
pub fn translations_saved(
    state: State<AppState>,
    path: String,
    lang: String,
) -> Result<Translations, String> {
    let (audio, sentences) = track(&state, &path)?;
    Ok(saved::load(&dir(&state), &audio, &sentences, &lang))
}

async fn ask(
    target: &Target,
    model: &str,
    language: &str,
    sentences: &[Sentence],
    indices: &[usize],
) -> Result<Vec<Option<String>>, String> {
    let system = system(language);
    let prompt = Prompt {
        system: &system,
        user: &user_message(sentences, indices),
        max_tokens: 8192,
    };
    let reply = chat::complete(target, model, &prompt).await?;
    parse(&reply, indices.len())
}

fn dir(state: &AppState) -> std::path::PathBuf {
    state.data_dir().join("translations")
}

/// The track's key (its canonical path) and the sentences it shows.
fn track(state: &AppState, path: &str) -> Result<(String, Vec<Sentence>), String> {
    let audio = state.audio(path)?.to_string_lossy().into_owned();
    let transcript =
        transcript::for_track(state, path)?.ok_or(crate::transcript::no_transcript())?;
    Ok((audio, transcript.sentences))
}

/// Forgets a track's translations (its transcript was removed).
pub fn forget(state: &AppState, audio: &str) {
    let _ = saved::remove(&dir(state), audio);
}

/// The kept translation of one sentence in any language, for an Anki card without an explanation.
pub fn kept(state: &AppState, audio: &str, sentences: &[Sentence], index: usize) -> Option<String> {
    let text = &sentences.get(index)?.text;
    saved::any(&dir(state), audio, text)
}
