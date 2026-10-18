//! The model's reply → what the learner sees: tidied, capped, and never empty.

use crate::ai::chat;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_PARTS: usize = 12;

/// One piece of the sentence: what it means here and what its grammar does.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, Serialize)]
pub struct Part {
    pub text: String,
    pub reading: String,
    pub meaning: String,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Default, Deserialize, Serialize)]
pub struct Explanation {
    #[serde(default)]
    pub translation: String,
    #[serde(default)]
    pub parts: Vec<Part>,
    /// How it is said ("带点埋怨"), to say it the same way; may be empty.
    #[serde(default)]
    pub tone: String,
    /// Who answered ("ChatGPT · gpt-6-luna"); filled in by the app, not the model.
    #[serde(default)]
    pub source: String,
}

/// `sentence` is what was asked about: a piece the model lists must be in it.
///
/// Read leniently, field by field: with a dozen pieces, a small model now and
/// then repeats a key (the last one counts) or writes null, and that shouldn't
/// cost the whole answer.
pub(super) fn parse(reply: &str, sentence: &str) -> Result<Explanation, String> {
    let unreadable = || {
        crate::i18n::pick(
            "AI 的回复不是要求的格式，可以再试一次或换一个模型",
            "The AI's reply wasn't in the expected format. Try again, or try another model.",
        )
        .to_string()
    };
    let json: Value = chat::json_object(reply)
        .and_then(|json| serde_json::from_str(json).ok())
        .ok_or_else(unreadable)?;
    let text = |v: &Value, key: &str| v[key].as_str().unwrap_or_default().trim().to_string();
    let translation = text(&json, "translation");
    if translation.is_empty() {
        return Err(unreadable());
    }
    // A piece needs something to read, a meaning or a note. One that isn't in
    // the sentence (from the lines around it, or made up) isn't about it.
    let sentence = sentence.to_lowercase();
    let parts = json["parts"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| {
            let (meaning, note) = (text(p, "meaning"), text(p, "note"));
            Part {
                text: unpunctuated(&text(p, "text")),
                reading: unpunctuated(&text(p, "reading")),
                // "回来 · 回来": a note that only says the meaning again.
                note: if note == meaning { String::new() } else { note },
                meaning,
            }
        })
        .filter(|p| {
            (!p.meaning.is_empty() || !p.note.is_empty())
                && !p.text.is_empty()
                && sentence.contains(&p.text.to_lowercase())
        })
        .take(MAX_PARTS)
        .collect();
    Ok(Explanation {
        translation,
        parts,
        tone: text(&json, "tone"),
        source: String::new(),
    })
}

/// "記者について、" → "記者について": the commas and stops a piece was cut with.
fn unpunctuated(s: &str) -> String {
    s.trim_matches(|c| "、。，．,.!?！？…:：;；".contains(c))
        .trim()
        .to_string()
}
