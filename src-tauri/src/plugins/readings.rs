//! 注音: a plugin tells how the words of sentences are read (`readings/run`),
//! the app shows it over them. The plugin answers each sentence in pieces that
//! join back into it; anything that doesn't is shown without readings.
//! Also the plugins' own settings (manifest `contributes.settings`).

use super::import::open;
use super::manifest::Manifest;
use super::{installed, list, PluginInfo};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, State};

/// A plugin that hasn't answered by then is stopped (cancelled).
const TIMEOUT: Duration = Duration::from_secs(30);
/// Longer readings are cut: a plugin can't fill the sentence list with text.
const MAX_RUBY: usize = 40;

/// A piece of a sentence, and what is shown over it.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Piece {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ruby: Option<String>,
}

/// The plugin's settings: each one's default, unless a value it offers was picked.
pub fn values(
    manifest: &Manifest,
    saved: Option<&HashMap<String, String>>,
) -> HashMap<String, String> {
    manifest
        .contributes
        .settings
        .iter()
        .map(|s| {
            let picked = saved
                .and_then(|v| v.get(&s.key))
                .filter(|v| s.options.iter().any(|o| &o.value == *v));
            (s.key.clone(), picked.unwrap_or(&s.default).clone())
        })
        .collect()
}

/// The pieces of `text` as the plugin answered, if they join back into it.
/// Readings are trimmed and cut; empty ones are dropped.
pub fn checked(text: &str, pieces: Vec<Piece>) -> Vec<Piece> {
    let joined: String = pieces.iter().map(|p| p.text.as_str()).collect();
    if joined != text {
        return vec![Piece {
            text: text.to_string(),
            ruby: None,
        }];
    }
    pieces
        .into_iter()
        .filter(|p| !p.text.is_empty())
        .map(|p| Piece {
            ruby: p
                .ruby
                .map(|r| r.trim().chars().take(MAX_RUBY).collect::<String>())
                .filter(|r| !r.is_empty()),
            text: p.text,
        })
        .collect()
}

#[derive(Deserialize)]
struct Answer {
    results: Vec<Vec<Piece>>,
}

/// Readings for each sentence, from the first plugin that reads `language`;
/// None when no plugin does.
#[tauri::command(async)]
pub fn plugins_readings(
    app: AppHandle,
    state: State<AppState>,
    language: String,
    texts: Vec<String>,
) -> Result<Option<Vec<Vec<Piece>>>, String> {
    let Some((plugin, readings)) = installed(&state).into_iter().find_map(|p| {
        let r = p
            .manifest
            .contributes
            .readings
            .iter()
            .find(|r| r.languages.contains(&language))?
            .clone();
        Some((p, r))
    }) else {
        return Ok(None);
    };
    let settings = state.read(|s| {
        values(
            &plugin.manifest,
            s.plugins.get(&plugin.manifest.id).map(|p| &p.settings),
        )
    });
    let cancel = Arc::new(AtomicBool::new(false));
    let timer = cancel.clone();
    std::thread::spawn(move || {
        std::thread::sleep(TIMEOUT);
        timer.store(true, Ordering::Relaxed);
    });
    let mut process = open(&app, &plugin, &cancel)?;
    let params = json!({ "reading": readings.id, "language": language, "texts": texts, "settings": settings });
    let result = process.call("readings/run", params, &cancel, &mut |_, _| {})?;
    cancel.store(true, Ordering::Relaxed);
    let answer: Answer = serde_json::from_value::<Answer>(result)
        .ok()
        .filter(|a| a.results.len() == texts.len())
        .ok_or(crate::i18n::pick(
            "注音插件的回答看不懂",
            "The reading plugin's answer couldn't be read",
        ))?;
    Ok(Some(
        texts
            .iter()
            .zip(answer.results)
            .map(|(text, pieces)| checked(text, pieces))
            .collect(),
    ))
}

/// Picks one of a plugin's own settings.
#[tauri::command(async)]
pub fn plugins_set_setting(
    state: State<AppState>,
    id: String,
    key: String,
    value: String,
) -> Result<Vec<PluginInfo>, String> {
    let offered = installed(&state).into_iter().any(|p| {
        p.manifest.id == id
            && p.manifest
                .contributes
                .settings
                .iter()
                .any(|s| s.key == key && s.options.iter().any(|o| o.value == value))
    });
    if !offered {
        return Err(
            crate::i18n::pick("这个插件没有这个选项", "This plugin has no such option").into(),
        );
    }
    state.update(|s| {
        s.plugins.entry(id).or_default().settings.insert(key, value);
    })?;
    Ok(list(&state))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn piece(text: &str, ruby: Option<&str>) -> Piece {
        Piece {
            text: text.into(),
            ruby: ruby.map(String::from),
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
            checked("東京へ", pieces),
            vec![piece("東京", Some("とうきょう")), piece("へ", None)]
        );
    }

    #[test]
    fn shows_the_sentence_plain_when_the_pieces_dont_join() {
        let pieces = vec![piece("東京", Some("とうきょう"))];
        assert_eq!(checked("東京へ", pieces), vec![piece("東京へ", None)]);
    }

    #[test]
    fn cuts_long_readings() {
        let long = "あ".repeat(100);
        let got = checked("字", vec![piece("字", Some(&long))]);
        assert_eq!(got[0].ruby.as_ref().unwrap().chars().count(), MAX_RUBY);
    }

    #[test]
    fn settings_fall_back_to_their_default() {
        let m: Manifest = serde_json::from_str(
            r#"{"id":"furigana","name":"日语注音","version":"0.1.0","protocol":1,"main":{},
            "contributes":{"settings":[{"key":"style","type":"select","label":"注音用","default":"hiragana",
              "options":[{"value":"hiragana","label":"平假名"},{"value":"romaji","label":"罗马音"}]}]}}"#,
        )
        .unwrap();
        assert_eq!(values(&m, None)["style"], "hiragana");
        let saved = HashMap::from([("style".to_string(), "romaji".to_string())]);
        assert_eq!(values(&m, Some(&saved))["style"], "romaji");
        let gone = HashMap::from([("style".to_string(), "kanji".to_string())]);
        assert_eq!(values(&m, Some(&gone))["style"], "hiragana");
    }
}
