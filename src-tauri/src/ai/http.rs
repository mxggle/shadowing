//! Talking to providers: one shared client, auth headers per API style, and
//! failures turned into short Chinese messages a learner can act on.

use super::providers::Api;
use serde::Deserialize;
use std::sync::OnceLock;
use std::time::Duration;

pub const ANTHROPIC_VERSION: &str = "2023-06-01";

pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .build()
            .expect("HTTP client")
    })
}

/// Where a request goes and how it authenticates.
pub struct Endpoint<'a> {
    pub api: Api,
    pub base_url: &'a str,
    pub key: Option<&'a str>,
    /// For messages: "Groq", "Ollama"…
    pub name: &'a str,
    pub local: bool,
}

impl Endpoint<'_> {
    pub fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.authorize(client().get(format!("{}{path}", self.base_url)))
    }

    pub fn post(&self, path: &str) -> reqwest::RequestBuilder {
        self.authorize(client().post(format!("{}{path}", self.base_url)))
    }

    fn authorize(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match (self.api, self.key) {
            (Api::OpenAi, Some(key)) => req.bearer_auth(key),
            (Api::Anthropic, key) => req
                .header("x-api-key", key.unwrap_or_default())
                .header("anthropic-version", ANTHROPIC_VERSION),
            (Api::Responses, Some(key)) => req.bearer_auth(key),
            (Api::OpenAi | Api::Builtin | Api::Responses, None) | (Api::Builtin, Some(_)) => req,
        }
    }

    /// Sends and returns the body of a successful response, or a readable error.
    pub async fn send(&self, req: reqwest::RequestBuilder) -> Result<String, String> {
        let res = req.send().await.map_err(|e| self.transport_error(&e))?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(|e| self.transport_error(&e))?;
        if (200..300).contains(&status) {
            Ok(body)
        } else {
            Err(describe_status(status, &body, self.name))
        }
    }

    /// Like `send`, but waits and tries again on rate limits, server errors and
    /// dropped connections. `build` makes a fresh request for each attempt.
    pub async fn send_retrying(
        &self,
        build: impl Fn() -> reqwest::RequestBuilder,
        attempts: u32,
    ) -> Result<String, String> {
        let mut attempt = 1;
        loop {
            let last = attempt >= attempts;
            let wait = match build().send().await {
                Ok(res) => {
                    let status = res.status().as_u16();
                    let retry_after = res
                        .headers()
                        .get("retry-after")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse::<u64>().ok());
                    let body = res.text().await.map_err(|e| self.transport_error(&e))?;
                    if (200..300).contains(&status) {
                        return Ok(body);
                    }
                    if last || !(status == 429 || status >= 500) {
                        return Err(describe_status(status, &body, self.name));
                    }
                    retry_after.unwrap_or(2u64.pow(attempt)).min(60)
                }
                Err(e) if !last && !self.local && (e.is_timeout() || e.is_connect()) => {
                    2u64.pow(attempt)
                }
                Err(e) => return Err(self.transport_error(&e)),
            };
            tokio::time::sleep(Duration::from_secs(wait)).await;
            attempt += 1;
        }
    }

    fn transport_error(&self, e: &reqwest::Error) -> String {
        if e.is_timeout() {
            format!("{} 响应超时，请稍后再试", self.name)
        } else if e.is_connect() && self.local {
            format!("没有连接到 {}，请确认它已经启动", self.name)
        } else if e.is_connect() {
            format!("无法连接到 {}，请检查网络或地址", self.name)
        } else {
            format!("请求 {} 失败：{e}", self.name)
        }
    }

    /// Model ids from `GET /models`; both API styles return `{ data: [{ id }] }`.
    pub async fn list_models(&self) -> Result<Vec<String>, String> {
        #[derive(Deserialize)]
        struct List {
            data: Vec<Item>,
        }
        #[derive(Deserialize)]
        struct Item {
            id: String,
        }
        let path = match self.api {
            Api::Anthropic => "/models?limit=1000",
            Api::OpenAi | Api::Builtin | Api::Responses => "/models",
        };
        let body = self.send(self.get(path)).await?;
        if self.api == Api::Responses {
            return super::chatgpt::read_models(&body)
                .ok_or_else(|| format!("{} 返回的模型列表无法识别", self.name));
        }
        let list: List = serde_json::from_str(&body)
            .map_err(|_| format!("{} 返回的模型列表无法识别，请检查地址", self.name))?;
        Ok(list.data.into_iter().map(|m| m.id).collect())
    }
}

/// HTTP status → what to do about it, with the provider's own words when short enough.
pub fn describe_status(status: u16, body: &str, name: &str) -> String {
    let base = match status {
        401 | 403 => format!("{name} 拒绝了这个 API Key（{status}），请检查是否填错或已失效"),
        404 => format!("{name} 上找不到这个地址或模型（404），请检查地址和模型名"),
        402 | 429 => format!("{name} 额度不足或请求太频繁（{status}）"),
        500..=599 => format!("{name} 暂时不可用（{status}），请稍后再试"),
        _ => format!("{name} 返回错误（{status}）"),
    };
    match provider_message(body) {
        Some(msg) => format!("{base}：{msg}"),
        None => base,
    }
}

/// `{"error": {"message": "…"}}` (OpenAI, Anthropic, Groq…) or `{"error": "…"}` (Ollama).
fn provider_message(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let error = v.get("error")?;
    let msg = error
        .get("message")
        .and_then(|m| m.as_str())
        .or_else(|| error.as_str())?
        .trim();
    if msg.is_empty() {
        return None;
    }
    let short: String = msg.chars().take(160).collect();
    Some(if short.len() < msg.len() {
        format!("{short}…")
    } else {
        short
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn status_messages_include_the_provider_reason() {
        let body =
            r#"{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}"#;
        let msg = describe_status(401, body, "OpenAI");
        assert!(
            msg.contains("API Key") && msg.ends_with("Incorrect API key provided"),
            "{msg}"
        );
        assert!(
            describe_status(404, r#"{"error":"model not found"}"#, "Ollama")
                .ends_with("model not found")
        );
        assert!(!describe_status(503, "<html>", "Groq").contains('：'));
    }

    /// Serves one canned HTTP response and hands back the request it received.
    async fn one_shot(status: &str, body: &str) -> (String, tokio::task::JoinHandle<String>) {
        let response = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}",
            body.len()
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = vec![0; 4096];
            let n = sock.read(&mut buf).await.unwrap();
            sock.write_all(response.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (url, handle)
    }

    fn endpoint<'a>(api: Api, url: &'a str, key: Option<&'a str>) -> Endpoint<'a> {
        Endpoint {
            api,
            base_url: url,
            key,
            name: "Test",
            local: false,
        }
    }

    #[tokio::test]
    async fn lists_models_with_bearer_auth() {
        let (url, req) = one_shot("200 OK", r#"{"data":[{"id":"a"},{"id":"whisper-1"}]}"#).await;
        let models = endpoint(Api::OpenAi, &url, Some("sk-test"))
            .list_models()
            .await
            .unwrap();
        assert_eq!(models, ["a", "whisper-1"]);
        let req = req.await.unwrap().to_ascii_lowercase();
        assert!(
            req.starts_with("get /models ") && req.contains("authorization: bearer sk-test"),
            "{req}"
        );
    }

    #[tokio::test]
    async fn anthropic_uses_its_own_headers_and_errors_are_readable() {
        let (url, req) = one_shot(
            "401 Unauthorized",
            r#"{"error":{"message":"invalid x-api-key"}}"#,
        )
        .await;
        let err = endpoint(Api::Anthropic, &url, Some("k"))
            .list_models()
            .await
            .unwrap_err();
        assert!(
            err.contains("拒绝") && err.ends_with("invalid x-api-key"),
            "{err}"
        );
        let req = req.await.unwrap().to_ascii_lowercase();
        assert!(
            req.contains("x-api-key: k") && req.contains("anthropic-version: 2023-06-01"),
            "{req}"
        );
        assert!(!req.contains("authorization:"));
    }

    #[tokio::test]
    async fn rate_limits_are_retried_then_succeed() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            for reply in [
                "HTTP/1.1 429 Too Many Requests\r\nretry-after: 0\r\nconnection: close\r\ncontent-length: 0\r\n\r\n",
                "HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 2\r\n\r\nok",
            ] {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = vec![0; 4096];
                let _ = sock.read(&mut buf).await.unwrap();
                sock.write_all(reply.as_bytes()).await.unwrap();
            }
        });
        let ep = endpoint(Api::OpenAi, &url, None);
        assert_eq!(ep.send_retrying(|| ep.get("/x"), 3).await.unwrap(), "ok");
    }

    #[tokio::test]
    async fn a_closed_local_port_says_to_start_the_app() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let ep = Endpoint {
            local: true,
            name: "Ollama",
            ..endpoint(Api::OpenAi, &url, None)
        };
        assert_eq!(
            ep.list_models().await.unwrap_err(),
            "没有连接到 Ollama，请确认它已经启动"
        );
    }
}
