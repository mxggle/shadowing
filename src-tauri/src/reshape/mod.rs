//! Changing where sentences begin and end: cutting one in two at a place in
//! its text (拆句), making two next to each other one (合并), and putting a run
//! back as it was (⌘Z). A cut's time is guessed from how far through the words
//! it is, then moved onto a pause heard near there. What hangs on a sentence's
//! place in the list follows it: sections, kept explanations (those of the
//! sentences changed no longer match, unless ⌘Z puts them back), underlines.

mod cut;

use crate::sections::{self, Section};
use crate::transcript::{self, stale, Sentence, Transcript};
use crate::AppState;
use cut::{cut_text, halves};
use std::path::Path;
use tauri::State;

/// Sentences [at, at + removed) replaced by `added` new ones.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Change {
    pub at: usize,
    pub removed: usize,
    pub added: usize,
}

impl Change {
    /// Where sentence `i` is now; none for one that was replaced.
    pub fn moved(self, i: usize) -> Option<usize> {
        if i < self.at {
            Some(i)
        } else if i < self.at + self.removed {
            None
        } else {
            Some(i + self.added - self.removed)
        }
    }
}

/// Sections after `change`: one starting inside the replaced run goes (the
/// sentence it started at is gone), later ones move with their sentences.
fn shift_sections(sections: &[Section], change: Change) -> Vec<Section> {
    sections
        .iter()
        .filter_map(|s| {
            let start = if s.start <= change.at {
                s.start
            } else {
                change.moved(s.start)?
            };
            Some(Section {
                start,
                title: s.title.clone(),
            })
        })
        .collect()
}

/// Puts `with` in place of sentences [at, at + removed), moving the sections along.
fn replace(t: &mut Transcript, at: usize, removed: usize, with: Vec<Sentence>) -> Change {
    let change = Change {
        at,
        removed,
        added: with.len(),
    };
    t.sentences.splice(at..at + removed, with);
    t.sections = sections::normalize(shift_sections(&t.sections, change), t.sentences.len());
    t.own();
    t.edited = true;
    change
}

fn len16(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// Chinese and Japanese, and their punctuation: written without spaces between words.
fn unspaced(c: char) -> bool {
    matches!(c as u32,
        0x3000..=0x30FF | 0x31F0..=0x31FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF
        | 0xF900..=0xFAFF | 0xFF00..=0xFFEF | 0x20000..=0x3FFFF)
}

/// Two sentences' text as one: a space between them, unless either side is
/// written without spaces.
fn join(a: &str, b: &str) -> String {
    let tight =
        a.chars().next_back().is_some_and(unspaced) || b.chars().next().is_some_and(unspaced);
    if tight {
        format!("{a}{b}")
    } else {
        format!("{a} {b}")
    }
}

/// Two sentences next to each other as one: from the first's start to the
/// second's end, said by whoever says the first.
fn merge(a: &Sentence, b: &Sentence) -> Sentence {
    let text = join(&a.text, &b.text);
    let offset = len16(&text) - len16(&b.text);
    let mut unsure = a.unsure.clone();
    unsure.extend(b.unsure.iter().map(|&[x, y]| [x + offset, y + offset]));
    let mut times = a.times.clone();
    times.extend(b.times.iter().map(|&(at, t)| (at + offset, t)));
    Sentence {
        start: a.start,
        end: a.end.max(b.end),
        text,
        speaker: a.speaker.or(b.speaker),
        unsure,
        times,
    }
}

/// Cuts sentence `index` in two at `at` in its text.
fn split(t: &mut Transcript, index: usize, at: u32, audio: &Path) -> Result<Change, String> {
    let s = t.sentences.get(index).ok_or(stale())?.clone();
    let cut = cut_text(&s.text, at).ok_or(crate::i18n::pick(
        "要在句子中间断开，两边都要有字",
        "To split a sentence, both parts need some text",
    ))?;
    let times = cut::times(&s, &cut, audio);
    Ok(replace(t, index, 1, halves(&s, cut, times).into()))
}

/// Puts back sentences that a cut or a join replaced: `sentences` in place of
/// [at, at + count), and the sections as they were.
fn restore(
    t: &mut Transcript,
    at: usize,
    count: usize,
    mut sentences: Vec<Sentence>,
    sections: Vec<Section>,
) -> Result<Change, String> {
    if count == 0 || sentences.is_empty() || at + count > t.sentences.len() {
        return Err(stale().into());
    }
    let before = at.checked_sub(1).map(|i| t.sentences[i].start);
    let after = t.sentences.get(at + count).map(|s| s.start);
    let starts: Vec<f64> = before
        .into_iter()
        .chain(sentences.iter().map(|s| s.start))
        .chain(after)
        .collect();
    let fits = sentences
        .iter()
        .all(|s| s.start.is_finite() && s.end >= s.start && !s.text.trim().is_empty())
        && starts.windows(2).all(|w| w[0] <= w[1]);
    if !fits {
        return Err(stale().into());
    }
    for s in &mut sentences {
        let length = len16(&s.text);
        s.unsure.retain(|&[a, b]| a < b && b <= length);
        crate::timing::fitting(&mut s.times, length);
    }
    let change = replace(t, at, count, sentences);
    t.sections = sections::normalize(sections, t.sentences.len());
    Ok(change)
}

/// Changes a track's transcript with `f`, saves it, and moves the kept
/// explanations along with their sentences.
fn update(
    state: &AppState,
    path: &str,
    f: impl FnOnce(&mut Transcript, &Path) -> Result<Change, String>,
) -> Result<Transcript, String> {
    let (audio, key, dir) = transcript::authorize(state, path)?;
    let mut t = transcript::current(state, &audio, &dir, &key).ok_or(transcript::no_transcript())?;
    let change = f(&mut t, &audio)?;
    transcript::save(&dir, &key, &t)
        .map_err(|e| tr!("无法保存修改：{e}", "Couldn't save the changes: {e}"))?;
    crate::explain::follow(state, &key, |i| change.moved(i).unwrap_or(change.at));
    Ok(t)
}

/// Cuts sentence `index` in two where its text has the cursor (`at`, UTF-16 units).
#[tauri::command]
pub fn transcript_split(
    state: State<AppState>,
    path: String,
    index: usize,
    at: u32,
) -> Result<Transcript, String> {
    update(&state, &path, |t, audio| split(t, index, at, audio))
}

/// Makes sentence `index` and the one after it one sentence.
#[tauri::command]
pub fn transcript_merge(
    state: State<AppState>,
    path: String,
    index: usize,
) -> Result<Transcript, String> {
    update(&state, &path, |t, _| {
        let (Some(a), Some(b)) = (t.sentences.get(index), t.sentences.get(index + 1)) else {
            return Err(stale().into());
        };
        let merged = merge(a, b);
        Ok(replace(t, index, 2, vec![merged]))
    })
}

/// Undoes a cut or a join: `sentences` back in place of the `count` at `at`.
#[tauri::command]
pub fn transcript_restore(
    state: State<AppState>,
    path: String,
    at: usize,
    count: usize,
    sentences: Vec<Sentence>,
    sections: Vec<Section>,
) -> Result<Transcript, String> {
    update(&state, &path, |t, _| {
        restore(t, at, count, sentences, sections)
    })
}

#[cfg(test)]
mod tests;
