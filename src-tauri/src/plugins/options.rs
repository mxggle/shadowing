//! A plugin's own options (manifest `contributes.settings`): the app draws them
//! in 设置 → 插件, keeps what was picked in state.json and sends the values with
//! every request. A type this app doesn't know is left out, not refused, so a
//! plugin written for a newer app still installs and runs with its defaults.

use super::{installed, list, PluginInfo};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::State;

/// The types this app draws.
const KINDS: [&str; 3] = ["select", "toggle", "text"];
const MAX_TEXT: usize = 200;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Setting {
    pub key: String,
    /// "select" (one of `options`), "toggle" (true / false) or "text".
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    pub default: Value,
    #[serde(default)]
    pub options: Vec<Choice>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Choice {
    pub value: String,
    pub label: String,
}

impl Setting {
    pub fn known(&self) -> bool {
        KINDS.contains(&self.kind.as_str())
    }

    /// Whether `value` is one this setting takes.
    pub fn takes(&self, value: &Value) -> bool {
        match (self.kind.as_str(), value) {
            ("select", Value::String(v)) => self.options.iter().any(|o| &o.value == v),
            ("toggle", Value::Bool(_)) => true,
            ("text", Value::String(v)) => v.chars().count() <= MAX_TEXT,
            _ => false,
        }
    }

    /// A known type with a default it takes.
    pub fn check(&self) -> Result<(), String> {
        let key = &self.key;
        if self.known() && !self.takes(&self.default) {
            return Err(tr!(
                "设置 “{key}” 的默认值不对（select 要是选项之一，toggle 要是 true / false，text 要是一句话）",
                "The default of the setting “{key}” isn't valid (select: one of its options, toggle: true / false, text: a string)"
            ));
        }
        Ok(())
    }
}

/// The values to send: each known setting's default, unless a value it takes was picked.
pub fn values(
    settings: &[Setting],
    saved: Option<&HashMap<String, Value>>,
) -> HashMap<String, Value> {
    settings
        .iter()
        .filter(|s| s.known())
        .map(|s| {
            let picked = saved.and_then(|v| v.get(&s.key)).filter(|v| s.takes(v));
            (s.key.clone(), picked.unwrap_or(&s.default).clone())
        })
        .collect()
}

/// One of a plugin's options as settings shows it, with the value in use.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingInfo {
    key: String,
    kind: String,
    label: String,
    options: Vec<Choice>,
    value: Value,
}

pub fn shown(settings: &[Setting], saved: Option<&HashMap<String, Value>>) -> Vec<SettingInfo> {
    let values = values(settings, saved);
    settings
        .iter()
        .filter(|s| s.known())
        .map(|s| SettingInfo {
            key: s.key.clone(),
            kind: s.kind.clone(),
            label: s.label.clone(),
            options: s.options.clone(),
            value: values.get(&s.key).cloned().unwrap_or(Value::Null),
        })
        .collect()
}

/// Picks one of a plugin's own options.
#[tauri::command(async)]
pub fn plugins_set_setting(
    state: State<AppState>,
    id: String,
    key: String,
    value: Value,
) -> Result<Vec<PluginInfo>, String> {
    let offered = installed(&state).into_iter().any(|p| {
        p.manifest.id == id
            && p.manifest
                .contributes
                .settings
                .iter()
                .any(|s| s.key == key && s.known() && s.takes(&value))
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
    use serde_json::json;

    fn settings() -> Vec<Setting> {
        serde_json::from_value(json!([
            { "key": "style", "type": "select", "label": "注音用", "default": "hiragana",
              "options": [{ "value": "hiragana", "label": "平假名" }, { "value": "romaji", "label": "罗马音" }] },
            { "key": "on", "type": "toggle", "label": "只标难字", "default": false },
            { "key": "note", "type": "text", "label": "备注", "default": "" },
            { "key": "color", "type": "color", "label": "颜色", "default": "red" }
        ]))
        .unwrap()
    }

    #[test]
    fn values_fall_back_to_their_default() {
        let s = settings();
        let v = values(&s, None);
        assert_eq!(v["style"], "hiragana");
        assert_eq!(v["on"], false);
        let saved = HashMap::from([
            ("style".to_string(), json!("romaji")),
            ("on".to_string(), json!("yes")),
        ]);
        let v = values(&s, Some(&saved));
        assert_eq!(v["style"], "romaji");
        assert_eq!(v["on"], false, "not a bool");
        let gone = HashMap::from([("style".to_string(), json!("kanji"))]);
        assert_eq!(values(&s, Some(&gone))["style"], "hiragana");
    }

    #[test]
    fn leaves_out_types_it_doesnt_know() {
        let s = settings();
        assert!(!values(&s, None).contains_key("color"));
        assert_eq!(shown(&s, None).len(), 3);
        assert!(s[3].check().is_ok(), "a newer type doesn't stop the plugin");
    }

    #[test]
    fn checks_defaults() {
        let mut s = settings();
        s[0].default = json!("kanji");
        assert!(s[0].check().is_err());
        s[1].default = json!("false");
        assert!(s[1].check().is_err());
    }
}
