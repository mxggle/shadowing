//! The browser part of Sign in with ChatGPT: register (first time) or
//! reauthorize, exchange the code, check the ID token, keep the tokens.

use super::super::oauth::{self, Loopback};
use super::super::secrets::Secrets;
use super::super::AiConfig;
use super::{
    check_id_token, now, store, token_request, Credentials, AUTHORIZE, PLAN_SCOPE, PROVIDER,
    RESOURCE, SCOPE, TOKEN,
};
use crate::AppState;
use tauri::State;

/// A stable, opaque id for this Mac's install (`urn:uuid:` + random UUIDv4).
fn host_id(state: &AppState) -> Result<String, String> {
    if let Some(id) = state.read(|d| d.ai.chatgpt_host_id.clone()) {
        return Ok(id);
    }
    let mut b = [0u8; 16];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut b))
        .map_err(|e| e.to_string())?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    let id = format!(
        "urn:uuid:{}-{}-{}-{}-{}",
        &h[..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..]
    );
    state.update(|d| d.ai.chatgpt_host_id = Some(id.clone()))?;
    Ok(id)
}

#[tauri::command]
pub async fn ai_sign_in_chatgpt(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
) -> Result<AiConfig, String> {
    let known_client = state.read(|d| d.ai.chatgpt_client_id.clone());
    let (verifier, challenge) = oauth::pkce()?;
    let (csrf, nonce) = (oauth::random(16)?, oauth::random(16)?);
    let host = host_id(&state)?;
    let loopback = Loopback::bind()?;
    let redirect = format!("http://127.0.0.1:{}/auth/callback", loopback.port);
    let mut params = vec![
        (
            "client_id",
            known_client
                .clone()
                .unwrap_or_else(|| "dynamic_agent_client".into()),
        ),
        ("ext_agent_host_id", host),
        ("response_type", "code".into()),
        ("redirect_uri", redirect.clone()),
        ("scope", SCOPE.into()),
        ("resource", RESOURCE.into()),
        ("state", csrf.clone()),
        ("nonce", nonce.clone()),
        ("code_challenge_method", "S256".into()),
        ("code_challenge", challenge),
    ];
    if known_client.is_none() {
        params.push(("agent_name_hint", "Shadowing".into()));
    }
    let url = tauri::Url::parse_with_params(AUTHORIZE, &params).map_err(|e| e.to_string())?;
    oauth::open_browser(url.as_str())?;

    let expected = csrf.clone();
    let query = tauri::async_runtime::spawn_blocking(move || {
        loopback.wait("/auth/callback", &expected, "ChatGPT")
    })
    .await
    .map_err(|e| e.to_string())??;
    if query.get("state") != Some(&csrf) {
        return Err(crate::i18n::pick(
            "登录回调不匹配，请重试",
            "The sign-in callback didn't match. Try again.",
        )
        .into());
    }
    if let Some(error) = query.get("error") {
        return Err(if error == "access_denied" {
            crate::i18n::pick("已取消授权", "Cancelled").into()
        } else {
            tr!(
                "ChatGPT 登录失败：{error}",
                "Couldn't sign in with ChatGPT: {error}"
            )
        });
    }
    let code = query.get("code").ok_or(crate::i18n::pick(
        "没有完成 ChatGPT 授权",
        "ChatGPT authorization wasn't completed.",
    ))?;
    let client_id = match (query.get("client_id"), &known_client) {
        (Some(issued), Some(known)) if issued != known => {
            return Err(crate::i18n::pick(
                "登录返回的应用编号不一致，请重试",
                "The sign-in returned a different app ID. Try again.",
            )
            .into())
        }
        (Some(issued), _) => issued.clone(),
        (None, Some(known)) => known.clone(),
        (None, None) => {
            return Err(crate::i18n::pick(
                "ChatGPT 没有完成应用注册，请重试",
                "ChatGPT didn't finish registering the app. Try again.",
            )
            .into())
        }
    };

    let tokens = token_request(
        &[
            ("grant_type", "authorization_code"),
            ("client_id", &client_id),
            ("code", code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect),
            ("resource", RESOURCE),
        ],
        TOKEN,
    )
    .await?;
    if !tokens.scope.split_whitespace().any(|s| s == PLAN_SCOPE) {
        return Err(crate::i18n::pick(
            "这个账号没有授权使用 ChatGPT 额度（需要 Plus 或 Pro 套餐）",
            "This account didn't allow using its ChatGPT plan (a Plus or Pro plan is needed).",
        )
        .into());
    }
    let id_token = tokens.id_token.ok_or(crate::i18n::pick(
        "ChatGPT 没有返回登录信息",
        "ChatGPT didn't return the sign-in details.",
    ))?;
    let email = check_id_token(&id_token, &client_id, &nonce, now())?;
    let creds = Credentials {
        client_id: client_id.clone(),
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token.ok_or(crate::i18n::pick(
            "ChatGPT 没有返回长期登录凭据",
            "ChatGPT didn't return a lasting sign-in token.",
        ))?,
        id_token,
        expires_at: now() + tokens.expires_in,
        email: email.clone(),
    };
    store(&secrets, &creds)?;
    state.update(|d| {
        d.ai.chatgpt_client_id = Some(client_id);
        d.ai.key_hints.insert(PROVIDER.into(), email);
    })?;
    Ok(state.read(|d| d.ai.clone()))
}
