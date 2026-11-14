//! What goes on an Anki card: its note type (created in Anki the first time), and one
//! sentence's fields: the sentence, its audio, and the explanation kept for it, if any.
//! Pure, so the HTML can be tested without Anki.

use crate::explain::Explanation;
use crate::transcript::Sentence;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const DECK: &str = "Shadowing";
/// Our own note type, so the card shows audio, sentence and explanation the same way for everyone.
pub const MODEL: &str = "Shadowing Sentence";
const FIELDS: [&str; 5] = ["Sentence", "Audio", "Translation", "Explanation", "Source"];

/// Audio before the sentence's first word, as the app plays it (`SENTENCE_LEAD` in lib/sentences.ts).
const LEAD: f64 = 0.1;
/// After its last word, so it doesn't end on a cut-off breath; never into the next sentence.
const TAIL: f64 = 0.3;

/// The stretch of the track a card plays for sentence `index`.
pub fn span(sentences: &[Sentence], index: usize) -> (f64, f64) {
    let s = &sentences[index];
    let start = (s.start - LEAD).max(0.0);
    let end = match sentences.get(index + 1) {
        Some(next) => (s.end + TAIL).min(next.start - LEAD).max(s.end),
        None => s.end + TAIL,
    };
    (start, end)
}

/// The same name for the same stretch of the same file: adding a sentence again replaces its audio.
pub fn media_name(audio: &str, start: f64, end: f64) -> String {
    let hash = Sha256::digest(format!("{audio}|{start:.3}|{end:.3}"));
    let hex: String = hash[..8].iter().map(|b| format!("{b:02x}")).collect();
    format!("shadowing-{hex}.wav")
}

/// "ごんぎつね · 1:23"
pub fn source(name: &str, start: f64) -> String {
    let secs = start.max(0.0) as u64;
    format!("{name} · {}:{:02}", secs / 60, secs % 60)
}

/// The note's fields, as Anki's HTML.
pub fn fields(
    sentence: &str,
    media: &str,
    explanation: Option<&Explanation>,
    source: &str,
) -> Value {
    let (translation, notes) = match explanation {
        Some(e) => (esc(&e.translation), notes(e)),
        None => (String::new(), String::new()),
    };
    json!({
        "Sentence": esc(sentence),
        "Audio": format!("[sound:{media}]"),
        "Translation": translation,
        "Explanation": notes,
        "Source": esc(source),
    })
}

/// Piece by piece, then the tone: what the app shows under the sentence.
fn notes(e: &Explanation) -> String {
    let mut out = String::new();
    for p in &e.parts {
        out.push_str("<div class=\"part\"><b>");
        out.push_str(&esc(&p.text));
        out.push_str("</b>");
        if !p.reading.is_empty() {
            out.push_str(&format!(
                " <span class=\"reading\">{}</span>",
                esc(&p.reading)
            ));
        }
        if !p.meaning.is_empty() {
            out.push_str(&format!(" {}", esc(&p.meaning)));
        }
        if !p.note.is_empty() {
            out.push_str(&format!(" <span class=\"note\">{}</span>", esc(&p.note)));
        }
        out.push_str("</div>");
    }
    if !e.tone.is_empty() {
        let label = crate::i18n::pick("语气", "Tone");
        out.push_str(&format!(
            "<div class=\"tone\">{label}: {}</div>",
            esc(&e.tone)
        ));
    }
    out
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// `createModel`'s parameters: front the sentence and its audio, back the translation and pieces.
pub fn model() -> Value {
    json!({
        "modelName": MODEL,
        "inOrderFields": FIELDS,
        "css": CSS,
        "cardTemplates": [{
            "Name": "Shadowing",
            "Front": "<div class=\"sentence\">{{Sentence}}</div>\n<div class=\"audio\">{{Audio}}</div>",
            "Back": "{{FrontSide}}\n<hr id=\"answer\">\n<div class=\"translation\">{{Translation}}</div>\n{{#Explanation}}<div class=\"explanation\">{{Explanation}}</div>{{/Explanation}}\n<div class=\"source\">{{Source}}</div>",
        }],
    })
}

const CSS: &str = ".card { font-family: -apple-system, \"Segoe UI\", \"Hiragino Sans\", \"Yu Gothic\", sans-serif; font-size: 20px; line-height: 1.6; text-align: center; color: #222; background: #fbfaf8; }
.nightMode.card, .night_mode .card { color: #eee; background: #2a2a2a; }
.sentence { font-family: \"Hiragino Mincho ProN\", \"Yu Mincho\", serif; font-size: 28px; margin: 12px 0; }
.translation { margin: 8px 0 14px; }
.explanation { display: inline-block; text-align: left; font-size: 16px; }
.part { margin: 3px 0; }
.reading, .note, .tone, .source { opacity: 0.6; }
.reading { font-size: 14px; }
.tone { margin-top: 8px; }
.source { margin-top: 18px; font-size: 12px; }";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::explain::Explanation;

    fn sentence(start: f64, end: f64) -> Sentence {
        serde_json::from_value(json!({ "start": start, "end": end, "text": "x" })).unwrap()
    }

    #[test]
    fn a_card_plays_a_little_either_side_but_not_into_the_next_sentence() {
        let list = [sentence(0.05, 1.0), sentence(1.2, 2.0), sentence(3.0, 4.0)];
        let near =
            |(a, b): (f64, f64), (x, y): (f64, f64)| (a - x).abs() < 1e-9 && (b - y).abs() < 1e-9;
        assert!(near(span(&list, 0), (0.0, 1.1)));
        assert!(near(span(&list, 1), (1.1, 2.3)));
        assert!(near(span(&list, 2), (2.9, 4.3)));
        // Touching sentences: no tail, but never shorter than the sentence.
        let tight = [sentence(0.0, 1.0), sentence(1.0, 2.0)];
        assert_eq!(span(&tight, 0).1, 1.0);
    }

    #[test]
    fn the_same_stretch_gets_the_same_file_name() {
        let a = media_name("/a/b.mp3", 1.0, 2.0);
        assert_eq!(a, media_name("/a/b.mp3", 1.0, 2.0));
        assert_ne!(a, media_name("/a/b.mp3", 1.0, 2.5));
        assert!(a.starts_with("shadowing-") && a.ends_with(".wav"));
    }

    #[test]
    fn fields_are_escaped_and_carry_the_explanation() {
        let e: Explanation = serde_json::from_value(json!({
            "translation": "今天要不要去散个步？",
            "parts": [
                { "text": "散歩に", "reading": "さんぽに", "meaning": "去散步", "note": "" },
                { "text": "<b>", "reading": "", "meaning": "", "note": "a & b" },
            ],
            "tone": "随意",
        }))
        .unwrap();
        let f = fields(
            "今日は<散歩>",
            "x.wav",
            Some(&e),
            &source("ごんぎつね", 83.4),
        );
        assert_eq!(f["Sentence"], "今日は&lt;散歩&gt;");
        assert_eq!(f["Audio"], "[sound:x.wav]");
        assert_eq!(f["Translation"], "今天要不要去散个步？");
        assert_eq!(f["Source"], "ごんぎつね · 1:23");
        let notes = f["Explanation"].as_str().unwrap();
        assert!(notes.contains("<b>散歩に</b> <span class=\"reading\">さんぽに</span> 去散步"));
        assert!(notes.contains("<b>&lt;b&gt;</b> <span class=\"note\">a &amp; b</span>"));
        assert!(notes.contains("随意"));
        let bare = fields("a", "x.wav", None, "s");
        assert_eq!(bare["Translation"], "");
        assert_eq!(bare["Explanation"], "");
    }

    #[test]
    fn the_note_type_has_every_field_its_template_uses() {
        let m = model();
        let t = &m["cardTemplates"][0];
        let text = format!("{}{}", t["Front"], t["Back"]);
        for f in FIELDS {
            assert!(text.contains(&format!("{{{{{f}}}}}")), "{f}");
        }
    }
}
