//! The model's reply → what the learner sees: tidied, capped, and never empty.

use crate::ai::chat;
use serde::{Deserialize, Serialize};

const MAX_WORDS: usize = 8;
const MAX_POINTS: usize = 4;

#[derive(Debug, Clone, PartialEq, Default, Deserialize, Serialize)]
pub struct Word {
    #[serde(default)]
    pub word: String,
    #[serde(default)]
    pub reading: String,
    #[serde(default)]
    pub meaning: String,
}

#[derive(Debug, Clone, PartialEq, Default, Deserialize, Serialize)]
pub struct Point {
    #[serde(default)]
    pub point: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Default, Deserialize, Serialize)]
pub struct Explanation {
    #[serde(default)]
    pub translation: String,
    #[serde(default)]
    pub words: Vec<Word>,
    #[serde(default)]
    pub points: Vec<Point>,
}

/// `sentence` is what was asked about: a word the model lists must be in it.
pub(super) fn parse(reply: &str, sentence: &str) -> Result<Explanation, String> {
    let unreadable = || "AI 的回复不是要求的格式，可以再试一次或换一个模型".to_string();
    let mut e = chat::json_object(reply)
        .and_then(|json| serde_json::from_str::<Explanation>(json).ok())
        .ok_or_else(unreadable)?;
    e.translation = e.translation.trim().to_string();
    if e.translation.is_empty() {
        return Err(unreadable());
    }
    for w in &mut e.words {
        w.word = w.word.trim().to_string();
        w.reading = w.reading.trim().to_string();
        w.meaning = w.meaning.trim().to_string();
    }
    for p in &mut e.points {
        p.point = p.point.trim().to_string();
        p.note = p.note.trim().to_string();
    }
    // An entry needs something to read: a word its meaning, a point its note.
    // A word that isn't in the sentence (from the lines around it, or made up) isn't about it.
    let sentence = sentence.to_lowercase();
    e.words.retain(|w| {
        !w.meaning.is_empty() && !w.word.is_empty() && sentence.contains(&w.word.to_lowercase())
    });
    e.points
        .retain(|p| !p.point.is_empty() && !p.note.is_empty());
    e.words.truncate(MAX_WORDS);
    e.points.truncate(MAX_POINTS);
    Ok(e)
}
