//! The model's reply → suggestions the learner can accept, keeping only small,
//! exact, word-level fixes: the model never touches times, sentence breaks, or
//! anything it can't point to precisely.

use crate::ai::chat;
use crate::transcript::Sentence;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ops::Range;

/// Longer `from` / `to` than this (in characters) is a rewrite, not a misheard word.
const MAX_CHARS: usize = 12;

/// One proposed fix, shown under its sentence until accepted or ignored.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub index: usize,
    pub from: String,
    pub to: String,
    pub reason: String,
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    fixes: Vec<Fix>,
}

#[derive(Deserialize)]
pub(super) struct Fix {
    id: Value,
    from: String,
    to: String,
    #[serde(default)]
    reason: String,
}

impl Fix {
    /// The line number, sent back as 12 or "12".
    fn index(&self) -> Option<usize> {
        match &self.id {
            Value::Number(n) => n.as_u64().map(|n| n as usize),
            Value::String(s) => s.trim().parse().ok(),
            _ => None,
        }
    }
}

/// The JSON in a reply, even when wrapped in ``` fences or a sentence of prose.
pub(super) fn parse(reply: &str) -> Result<Vec<Fix>, String> {
    chat::json_object(reply)
        .and_then(|json| serde_json::from_str::<Reply>(json).ok())
        .map(|r| r.fixes)
        .ok_or_else(|| {
            crate::i18n::pick(
                "AI 的回复不是要求的格式，可以再试一次或换一个模型",
                "The AI's reply wasn't in the expected format. Try again or choose another model.",
            )
            .to_string()
        })
}

/// Text as sent, without the 〔 〕 that mark what the transcriber was unsure of.
fn clean(s: &str) -> String {
    s.replace(['〔', '〕'], "").trim().to_string()
}

fn letters(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Fixes for sentences in `own` that can be applied exactly: `from` appears once
/// in that sentence, both sides are short, and more than punctuation changes.
pub(super) fn check(sentences: &[Sentence], own: Range<usize>, fixes: Vec<Fix>) -> Vec<Suggestion> {
    let mut out: Vec<Suggestion> = Vec::new();
    for fix in fixes {
        let Some(index) = fix.index().filter(|i| own.contains(i)) else {
            continue;
        };
        let (from, to) = (clean(&fix.from), clean(&fix.to));
        let short = |s: &str| (1..=MAX_CHARS).contains(&s.chars().count());
        let fits = short(&from)
            && short(&to)
            && letters(&from) != letters(&to)
            && sentences[index].text.matches(from.as_str()).count() == 1;
        if !fits || out.iter().any(|s| s.index == index && s.from == from) {
            continue;
        }
        let reason = fix.reason.trim().chars().take(60).collect();
        out.push(Suggestion {
            index,
            from,
            to,
            reason,
        });
    }
    out
}
