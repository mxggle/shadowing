//! Shadowing plugin: 日语注音. Speaks the app's plugin protocol (JSON-RPC 2.0,
//! one message per line on stdin / stdout; see docs/plugin-dev.md): an
//! annotator (`annotate/run`) that puts each kanji's reading over it, for the
//! sentences that are Japanese. The dictionary (IPADIC) is built into the
//! program, so nothing is downloaded.

mod ruby;

use lindera::dictionary::load_dictionary;
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;
use ruby::{Piece, Style};
use serde_json::{json, Value};
use std::borrow::Cow;
use std::io::{BufRead, Write};

/// The dictionary's reading, in katakana ("*" when it doesn't know the word).
const READING: usize = 7;

fn sentence(segmenter: &Segmenter, text: &str, style: Style) -> Result<Vec<Piece>, String> {
    let mut tokens = segmenter
        .segment(Cow::Borrowed(text))
        .map_err(|e| format!("分词失败：{e}"))?;
    let mut pieces: Vec<Piece> = Vec::new();
    let mut at = 0;
    for token in tokens.iter_mut() {
        let surface = token.surface.to_string();
        // Whitespace the segmenter skipped stays in the sentence.
        if let Some(skipped) = text[at..].find(&surface) {
            push(
                &mut pieces,
                Piece {
                    text: text[at..at + skipped].to_string(),
                    ruby: None,
                },
            );
            at += skipped + surface.len();
        }
        let reading = token.get_detail(READING).unwrap_or("*").to_string();
        for mut piece in ruby::word(&surface, &reading) {
            piece.ruby = piece.ruby.map(|r| ruby::styled(&r, style));
            push(&mut pieces, piece);
        }
    }
    push(
        &mut pieces,
        Piece {
            text: text[at.min(text.len())..].to_string(),
            ruby: None,
        },
    );
    Ok(pieces)
}

/// Adds a piece, joining plain text to the plain text before it.
fn push(pieces: &mut Vec<Piece>, piece: Piece) {
    if piece.text.is_empty() {
        return;
    }
    match pieces.last_mut() {
        Some(last) if last.ruby.is_none() && piece.ruby.is_none() => {
            last.text.push_str(&piece.text)
        }
        _ => pieces.push(piece),
    }
}

fn has_kana(text: &str) -> bool {
    text.chars()
        .any(|c| matches!(c, '\u{3041}'..='\u{3096}' | '\u{30A1}'..='\u{30FA}' | 'ー'))
}

/// Which sentences are Japanese: those with kana, and all of them when at
/// least a fifth of three or more have kana (a Japanese sentence all in kanji
/// is rare; Chinese, which would get wrong readings, has no kana).
fn japanese(texts: &[&str]) -> Vec<bool> {
    let with_kana = texts.iter().filter(|t| has_kana(t)).count();
    let all = texts.len() >= 3 && with_kana > 0 && with_kana * 5 >= texts.len();
    texts.iter().map(|t| all || has_kana(t)).collect()
}

fn annotate(segmenter: &Segmenter, params: &Value) -> Result<Value, String> {
    let style = Style::parse(params["settings"]["style"].as_str());
    let texts: Vec<&str> = params["texts"]
        .as_array()
        .ok_or("没有给句子")?
        .iter()
        .map(|t| t.as_str().unwrap_or_default())
        .collect();
    let results = texts
        .iter()
        .zip(japanese(&texts))
        .map(|(text, japanese)| {
            if !japanese {
                return Ok(Value::Null);
            }
            let pieces: Vec<Value> = sentence(segmenter, text, style)?
                .into_iter()
                .map(|p| match p.ruby {
                    Some(r) => json!({ "text": p.text, "ruby": r }),
                    None => json!({ "text": p.text }),
                })
                .collect();
            Ok(json!({ "pieces": pieces }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(json!({ "results": results }))
}

fn main() {
    let segmenter = match load_dictionary("embedded://ipadic") {
        Ok(dictionary) => Segmenter::new(Mode::Normal, dictionary, None),
        Err(e) => {
            eprintln!("词典读不出来：{e}");
            std::process::exit(1);
        }
    };
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        // Notifications ($/cancel) need no answer: every request is quick.
        let Some(id) = msg.get("id").cloned() else {
            continue;
        };
        let method = msg["method"].as_str().unwrap_or_default();
        let result = match method {
            "initialize" => Ok(json!({ "name": "日语注音", "version": env!("CARGO_PKG_VERSION") })),
            "annotate/run" => annotate(&segmenter, &msg["params"]),
            other => Err(format!("这个插件不认识 “{other}”")),
        };
        let reply = match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(message) => {
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } })
            }
        };
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shown(text: &str, style: Style) -> String {
        let segmenter = Segmenter::new(
            Mode::Normal,
            load_dictionary("embedded://ipadic").unwrap(),
            None,
        );
        sentence(&segmenter, text, style)
            .unwrap()
            .iter()
            .map(|p| match &p.ruby {
                Some(r) => format!("{}({r})", p.text),
                None => p.text.clone(),
            })
            .collect()
    }

    #[test]
    fn reads_a_sentence() {
        assert_eq!(
            shown("今日は東京へ行きました。", Style::Hiragana),
            "今日(きょう)は東京(とうきょう)へ行(い)きました。"
        );
        assert_eq!(
            shown("食べ物が美味しい", Style::Katakana),
            "食(タ)べ物(モノ)が美味(オイ)しい"
        );
        assert_eq!(
            shown("写真を撮る", Style::Romaji),
            "写真(shashin)を撮(to)る"
        );
    }

    #[test]
    fn reads_only_japanese() {
        assert_eq!(
            japanese(&["今日は", "東京", "日本語能力試験"]),
            [true, true, true]
        );
        assert_eq!(
            japanese(&["他说了「すごい」", "一", "二", "三", "四", "五"]),
            [true, false, false, false, false, false]
        );
        assert_eq!(japanese(&["我们走吧"]), [false]);
        let segmenter = Segmenter::new(
            Mode::Normal,
            load_dictionary("embedded://ipadic").unwrap(),
            None,
        );
        let answer = annotate(
            &segmenter,
            &json!({ "texts": ["我们走吧", "東京へ"], "settings": { "style": "katakana" } }),
        )
        .unwrap();
        assert_eq!(answer["results"][0], Value::Null);
        assert_eq!(
            answer["results"][1]["pieces"][0],
            json!({ "text": "東京", "ruby": "トウキョウ" })
        );
    }

    #[test]
    fn keeps_every_character() {
        for text in ["ええ、 そうです 。", "3人で  Tokyo に行く", "", "  東京  "] {
            let joined = shown(text, Style::Hiragana)
                .split(['(', ')'])
                .enumerate()
                .filter(|(i, _)| i % 2 == 0)
                .map(|(_, s)| s)
                .collect::<String>();
            assert_eq!(joined, text);
        }
    }
}
