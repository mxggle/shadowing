//! 标注: plugins mark up the sentences of a transcript (`annotate/run`) with a
//! few kinds of marks the app knows how to draw: a reading over a piece
//! (`ruby`), a note shown on hover (`note`), an underline or bold (`mark`), and
//! a line under the sentence (`below`). Each plugin decides itself which
//! sentences it has something for (a Japanese reader says nothing about English).
//! The app tells plugins which marks it draws (`initialize`'s `capabilities`);
//! anything else in an answer is ignored, so newer plugins still work here.

use super::import::open;
use super::{installed, options};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, State};

/// The marks this app draws, told to plugins when they start.
pub const MARKS: [&str; 5] = ["ruby", "note", "underline", "bold", "below"];
/// A plugin that hasn't answered by then is stopped (cancelled).
const TIMEOUT: Duration = Duration::from_secs(30);
/// Longer text is cut: a plugin can't fill the sentence list.
const MAX_RUBY: usize = 40;
const MAX_NOTE: usize = 300;
const MAX_BELOW: usize = 300;

/// A piece of a sentence and how it is marked.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct Piece {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ruby: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// "underline" or "bold".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark: Option<String>,
}

impl Piece {
    fn marked(&self) -> bool {
        self.ruby.is_some() || self.note.is_some() || self.mark.is_some()
    }
}

/// What a plugin says about one sentence.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct Said {
    #[serde(default)]
    pub pieces: Vec<Piece>,
    #[serde(default)]
    pub below: Option<String>,
}

/// One sentence's marks, from every plugin: the pieces of the first one that
/// marks it up, and the lines under it of all of them.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Annotation {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub pieces: Vec<Piece>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub below: Vec<String>,
}

fn cut(text: Option<String>, max: usize) -> Option<String> {
    text.map(|t| t.trim().chars().take(max).collect::<String>())
        .filter(|t| !t.is_empty())
}

/// What a plugin said about `text`, kept to what can be drawn: pieces that
/// don't join back into the sentence are dropped, text is trimmed and cut,
/// marks this app doesn't know are left out.
pub fn checked(text: &str, said: Said) -> Said {
    let joined: String = said.pieces.iter().map(|p| p.text.as_str()).collect();
    let pieces = if joined == text {
        said.pieces
            .into_iter()
            .filter(|p| !p.text.is_empty())
            .map(|p| Piece {
                ruby: cut(p.ruby, MAX_RUBY),
                note: cut(p.note, MAX_NOTE),
                mark: p.mark.filter(|m| m == "underline" || m == "bold"),
                text: p.text,
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    Said {
        pieces: if pieces.iter().any(Piece::marked) {
            pieces
        } else {
            Vec::new()
        },
        below: cut(said.below, MAX_BELOW),
    }
}

/// Adds one plugin's word on a sentence to what earlier plugins said.
pub fn merge(into: &mut Annotation, said: Said) {
    if into.pieces.is_empty() {
        into.pieces = said.pieces;
    }
    into.below.extend(said.below);
}

#[derive(Deserialize)]
struct Answer {
    results: Vec<Option<Said>>,
}

/// Marks for each sentence from every plugin that annotates. A plugin that
/// fails is skipped (logged): the sentences show without its marks.
#[tauri::command(async)]
pub fn plugins_annotate(
    app: AppHandle,
    state: State<AppState>,
    texts: Vec<String>,
) -> Vec<Annotation> {
    let mut out = vec![Annotation::default(); texts.len()];
    for plugin in installed(&state) {
        for annotator in plugin.manifest.contributes.annotators.clone() {
            let settings = state.read(|s| {
                let saved = s.plugins.get(&plugin.manifest.id).map(|p| &p.settings);
                options::values(&plugin.manifest.contributes.settings, saved)
            });
            let params = json!({ "annotator": annotator.id, "texts": texts, "settings": settings });
            match ask(&app, &plugin, params, texts.len()) {
                Ok(results) => {
                    for ((into, text), said) in out.iter_mut().zip(&texts).zip(results) {
                        merge(into, checked(text, said.unwrap_or_default()));
                    }
                }
                Err(e) => eprintln!("[plugin {}] {e}", plugin.manifest.id),
            }
        }
    }
    out
}

fn ask(
    app: &AppHandle,
    plugin: &super::Installed,
    params: Value,
    count: usize,
) -> Result<Vec<Option<Said>>, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    let timer = cancel.clone();
    std::thread::spawn(move || {
        std::thread::sleep(TIMEOUT);
        timer.store(true, Ordering::Relaxed);
    });
    let mut process = open(app, plugin, &cancel)?;
    let result = process.call("annotate/run", params, &cancel, &mut |_, _| {});
    cancel.store(true, Ordering::Relaxed);
    serde_json::from_value::<Answer>(result?)
        .ok()
        .map(|a| a.results)
        .filter(|r| r.len() == count)
        .ok_or_else(|| "annotate/run: results don't match the sentences".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn piece(text: &str, ruby: Option<&str>) -> Piece {
        Piece {
            text: text.into(),
            ruby: ruby.map(String::from),
            ..Piece::default()
        }
    }

    fn said(pieces: Vec<Piece>, below: Option<&str>) -> Said {
        Said {
            pieces,
            below: below.map(String::from),
        }
    }

    #[test]
    fn keeps_pieces_that_join_into_the_sentence() {
        let pieces = vec![
            piece("東京", Some(" とうきょう ")),
            piece("へ", Some("")),
            piece("", None),
        ];
        assert_eq!(
            checked("東京へ", said(pieces, None)).pieces,
            vec![piece("東京", Some("とうきょう")), piece("へ", None)]
        );
    }

    #[test]
    fn drops_pieces_that_dont_join_but_keeps_the_line_below() {
        let got = checked(
            "東京へ",
            said(vec![piece("東京", Some("とうきょう"))], Some(" To Tokyo ")),
        );
        assert_eq!(got, said(vec![], Some("To Tokyo")));
    }

    #[test]
    fn leaves_out_marks_it_doesnt_draw_and_cuts_long_text() {
        let mut p = piece("字", Some(&"あ".repeat(100)));
        p.mark = Some("sparkle".into());
        let got = checked("字", said(vec![p], None));
        assert_eq!(
            got.pieces[0].ruby.as_ref().unwrap().chars().count(),
            MAX_RUBY
        );
        assert_eq!(got.pieces[0].mark, None);
        let mut p = piece("字", None);
        p.mark = Some("sparkle".into());
        assert!(
            checked("字", said(vec![p], None)).pieces.is_empty(),
            "nothing left to draw"
        );
    }

    #[test]
    fn reads_answers_with_fields_it_doesnt_know() {
        let answer: Answer = serde_json::from_value(json!({
            "results": [{ "pieces": [{ "text": "字", "ruby": "じ", "color": "red" }], "audio": "x" }, null]
        }))
        .unwrap();
        assert_eq!(
            answer.results[0].as_ref().unwrap().pieces[0]
                .ruby
                .as_deref(),
            Some("じ")
        );
        assert!(answer.results[1].is_none());
    }

    #[test]
    fn first_plugin_marks_the_pieces_every_plugin_adds_a_line() {
        let mut a = Annotation::default();
        merge(&mut a, said(vec![], Some("one")));
        merge(&mut a, said(vec![piece("字", Some("じ"))], Some("two")));
        merge(&mut a, said(vec![piece("字", Some("ji"))], None));
        assert_eq!(a.pieces, vec![piece("字", Some("じ"))]);
        assert_eq!(a.below, vec!["one", "two"]);
    }
}
