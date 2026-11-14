//! AnkiConnect (the Anki add-on 2055492159): a small HTTP API on this computer while Anki is
//! open. Only ever 127.0.0.1, never through a proxy.

use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;

const URL: &str = "http://127.0.0.1:8765";
const VERSION: u32 = 6;

pub enum Failure {
    /// Anki isn't open, or AnkiConnect isn't installed.
    Unreachable,
    /// Anki answered with an error (its own words, in English).
    Anki(String),
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(2))
            // Anki can be slow to answer while it syncs or a dialog is open.
            .timeout(Duration::from_secs(20))
            .build()
            .expect("HTTP client")
    })
}

pub async fn call(action: &str, params: Value) -> Result<Value, Failure> {
    let body = json!({ "action": action, "version": VERSION, "params": params });
    let res = client()
        .post(URL)
        .json(&body)
        .send()
        .await
        .map_err(|_| Failure::Unreachable)?;
    let reply: Value = res.json().await.map_err(|_| Failure::Unreachable)?;
    answer(reply)
}

/// `{ "result": …, "error": null | "…" }`.
fn answer(reply: Value) -> Result<Value, Failure> {
    match reply.get("error") {
        Some(Value::String(e)) => Err(Failure::Anki(e.clone())),
        Some(Value::Null) | None => Ok(reply.get("result").cloned().unwrap_or(Value::Null)),
        Some(other) => Err(Failure::Anki(other.to_string())),
    }
}

/// Standard base64 with padding, as AnkiConnect's `storeMediaFile` decodes it.
pub fn base64(bytes: &[u8]) -> String {
    let mut s = crate::ai::oauth::base64url(bytes)
        .replace('-', "+")
        .replace('_', "/");
    while !s.len().is_multiple_of(4) {
        s.push('=');
    }
    s
}

pub fn is_duplicate(error: &str) -> bool {
    error.contains("duplicate")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_is_standard_and_padded() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(&[0xfb, 0xff]), "+/8=");
    }

    #[test]
    fn reads_results_and_errors() {
        assert!(matches!(answer(json!({ "result": 6, "error": null })), Ok(v) if v == 6));
        assert!(matches!(
            answer(json!({ "result": null, "error": "cannot create note because it is a duplicate" })),
            Err(Failure::Anki(e)) if is_duplicate(&e)
        ));
    }
}
