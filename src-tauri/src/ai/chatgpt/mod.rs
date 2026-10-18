//! "Sign in with ChatGPT" (preview, open-source apps): use the learner's
//! ChatGPT Plus/Pro plan for explanations through the Responses API.
//! https://developers.openai.com/siwc/token-sharing-open-source
//!
//! Tokens live in the Keychain as one JSON item; state.json only keeps the
//! account email (as the "hint"), the issued client id and this Mac's host id.

pub mod sign_in;

use super::oauth;
use super::secrets::Secrets;
use super::{AiConfig, Target};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;

pub const PROVIDER: &str = "chatgpt";
const ISSUER: &str = "https://auth.openai.com";
const AUTHORIZE: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE: &str = "https://api.openai.com/v1";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub client_id: String,
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    /// Unix seconds.
    pub expires_at: u64,
    pub email: String,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn load(secrets: &Secrets) -> Result<Option<Credentials>, String> {
    Ok(secrets
        .0
        .get(PROVIDER)?
        .and_then(|json| serde_json::from_str(&json).ok()))
}

fn store(secrets: &Secrets, c: &Credentials) -> Result<(), String> {
    secrets.0.set(
        PROVIDER,
        &serde_json::to_string(c).map_err(|e| e.to_string())?,
    )
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_in: u64,
    #[serde(default)]
    scope: String,
}

async fn token_request(form: &[(&str, &str)], url: &str) -> Result<TokenResponse, String> {
    let res = super::http::client()
        .post(url)
        .form(form)
        .send()
        .await
        .map_err(|e| tr!("无法连接到 OpenAI：{e}", "Couldn't reach OpenAI: {e}"))?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if status != 200 {
        let name = crate::i18n::pick("OpenAI 登录", "OpenAI sign-in");
        return Err(super::http::describe_status(status, &body, name));
    }
    serde_json::from_str(&body).map_err(|_| {
        crate::i18n::pick(
            "OpenAI 登录返回的数据无法识别",
            "The data from OpenAI sign-in couldn't be read.",
        )
        .to_string()
    })
}

/// Checks the ID token's claims. It came straight from the token endpoint over
/// TLS, which OIDC Core §3.1.3.7 accepts in place of a signature check.
/// Returns the account email.
pub fn check_id_token(
    token: &str,
    client_id: &str,
    nonce: &str,
    now: u64,
) -> Result<String, String> {
    let bad = |what: &str| {
        tr!(
            "ChatGPT 登录信息校验失败（{what}），请重试",
            "Couldn't verify the ChatGPT sign-in ({what}). Try again."
        )
    };
    let malformed = crate::i18n::pick("格式", "format");
    let payload = token.split('.').nth(1).ok_or_else(|| bad(malformed))?;
    let claims: Value = oauth::base64url_decode(payload)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| bad(malformed))?;
    if claims["iss"] != ISSUER {
        return Err(bad(crate::i18n::pick("签发方", "issuer")));
    }
    let aud_ok = match &claims["aud"] {
        Value::String(a) => a == client_id,
        Value::Array(list) => list.iter().any(|a| a == client_id),
        _ => false,
    };
    if !aud_ok {
        return Err(bad(crate::i18n::pick("应用", "app")));
    }
    if claims["exp"].as_u64().is_none_or(|exp| exp < now) {
        return Err(bad(crate::i18n::pick("已过期", "expired")));
    }
    if claims["nonce"] != nonce {
        return Err(bad("nonce"));
    }
    Ok(claims["email"]
        .as_str()
        .unwrap_or(crate::i18n::pick("ChatGPT 账号", "ChatGPT account"))
        .to_string())
}

/// One refresh at a time: refresh tokens rotate, so racing two would lose one.
static REFRESH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Puts a current access token on the target, refreshing it first if needed.
pub async fn authorize(target: &mut Target, secrets: &Secrets) -> Result<(), String> {
    let _guard = REFRESH.lock().await;
    let mut c = load(secrets)?.ok_or(crate::i18n::pick(
        "还没有用 ChatGPT 登录",
        "You're not signed in with ChatGPT yet.",
    ))?;
    if c.expires_at <= now() + 60 {
        let t = token_request(
            &[
                ("grant_type", "refresh_token"),
                ("client_id", &c.client_id),
                ("refresh_token", &c.refresh_token),
                ("resource", RESOURCE),
            ],
            TOKEN,
        )
        .await
        .map_err(|e| {
            tr!(
                "ChatGPT 登录已失效，请重新登录（{e}）",
                "Your ChatGPT sign-in has expired. Sign in again. ({e})"
            )
        })?;
        c.access_token = t.access_token;
        c.refresh_token = t.refresh_token.unwrap_or(c.refresh_token);
        c.expires_at = now() + t.expires_in;
        store(secrets, &c)?;
    }
    target.key = Some(c.access_token);
    Ok(())
}

#[tauri::command]
pub async fn ai_sign_out_chatgpt(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
) -> Result<AiConfig, String> {
    let revoked = match load(&secrets)? {
        Some(c) => revoke(&c).await.is_ok(),
        None => true,
    };
    secrets.0.delete(PROVIDER)?;
    state.update(|d| drop(d.ai.key_hints.remove(PROVIDER)))?;
    if !revoked {
        return Err(crate::i18n::pick(
            "已在这台 Mac 上退出，但没能确认 OpenAI 那边已撤销登录",
            "Signed out on this Mac, but couldn't confirm that OpenAI revoked the sign-in.",
        )
        .into());
    }
    Ok(state.read(|d| d.ai.clone()))
}

async fn revoke(c: &Credentials) -> Result<(), String> {
    let client = super::http::client();
    let config: Value = client
        .get(format!("{ISSUER}/.well-known/openid-configuration"))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let url = config["revocation_endpoint"]
        .as_str()
        .ok_or("no revocation endpoint")?;
    let res = client
        .post(url)
        .form(&[
            ("token", c.refresh_token.as_str()),
            ("token_type_hint", "refresh_token"),
            ("client_id", &c.client_id),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.status()
        .is_success()
        .then_some(())
        .ok_or_else(|| res.status().to_string())
}

/// Text from a streamed Responses API reply (`stream: true` is required here).
pub fn read_stream(body: &str) -> Result<String, String> {
    let mut text = String::new();
    for line in body.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(data.trim()) else {
            continue;
        };
        match event["type"].as_str().unwrap_or_default() {
            "response.output_text.delta" => {
                text.push_str(event["delta"].as_str().unwrap_or_default())
            }
            "response.completed" => return Ok(text.trim().to_string()),
            "response.incomplete" => {
                return Err(crate::i18n::pick(
                    "ChatGPT 的回答不完整，请重试",
                    "ChatGPT's answer was incomplete. Try again.",
                )
                .into())
            }
            "response.failed" | "error" => {
                let error = &event["response"]["error"];
                let code = error["code"]
                    .as_str()
                    .or(event["code"].as_str())
                    .unwrap_or_default();
                return Err(match code {
                    "subscription_sharing_usage_limit_exceeded" => crate::i18n::pick(
                        "ChatGPT 套餐额度暂时用完了，请稍后再试",
                        "You've used up your ChatGPT plan's usage limit for now. Try again later.",
                    )
                    .into(),
                    "subscription_sharing_usage_unavailable" => crate::i18n::pick(
                        "这个 ChatGPT 账号现在不能共享额度给其他应用",
                        "This ChatGPT account can't share its usage with other apps right now.",
                    )
                    .into(),
                    _ => {
                        let reason = error["message"].as_str().unwrap_or(code);
                        tr!(
                            "ChatGPT 回答失败：{reason}",
                            "ChatGPT couldn't answer: {reason}"
                        )
                    }
                });
            }
            _ => {}
        }
    }
    Err(crate::i18n::pick(
        "ChatGPT 的回答中断了，请重试",
        "ChatGPT's answer was cut off. Try again.",
    )
    .into())
}

/// Model slugs offered to this account (`visibility == "list"`).
pub fn read_models(body: &str) -> Option<Vec<String>> {
    let v: Value = serde_json::from_str(body).ok()?;
    Some(
        v["models"]
            .as_array()?
            .iter()
            .filter(|m| m["visibility"] == "list")
            .filter_map(|m| m["slug"].as_str().map(String::from))
            .collect(),
    )
}

#[cfg(test)]
mod tests;
