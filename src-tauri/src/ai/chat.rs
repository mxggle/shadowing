//! One-shot chat completion over the two wire formats: OpenAI-compatible
//! `/chat/completions` (OpenAI, Gemini, DeepSeek, OpenRouter, Ollama, LM Studio,
//! custom) and Anthropic's own `/messages`.

use super::providers::Api;
use super::Target;
use serde_json::{json, Value};
use std::time::Duration;

/// A local model may need to load into memory first; give it time.
const TIMEOUT: Duration = Duration::from_secs(120);

pub struct Prompt<'a> {
    pub system: &'a str,
    pub user: &'a str,
    pub max_tokens: u32,
}

pub async fn complete(target: &Target, model: &str, prompt: &Prompt<'_>) -> Result<String, String> {
    let ep = target.endpoint();
    let name = target.preset.name;
    match target.preset.api {
        Api::OpenAi => {
            // OpenAI's own reasoning models reject `max_tokens`; everyone else expects it.
            let limit = if target.preset.id == "openai" {
                "max_completion_tokens"
            } else {
                "max_tokens"
            };
            let mut body = json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": prompt.system },
                    { "role": "user", "content": prompt.user },
                ],
            });
            body[limit] = json!(prompt.max_tokens);
            let text = ep
                .send(ep.post("/chat/completions").json(&body).timeout(TIMEOUT))
                .await?;
            openai_text(&text).ok_or_else(|| unreadable(name))
        }
        Api::Anthropic => {
            let body = json!({
                "model": model,
                "max_tokens": prompt.max_tokens,
                "system": prompt.system,
                "messages": [{ "role": "user", "content": prompt.user }],
            });
            let text = ep
                .send(ep.post("/messages").json(&body).timeout(TIMEOUT))
                .await?;
            anthropic_text(&text).ok_or_else(|| unreadable(name))
        }
        Api::Responses => {
            // This route requires streaming and no server-side storage; length limits aren't accepted.
            let body = json!({
                "model": model,
                "instructions": prompt.system,
                "input": [{ "role": "user", "content": prompt.user }],
                "store": false,
                "stream": true,
            });
            let text = ep
                .send(ep.post("/responses").json(&body).timeout(TIMEOUT))
                .await?;
            super::chatgpt::read_stream(&text)
        }
        Api::Builtin => Err("这个服务不能用于解释".into()),
    }
}

/// The JSON object in a reply, even when wrapped in ``` fences or a sentence of prose.
pub fn json_object(reply: &str) -> Option<&str> {
    let (a, b) = (reply.find('{')?, reply.rfind('}')?);
    (a < b).then(|| &reply[a..=b])
}

fn unreadable(name: &str) -> String {
    format!("{name} 的回复无法识别，或者回答为空（可能被截断）")
}

fn openai_text(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    let content = v["choices"][0]["message"]["content"].as_str()?;
    non_empty(strip_thinking(content))
}

fn anthropic_text(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    let text: String = v["content"]
        .as_array()?
        .iter()
        .filter(|b| b["type"] == "text")
        .filter_map(|b| b["text"].as_str())
        .collect();
    non_empty(text)
}

fn non_empty(s: String) -> Option<String> {
    let s = s.trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// Some local reasoning models put their thinking inline as `<think>…</think>`.
fn strip_thinking(s: &str) -> String {
    match (s.find("<think>"), s.find("</think>")) {
        (Some(a), Some(b)) if a < b => format!("{}{}", &s[..a], &s[b + "</think>".len()..]),
        (None, Some(b)) => s[b + "</think>".len()..].to_string(),
        _ => s.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_openai_style_replies_without_thinking() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"<think>hmm</think>\n天气真好呢。"}}]}"#;
        assert_eq!(openai_text(body).unwrap(), "天气真好呢。");
        assert!(openai_text(r#"{"choices":[{"message":{"content":""}}]}"#).is_none());
        assert!(openai_text("not json").is_none());
    }

    /// Answers one request with `reply` and hands back the raw request.
    async fn serve_once(reply: &'static str) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut req = Vec::new();
            let mut buf = vec![0; 8192];
            // Read until the JSON body (which ends in '}') has arrived.
            while !req.ends_with(b"}") {
                let n = sock.read(&mut buf).await.unwrap();
                req.extend_from_slice(&buf[..n]);
            }
            let res = format!("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{reply}", reply.len());
            sock.write_all(res.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&req).into_owned()
        });
        (url, handle)
    }

    fn target(id: &str, url: &str) -> Target {
        Target {
            preset: super::super::providers::find(id).unwrap(),
            base_url: url.into(),
            key: Some("k".into()),
        }
    }

    const PROMPT: Prompt = Prompt {
        system: "sys",
        user: "今日は",
        max_tokens: 64,
    };

    #[tokio::test]
    async fn openai_gets_max_completion_tokens_others_max_tokens() {
        for (id, field) in [
            ("openai", "\"max_completion_tokens\":64"),
            ("deepseek", "\"max_tokens\":64"),
        ] {
            let (url, req) = serve_once(r#"{"choices":[{"message":{"content":"好"}}]}"#).await;
            assert_eq!(
                complete(&target(id, &url), "m", &PROMPT).await.unwrap(),
                "好"
            );
            let req = req.await.unwrap();
            assert!(req.starts_with("POST /chat/completions "), "{id}");
            assert!(
                req.contains(field) && req.contains("\"role\":\"system\""),
                "{id}: {req}"
            );
        }
    }

    #[tokio::test]
    async fn anthropic_sends_system_separately() {
        let (url, req) = serve_once(r#"{"content":[{"type":"text","text":"好"}]}"#).await;
        assert_eq!(
            complete(&target("anthropic", &url), "claude", &PROMPT)
                .await
                .unwrap(),
            "好"
        );
        let req = req.await.unwrap();
        assert!(
            req.starts_with("POST /messages ") && req.contains("\"system\":\"sys\""),
            "{req}"
        );
        assert!(
            req.contains("\"max_tokens\":64") && req.contains("x-api-key: k"),
            "{req}"
        );
    }

    #[test]
    fn reads_anthropic_text_blocks() {
        let body = r#"{"content":[{"type":"thinking","thinking":"x"},{"type":"text","text":"今天天气"},{"type":"text","text":"很好。"}]}"#;
        assert_eq!(anthropic_text(body).unwrap(), "今天天气很好。");
    }
}
