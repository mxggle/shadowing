//! Optional AI features: which service and model each feature uses, the API
//! keys (Keychain), and checking that a service answers. Nothing here is
//! needed for playback or subtitles.

pub mod chat;
pub mod chatgpt;
pub mod check;
pub mod http;
pub mod oauth;
pub mod openrouter;
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
    /// "sk-…abcd" for each provider with a saved key (the account email for ChatGPT).
    pub key_hints: HashMap<String, String>,
    /// Sign in with ChatGPT: the client id OpenAI issued to this app, reused on later sign-ins.
    pub chatgpt_client_id: Option<String>,
    /// Sign in with ChatGPT: this install's stable host id.
    pub chatgpt_host_id: Option<String>,
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
            .filter(|_| preset.url_editable())
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
        return Err(crate::i18n::pick(
            "地址需要以 http:// 或 https:// 开头",
            "The address must start with http:// or https://.",
        )
        .into());
    }
    Ok(Some(url.to_string()))
}

fn preset(id: &str) -> Result<&'static Preset, String> {
    providers::find(id).ok_or_else(|| tr!("未知的服务：{id}", "Unknown service: {id}"))
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
        let name = preset.name.get();
        let base_url = state.read(|d| d.ai.base_url(preset));
        if base_url.is_empty() {
            return Err(tr!(
                "还没有填写{name}服务的地址",
                "Enter an address for the {name} service first."
            ));
        }
        if preset.key == KeyPolicy::Account && !state.read(|d| d.ai.key_hints.contains_key(id)) {
            return Err(tr!(
                "还没有用 {name} 登录",
                "You're not signed in with your {name} yet."
            ));
        }
        let key = match preset.key {
            // Account tokens are put on by `ready` (they may need refreshing first).
            KeyPolicy::None | KeyPolicy::Account => None,
            _ => secrets.0.get(id)?,
        };
        if preset.key == KeyPolicy::Required && key.is_none() {
            return Err(tr!(
                "还没有填写 {name} 的 API Key",
                "Enter your {name} API key first."
            ));
        }
        Ok(Self {
            preset,
            base_url,
            key,
        })
    }

    /// Finishes what `resolve` can't do synchronously: a fresh account token.
    pub async fn ready(mut self, secrets: &Secrets) -> Result<Self, String> {
        if self.preset.key == KeyPolicy::Account {
            chatgpt::authorize(&mut self, secrets).await?;
        }
        Ok(self)
    }

    pub fn endpoint(&self) -> Endpoint<'_> {
        Endpoint {
            api: self.preset.api,
            base_url: &self.base_url,
            key: self.key.as_deref(),
            name: self.preset.name.get(),
            local: self.preset.local,
        }
    }
}

/// The service and model chosen under 「句子解释」, ready to call.
pub async fn chat_target(state: &AppState, secrets: &Secrets) -> Result<(Target, String), String> {
    let choice = state.read(|d| d.ai.choice(Feature::Chat).clone());
    let id = choice.provider.ok_or(crate::i18n::pick(
        "还没有设置「句子解释」用的 AI 服务",
        "Choose an AI service for explanations first.",
    ))?;
    if choice.model.is_empty() {
        return Err(crate::i18n::pick(
            "还没有选择「句子解释」用的模型",
            "Choose a model for explanations first.",
        )
        .into());
    }
    let target = Target::resolve(state, secrets, &id)?.ready(secrets).await?;
    Ok((target, choice.model))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiOverview {
    presets: Vec<&'static Preset>,
    config: AiConfig,
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
            return Err(crate::i18n::pick(
                "这个服务不支持该功能",
                "This service doesn't support that feature.",
            )
            .into());
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
    if !preset.url_editable() {
        let name = preset.name.get();
        return Err(tr!(
            "{name} 的地址不能修改",
            "The address of {name} can't be changed."
        ));
    }
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
    if matches!(preset(&provider)?.key, KeyPolicy::None | KeyPolicy::Account) {
        return Err(crate::i18n::pick(
            "这个服务不需要 API Key",
            "This service doesn't need an API key.",
        )
        .into());
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
    let target = Target::resolve(&state, &secrets, &provider)?
        .ready(&secrets)
        .await?;
    let ids = target.endpoint().list_models().await?;
    Ok(providers::filter_models(target.preset, feature, ids))
}

/// Opens the provider's API-key page in the default browser (fixed URLs only).
#[tauri::command]
pub fn ai_open_key_page(provider: String) -> Result<(), String> {
    let url = preset(&provider)?.key_url.ok_or(crate::i18n::pick(
        "这个服务没有 Key 页面",
        "This service has no API key page.",
    ))?;
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
    fn fixed_cloud_services_ignore_an_address_override() {
        let mut cfg = AiConfig::default();
        for id in ["openai", "anthropic", "chatgpt"] {
            let preset = providers::find(id).unwrap();
            assert!(!preset.url_editable(), "{id}");
            cfg.base_urls
                .insert(id.into(), "https://elsewhere.example/v1".into());
            assert_eq!(cfg.base_url(preset), preset.base_url, "{id}");
        }
        assert!(providers::find("custom-chat").unwrap().url_editable());
        assert!(providers::find("ollama").unwrap().url_editable());
    }

    #[test]
    fn config_from_an_older_state_file_is_empty_not_an_error() {
        let cfg: AiConfig = serde_json::from_str(r#"{"chat":{"provider":"openai"}}"#).unwrap();
        assert_eq!(cfg.chat.provider.as_deref(), Some("openai"));
        assert_eq!(cfg.chat.model, "");
        assert_eq!(cfg.transcribe, Choice::default());
    }
}
