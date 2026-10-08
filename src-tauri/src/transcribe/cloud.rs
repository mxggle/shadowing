//! One piece of audio → OpenAI-compatible `/audio/transcriptions` (Groq,
//! OpenAI whisper-1, self-hosted servers) with word and segment timestamps.

use super::sentences::Verbose;
use crate::ai::http::Endpoint;
use reqwest::multipart::{Form, Part};
use std::time::Duration;

/// Uploading 19 MB and transcribing 10 minutes can take a while on a slow line.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const ATTEMPTS: u32 = 3;

pub struct Request<'a> {
    pub model: &'a str,
    /// ISO-639-1 ("ja", "en"); None lets the model guess.
    pub language: Option<&'a str>,
    /// The end of the previous piece, so the model keeps context and spelling.
    pub prompt: &'a str,
}

pub async fn transcribe(
    endpoint: &Endpoint<'_>,
    req: &Request<'_>,
    wav: &[u8],
) -> Result<Verbose, String> {
    let build = || {
        let file = Part::bytes(wav.to_vec())
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .expect("static mime type");
        let mut form = Form::new()
            .part("file", file)
            .text("model", req.model.to_string())
            .text("response_format", "verbose_json")
            .text("timestamp_granularities[]", "word")
            .text("timestamp_granularities[]", "segment")
            .text("temperature", "0");
        if let Some(lang) = req.language {
            form = form.text("language", lang.to_string());
        }
        if !req.prompt.is_empty() {
            form = form.text("prompt", req.prompt.to_string());
        }
        endpoint
            .post("/audio/transcriptions")
            .multipart(form)
            .timeout(REQUEST_TIMEOUT)
    };
    let body = endpoint.send_retrying(build, ATTEMPTS).await?;
    serde_json::from_str(&body).map_err(|_| {
        format!(
            "{} 没有返回带时间的结果，请确认模型支持 verbose_json（比如 whisper 系列）",
            endpoint.name
        )
    })
}

/// The last ~100 characters of text, cut at a word boundary where there is one.
pub fn tail_prompt(text: &str) -> String {
    let chars: Vec<char> = text.trim().chars().collect();
    let from = chars.len().saturating_sub(100);
    let tail: String = chars[from..].iter().collect();
    match tail.find(' ') {
        Some(i) if from > 0 && i < 30 => tail[i + 1..].to_string(),
        _ => tail,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_is_the_tail_of_the_text() {
        assert_eq!(tail_prompt(" short "), "short");
        let long = "word ".repeat(40);
        let p = tail_prompt(&long);
        assert!(p.len() <= 100 && p.starts_with("word"), "{p}");
        let ja = "あ".repeat(150);
        assert_eq!(tail_prompt(&ja).chars().count(), 100);
    }
}
