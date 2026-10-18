//! "AI 校对": asks the explanation model (see `ai::chat`) which words in a
//! transcript were most likely misheard. It only suggests; the learner accepts
//! or ignores each one, and accepting is an ordinary, undoable edit.

#[cfg(test)]
mod real_tests;
mod reply;
#[cfg(test)]
mod tests;

use crate::ai::chat::{self, Prompt};
use crate::ai::secrets::Secrets;
use crate::ai::{self, Target};
use crate::transcript::{self, Sentence};
use crate::AppState;
pub use reply::Suggestion;
use serde::Serialize;
use std::ops::Range;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const SYSTEM: &str = r#"You check a transcript made by speech recognition. A language learner will listen to the recording and repeat it word for word, so the text must say exactly what was said.

Find only words the recognizer most likely misheard:
- the wrong kanji or characters for the right sound (公園 for 講演, 来たい for 着たい),
- a similar-sounding word that makes no sense in context (their for there),
- a misspelled name or term.
Read the whole transcript first: a later line often shows what an earlier word must be.

Leave everything else exactly as it is: fillers, hesitations, repetitions, casual or dialect speech, grammar mistakes and punctuation. Never rephrase, tidy up or translate. When unsure, leave it.

Text in 〔 〕 is where the recognizer itself was least sure. Check it first; it may still be right.

Lines are "id: text". Reply with JSON only, no other text:
{"fixes": [{"id": 12, "from": "公園", "to": "講演", "reason": "前后说的是去听讲座，应为「講演」"}]}
- from: the shortest piece of that line to replace, copied exactly (without 〔 〕), that appears in the line only once
- to: what it should say
- reason: written in Simplified Chinese whatever the transcript's language (the learner reads Chinese), under 30 characters
If nothing needs fixing, reply {"fixes": []}"#;

/// The `reason` line of `SYSTEM` for a learner who reads English.
const REASON_EN: &str = "- reason: written in English whatever the transcript's language (the learner reads English), at most 15 words";

/// `SYSTEM` with the reasons in English or Chinese (the interface language).
fn system(en: bool) -> String {
    if en {
        SYSTEM
            .replace("前后说的是去听讲座，应为「講演」", "the lines around it are about going to a lecture, so 講演")
            .replace(
                "- reason: written in Simplified Chinese whatever the transcript's language (the learner reads Chinese), under 30 characters",
                REASON_EN,
            )
    } else {
        SYSTEM.to_string()
    }
}

/// Characters of the learner's text per request; most lessons fit in one.
const CHUNK_CHARS: usize = 4000;
/// Lines either side of a chunk, sent as context only.
const CONTEXT_LINES: usize = 8;

/// The proofreading under way, so it can be cancelled.
#[derive(Default)]
pub struct Proofreading(Mutex<Option<Arc<AtomicBool>>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    path: &'a str,
    done: usize,
    total: usize,
}

/// A sentence as the model sees it: its text with the unsure parts (UTF-16 ranges) in 〔 〕.
pub fn marked(s: &Sentence) -> String {
    let units: Vec<u16> = s.text.encode_utf16().collect();
    let mut out = Vec::with_capacity(units.len() + 4 * s.unsure.len());
    let mut at = 0;
    for &[a, b] in &s.unsure {
        let (a, b) = (a as usize, (b as usize).min(units.len()));
        if a < at || a >= b {
            continue;
        }
        out.extend_from_slice(&units[at..a]);
        out.extend("〔".encode_utf16());
        out.extend_from_slice(&units[a..b]);
        out.extend("〕".encode_utf16());
        at = b;
    }
    out.extend_from_slice(&units[at..]);
    String::from_utf16_lossy(&out)
}

/// Consecutive runs of sentences of about `CHUNK_CHARS` characters each.
pub fn chunks(sentences: &[Sentence]) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut size = 0;
    for (i, s) in sentences.iter().enumerate() {
        let n = s.text.chars().count();
        if size > 0 && size + n > CHUNK_CHARS {
            out.push(start..i);
            (start, size) = (i, 0);
        }
        size += n;
    }
    if start < sentences.len() {
        out.push(start..sentences.len());
    }
    out
}

/// The request for one chunk: its lines, with a few either side for context.
fn user_message(sentences: &[Sentence], own: &Range<usize>) -> String {
    let from = own.start.saturating_sub(CONTEXT_LINES);
    let to = (own.end + CONTEXT_LINES).min(sentences.len());
    let lines: Vec<String> = (from..to)
        .map(|i| format!("{i}: {}", marked(&sentences[i])))
        .collect();
    let mut out = String::new();
    if from < own.start || to > own.end {
        out.push_str(&format!(
            "Fix only lines {}–{}; the others are context.\n\n",
            own.start,
            own.end - 1
        ));
    }
    out.push_str(&lines.join("\n"));
    out
}

/// Asks about one chunk (`own`) of the sentences: the model's reply as it came,
/// and the suggestions that survive `reply::check`.
pub async fn ask(
    target: &Target,
    model: &str,
    sentences: &[Sentence],
    own: Range<usize>,
) -> Result<(String, Vec<Suggestion>), String> {
    let system = system(crate::i18n::is_en());
    let prompt = Prompt {
        system: &system,
        user: &user_message(sentences, &own),
        max_tokens: 8192,
    };
    let text = chat::complete(target, model, &prompt).await?;
    let found = reply::check(sentences, own, reply::parse(&text)?);
    Ok((text, found))
}

async fn cancelled(flag: &AtomicBool) {
    while !flag.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Proofreads a track's transcript with the explanation model; progress goes
/// out as `proofread:progress`. Nothing is changed here.
#[tauri::command]
pub async fn transcript_proofread(
    app: AppHandle,
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    running: State<'_, Proofreading>,
    path: String,
) -> Result<Vec<Suggestion>, String> {
    let transcript = transcript::for_track(&state, &path)?.ok_or(crate::i18n::pick(
        "这个音频没有字幕",
        "This audio has no subtitles.",
    ))?;
    let (target, model) = ai::chat_target(&state, &secrets).await?;

    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(earlier) = running.0.lock().unwrap().replace(cancel.clone()) {
        earlier.store(true, Ordering::Relaxed);
    }
    let sentences = &transcript.sentences;
    let parts = chunks(sentences);
    let mut found = Vec::new();
    for (k, own) in parts.iter().enumerate() {
        let progress = Progress {
            path: &path,
            done: k,
            total: parts.len(),
        };
        let _ = app.emit("proofread:progress", progress);
        let (_, part) = tokio::select! {
            r = ask(&target, &model, sentences, own.clone()) => r?,
            _ = cancelled(&cancel) => return Err(crate::transcribe::cancelled_error()),
        };
        found.extend(part);
    }
    Ok(found)
}

#[tauri::command]
pub fn transcript_proofread_cancel(running: State<Proofreading>) {
    if let Some(flag) = running.0.lock().unwrap().take() {
        flag.store(true, Ordering::Relaxed);
    }
}
