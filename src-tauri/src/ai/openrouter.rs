//! "Sign in with OpenRouter": the official PKCE flow hands back an ordinary,
//! user-controlled API key, which is then stored like a pasted one.
//! https://openrouter.ai/docs/use-cases/oauth-pkce

use super::oauth::{self, Loopback};
use super::secrets::{self, Secrets};
use super::AiConfig;
use crate::AppState;
use serde_json::json;
use tauri::State;

const PROVIDER: &str = "openrouter";

#[tauri::command]
pub async fn ai_sign_in_openrouter(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
) -> Result<AiConfig, String> {
    let (verifier, challenge) = oauth::pkce()?;
    let csrf = oauth::random(16)?;
    let loopback = Loopback::bind()?;
    let callback = format!("http://localhost:{}/callback", loopback.port);
    let url = tauri::Url::parse_with_params(
        "https://openrouter.ai/auth",
        [
            ("callback_url", callback.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", csrf.as_str()),
            ("key_label", "Shadowing"),
        ],
    )
    .map_err(|e| e.to_string())?;
    oauth::open_browser(url.as_str())?;

    let query =
        tauri::async_runtime::spawn_blocking(move || loopback.wait("/callback", "OpenRouter"))
            .await
            .map_err(|e| e.to_string())??;
    if query.get("state") != Some(&csrf) {
        return Err("登录回调不匹配，请重试".into());
    }
    let code = query.get("code").ok_or("没有完成 OpenRouter 授权")?;

    let body = json!({ "code": code, "code_verifier": verifier, "code_challenge_method": "S256" });
    let res = super::http::client()
        .post("https://openrouter.ai/api/v1/auth/keys")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("无法连接到 OpenRouter：{e}"))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if status != 200 {
        return Err(super::http::describe_status(status, &text, "OpenRouter"));
    }
    let key = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v["key"].as_str().map(String::from))
        .ok_or("OpenRouter 没有返回 API Key")?;

    secrets.0.set(PROVIDER, &key)?;
    state.update(|d| drop(d.ai.key_hints.insert(PROVIDER.into(), secrets::hint(&key))))?;
    Ok(state.read(|d| d.ai.clone()))
}

/// Stops waiting for the browser.
#[tauri::command]
pub fn ai_sign_in_cancel() {
    oauth::CANCEL.store(true, std::sync::atomic::Ordering::Relaxed);
}
