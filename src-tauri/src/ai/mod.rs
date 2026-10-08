//! Optional AI features: which service and model each feature uses, the API
//! keys (Keychain), and checking that a service answers. Nothing here is
//! needed for playback or subtitles.

pub mod http;
pub mod providers;
pub mod secrets;

use crate::{local, AppState};
use http::Endpoint;
use providers::{Feature, KeyPolicy, Preset, PRESETS};
use secrets::Secrets;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Choice {
    pub provider: Option<String>,
    pub model: String,
}

/// Saved in state.json. Holds no secrets: keys are in the Keychain, only a hint is kept here.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiConfig {
    pub transcribe: Choice,
    pub chat: Choice,
    /// Per-provider address: custom servers, or a local server on another port.
    pub base_urls: HashMap<String, String>,
    /// "sk-…abcd" for each provider with a saved key.
    pub key_hints: HashMap<String, String>,
}

impl AiConfig {
    pub fn choice(&self, feature: Feature) -> &Choice {
        match feature {
            Feature::Transcribe => &self.transcribe,
            Feature::Chat => &self.chat,
        }
    }

    fn choice_mut(&mut self, feature: Feature) -> &mut Choice {
        match feature {
            Feature::Transcribe => &mut self.transcribe,
            Feature::Chat => &mut self.chat,
        }
    }

    pub fn base_url(&self, preset: &Preset) -> String {
        self.base_urls
            .get(preset.id)
            .cloned()
            .unwrap_or_else(|| preset.base_url.to_string())
    }
}

/// A typed-in address, tidied: `None` clears the override.
pub fn normalize_url(url: &str) -> Result<Option<String>, String> {
    let url = url.trim().trim_end_matches('/');
    if url.is_empty() {
        return Ok(None);
    }
    if !(url.starts_with("http://") || url.starts_with("https://"))
        || url.contains(char::is_whitespace)
    {
        return Err("地址需要以 http:// 或 https:// 开头".into());
    }
    Ok(Some(url.to_string()))
}

fn preset(id: &str) -> Result<&'static Preset, String> {
    providers::find(id).ok_or_else(|| format!("未知的服务：{id}"))
}

/// Everything needed to call one provider, read out of state and the Keychain.
pub struct Target {
    pub preset: &'static Preset,
    pub base_url: String,
    pub key: Option<String>,
}

impl Target {
    pub fn resolve(state: &AppState, secrets: &Secrets, id: &str) -> Result<Self, String> {
        let preset = preset(id)?;
        let base_url = state.read(|d| d.ai.base_url(preset));
        if base_url.is_empty() {
            return Err(format!("还没有填写{}服务的地址", preset.name));
        }
        let key = match preset.key {
            KeyPolicy::None => None,
            _ => secrets.0.get(id)?,
        };
        if preset.key == KeyPolicy::Required && key.is_none() {
            return Err(format!("还没有填写 {} 的 API Key", preset.name));
        }
        Ok(Self {
            preset,
            base_url,
            key,
        })
    }

    pub fn endpoint(&self) -> Endpoint<'_> {
        Endpoint {
            api: self.preset.api,
            base_url: &self.base_url,
            key: self.key.as_deref(),
            name: self.preset.name,
            local: self.preset.local,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiOverview {
    presets: Vec<&'static Preset>,
    config: AiConfig,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestReport {
    /// Usable models the service listed.
    models: usize,
    /// Whether the chosen model is among them.
    model_found: bool,
}

#[tauri::command]
pub fn ai_get(state: State<AppState>) -> AiOverview {
    AiOverview {
        // Transcribing on this Mac is only offered where it runs well.
        presets: PRESETS
            .iter()
            .filter(|p| p.id != local::PROVIDER || local::models::supported())
            .collect(),
        config: state.read(|d| d.ai.clone()),
    }
}

#[tauri::command]
pub fn ai_choose(
    state: State<AppState>,
    feature: Feature,
    provider: Option<String>,
    model: String,
) -> Result<AiConfig, String> {
    if let Some(id) = &provider {
        if !preset(id)?.supports(feature) {
            return Err("这个服务不支持该功能".into());
        }
    }
    let model = model.trim().to_string();
    state.update(|d| *d.ai.choice_mut(feature) = Choice { provider, model })?;
    Ok(state.read(|d| d.ai.clone()))
}

#[tauri::command]
pub fn ai_set_base_url(
    state: State<AppState>,
    provider: String,
    url: String,
) -> Result<AiConfig, String> {
    let preset = preset(&provider)?;
    let url = normalize_url(&url)?.filter(|u| u != preset.base_url);
    state.update(|d| match url {
        Some(url) => drop(d.ai.base_urls.insert(provider, url)),
        None => drop(d.ai.base_urls.remove(&provider)),
    })?;
    Ok(state.read(|d| d.ai.clone()))
}

/// Saves (or with an empty key, deletes) a provider's key in the Keychain.
#[tauri::command]
pub fn ai_set_key(
    state: State<AppState>,
    secrets: State<Secrets>,
    provider: String,
    key: String,
) -> Result<AiConfig, String> {
    if preset(&provider)?.key == KeyPolicy::None {
        return Err("这个服务不需要 API Key".into());
    }
    let key = key.trim();
    if key.is_empty() {
        secrets.0.delete(&provider)?;
        state.update(|d| drop(d.ai.key_hints.remove(&provider)))?;
    } else {
        secrets.0.set(&provider, key)?;
        state.update(|d| drop(d.ai.key_hints.insert(provider, secrets::hint(key))))?;
    }
    Ok(state.read(|d| d.ai.clone()))
}

/// Models a provider offers for a feature.
#[tauri::command]
pub async fn ai_models(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    provider: String,
    feature: Feature,
) -> Result<Vec<String>, String> {
    if provider == local::PROVIDER {
        return Ok(local::downloaded(&state)
            .into_iter()
            .map(String::from)
            .collect());
    }
    let target = Target::resolve(&state, &secrets, &provider)?;
    let ids = target.endpoint().list_models().await?;
    Ok(providers::filter_models(target.preset, feature, ids))
}

/// Checks the chosen service for a feature answers with this key and knows the model.
#[tauri::command]
pub async fn ai_test(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    feature: Feature,
) -> Result<TestReport, String> {
    let choice = state.read(|d| d.ai.choice(feature).clone());
    let id = choice.provider.ok_or("还没有选择服务")?;
    if id == local::PROVIDER {
        let models = local::downloaded(&state);
        return Ok(TestReport {
            model_found: models.contains(&choice.model.as_str()),
            models: models.len(),
        });
    }
    let target = Target::resolve(&state, &secrets, &id)?;
    let ids = target.endpoint().list_models().await?;
    let models = providers::filter_models(target.preset, feature, ids);
    Ok(TestReport {
        model_found: models.contains(&choice.model),
        models: models.len(),
    })
}

/// Opens the provider's API-key page in the default browser (fixed URLs only).
#[tauri::command]
pub fn ai_open_key_page(provider: String) -> Result<(), String> {
    let url = preset(&provider)?.key_url.ok_or("这个服务没有 Key 页面")?;
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(drop)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_tidied_and_checked() {
        assert_eq!(
            normalize_url(" http://localhost:8080/v1/ ")
                .unwrap()
                .as_deref(),
            Some("http://localhost:8080/v1")
        );
        assert_eq!(normalize_url("  ").unwrap(), None);
        assert!(normalize_url("localhost:8080").is_err());
        assert!(normalize_url("https://a b").is_err());
    }

    #[test]
    fn base_url_falls_back_to_the_preset() {
        let mut cfg = AiConfig::default();
        let ollama = providers::find("ollama").unwrap();
        assert_eq!(cfg.base_url(ollama), "http://localhost:11434/v1");
        cfg.base_urls
            .insert("ollama".into(), "http://10.0.0.2:11434/v1".into());
        assert_eq!(cfg.base_url(ollama), "http://10.0.0.2:11434/v1");
    }

    #[test]
    fn config_from_an_older_state_file_is_empty_not_an_error() {
        let cfg: AiConfig = serde_json::from_str(r#"{"chat":{"provider":"openai"}}"#).unwrap();
        assert_eq!(cfg.chat.provider.as_deref(), Some("openai"));
        assert_eq!(cfg.chat.model, "");
        assert_eq!(cfg.transcribe, Choice::default());
    }
}
