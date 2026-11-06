//! 意见反馈: what the learner writes in the feedback window (src/components/Feedback.tsx) or a
//! check-in card goes to the landing page's endpoint (site/api/feedback.mjs), which files it as an
//! issue in a private GitHub repository only the developer reads. Sent from Rust like every other
//! request; the webview passes the text, never a URL. Nothing leaves before the learner presses 发送,
//! and the diagnostics only when they leave that box ticked (the window shows each line first).

use crate::{ai, i18n, local, plugins, AppState};
use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Duration;
use tauri::{AppHandle, State};

const ENDPOINT: &str = "https://shadowing.nihongo.day/api/feedback";
/// Same limits as the endpoint, counted in characters.
const MAX_MESSAGE: usize = 4000;
const MAX_CONTACT: usize = 200;
/// The endpoint refuses longer diagnostic values (a long plugin list is cut instead).
const MAX_VALUE: usize = 200;

/// One diagnostic: the key sent, the label shown in the window, and the value.
#[derive(Serialize, Debug, PartialEq)]
pub struct Line {
    key: &'static str,
    label: &'static str,
    value: String,
}

#[derive(Serialize)]
struct App {
    version: String,
    os: &'static str,
    lang: &'static str,
}

#[derive(Serialize)]
struct Payload<'a> {
    kind: &'a str,
    message: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    contact: Option<&'a str>,
    app: App,
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostics: Option<BTreeMap<&'static str, String>>,
}

/// What "附上诊断信息" would attach, for the window to show before sending.
#[tauri::command(async)]
pub fn feedback_diagnostics(state: State<AppState>) -> Vec<Line> {
    lines(&state)
}

/// Sends one piece of feedback. `kind` tags where it came from ("feedback" for the window).
#[tauri::command]
pub async fn feedback_send(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
    message: String,
    contact: Option<String>,
    diagnostics: bool,
) -> Result<(), String> {
    let (message, contact) = clean(&kind, &message, contact.as_deref())?;
    let attached = diagnostics.then(|| {
        lines(&state)
            .into_iter()
            .map(|l| (l.key, l.value))
            .collect()
    });
    let payload = Payload {
        kind: &kind,
        message: &message,
        contact: contact.as_deref(),
        app: App {
            version: app.package_info().version.to_string(),
            os: std::env::consts::OS,
            lang: i18n::current(),
        },
        diagnostics: attached,
    };
    let res = ai::http::client()
        .post(endpoint())
        .timeout(Duration::from_secs(20))
        .json(&payload)
        .send()
        .await
        .map_err(|e| transport_error(&e))?;
    let status = res.status().as_u16();
    if (200..300).contains(&status) {
        Ok(())
    } else {
        Err(describe_status(status).into())
    }
}

/// Debug builds may send to a local server instead (testing the window end to end).
fn endpoint() -> String {
    std::env::var("SHADOWING_FEEDBACK_URL")
        .ok()
        .filter(|_| cfg!(debug_assertions))
        .unwrap_or_else(|| ENDPOINT.into())
}

/// The trimmed message and contact, or what to fix first.
fn clean(
    kind: &str,
    message: &str,
    contact: Option<&str>,
) -> Result<(String, Option<String>), String> {
    let kind_ok = (1..=32).contains(&kind.len())
        && kind
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if !kind_ok {
        return Err(format!("unknown feedback kind: {kind}"));
    }
    let message = message.trim();
    if message.is_empty() {
        return Err(i18n::pick("先写下想说的话", "Write something first.").into());
    }
    let count = message.chars().count();
    if count > MAX_MESSAGE {
        return Err(tr!(
            "最多 {MAX_MESSAGE} 个字，现在是 {count} 个",
            "At most {MAX_MESSAGE} characters; this is {count}."
        ));
    }
    let contact = contact.map(str::trim).filter(|c| !c.is_empty());
    if contact.is_some_and(|c| c.chars().count() > MAX_CONTACT) {
        return Err(i18n::pick("联系方式太长了", "The contact is too long.").into());
    }
    Ok((message.into(), contact.map(String::from)))
}

fn transport_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        i18n::pick(
            "发送超时，请稍后再试",
            "Sending took too long. Try again later.",
        )
        .into()
    } else {
        i18n::pick(
            "发送失败，请检查网络后再试",
            "Couldn't send. Check your network and try again.",
        )
        .into()
    }
}

fn describe_status(status: u16) -> &'static str {
    match status {
        429 => i18n::pick(
            "刚才发得太多了，请过几分钟再试",
            "Too many sent just now. Try again in a few minutes.",
        ),
        400 | 413 => i18n::pick(
            "这条反馈发不出去，请缩短一点再试",
            "This feedback couldn't be sent. Try making it shorter.",
        ),
        _ => i18n::pick(
            "反馈暂时收不到，请稍后再试",
            "Feedback can't be received right now. Try again later.",
        ),
    }
}

/// The diagnostics: system, chip and memory, the AI services picked (names and models, never
/// addresses or keys), plugins, and the language being learned.
fn lines(state: &AppState) -> Vec<Line> {
    let (ai, language) = state.read(|d| (d.ai.clone(), d.guide.language.clone()));
    let plugins: Vec<(String, String)> = plugins::installed(state)
        .into_iter()
        .map(|p| (p.manifest.id, p.manifest.version))
        .collect();
    let line = |key, label, value: String| Line {
        key,
        label,
        value: cut(&value, MAX_VALUE),
    };
    let mut out = vec![line("os", i18n::pick("系统", "System"), system())];
    if cfg!(target_os = "macos") {
        out.push(line(
            "chip",
            i18n::pick("芯片", "Chip"),
            local::system::chip(),
        ));
    }
    out.extend([
        line(
            "memory",
            i18n::pick("内存", "Memory"),
            format!("{:.0} GB", local::system::ram_gb()),
        ),
        line(
            "transcribe",
            i18n::pick("转写", "Transcription"),
            choice(&ai.transcribe),
        ),
        line(
            "chat",
            i18n::pick("句子解释", "Explanations"),
            choice(&ai.chat),
        ),
        line(
            "plugins",
            i18n::pick("插件", "Plugins"),
            plugin_list(&plugins),
        ),
        line(
            "studyLanguage",
            i18n::pick("学习的语言", "Learning"),
            if language.is_empty() {
                i18n::pick("没选", "Not chosen").into()
            } else {
                language
            },
        ),
    ]);
    out
}

/// "macOS 15.1 (aarch64)", "Windows (x86_64)".
fn system() -> String {
    let name = match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        other => other,
    };
    match local::system::os_version() {
        Some(v) => format!("{name} {v} ({})", std::env::consts::ARCH),
        None => format!("{name} ({})", std::env::consts::ARCH),
    }
}

/// "groq · whisper-large-v3"; the service alone when no model is saved.
fn choice(c: &ai::Choice) -> String {
    match c.provider.as_deref() {
        None | Some("") => i18n::pick("没设置", "Not set").into(),
        Some(p) if c.model.is_empty() => p.into(),
        Some(p) => format!("{p} · {}", c.model),
    }
}

/// At most `max` characters, the last one "…" when cut.
fn cut(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.into();
    }
    let mut out: String = text.chars().take(max - 1).collect();
    out.push('…');
    out
}

fn plugin_list(plugins: &[(String, String)]) -> String {
    if plugins.is_empty() {
        return i18n::pick("没有", "None").into();
    }
    plugins
        .iter()
        .map(|(id, version)| format!("{id} {version}"))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_and_checks_what_is_sent() {
        assert_eq!(
            clean("feedback", "  录音没声音 \n", Some("  ")),
            Ok(("录音没声音".into(), None))
        );
        assert_eq!(
            clean("card-3days", "好用", Some(" me@example.com ")),
            Ok(("好用".into(), Some("me@example.com".into())))
        );
        assert!(clean("feedback", " \n ", None).is_err());
        assert!(clean("Feedback", "x", None).is_err());
        assert!(clean("", "x", None).is_err());
        assert!(clean(&"a".repeat(33), "x", None).is_err());
        // Characters, not bytes: 4000 kanji are fine, one more is not.
        assert!(clean("feedback", &"字".repeat(MAX_MESSAGE), None).is_ok());
        assert!(clean("feedback", &"字".repeat(MAX_MESSAGE + 1), None).is_err());
        assert!(clean("feedback", "x", Some(&"字".repeat(MAX_CONTACT + 1))).is_err());
    }

    #[test]
    fn payload_leaves_out_what_was_not_given() {
        let payload = Payload {
            kind: "feedback",
            message: "hi",
            contact: None,
            app: App {
                version: "0.18.0".into(),
                os: "macos",
                lang: "zh",
            },
            diagnostics: None,
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "feedback", "message": "hi", "app": { "version": "0.18.0", "os": "macos", "lang": "zh" } })
        );
        let with = Payload {
            contact: Some("me"),
            diagnostics: Some(BTreeMap::from([("chip", "Apple M2".to_string())])),
            ..payload
        };
        let json = serde_json::to_value(&with).unwrap();
        assert_eq!(json["contact"], "me");
        assert_eq!(json["diagnostics"]["chip"], "Apple M2");
    }

    #[test]
    fn names_services_and_plugins() {
        let set = |provider: Option<&str>, model: &str| ai::Choice {
            provider: provider.map(String::from),
            model: model.into(),
        };
        assert_eq!(
            choice(&set(Some("groq"), "whisper-large-v3")),
            "groq · whisper-large-v3"
        );
        assert_eq!(choice(&set(Some("local"), "")), "local");
        assert!(!choice(&set(None, "x")).contains('x'));
        let plugins = [
            ("youtube".to_string(), "1.2.0".to_string()),
            ("furigana".into(), "0.3.0".into()),
        ];
        assert_eq!(plugin_list(&plugins), "youtube 1.2.0, furigana 0.3.0");
        assert!(!plugin_list(&[]).is_empty());
    }

    #[test]
    fn long_values_are_cut_to_what_the_endpoint_takes() {
        assert_eq!(cut("youtube 1.2.0", MAX_VALUE), "youtube 1.2.0");
        let long = cut(&"字".repeat(MAX_VALUE + 50), MAX_VALUE);
        assert_eq!(long.chars().count(), MAX_VALUE);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn every_failure_reads_as_a_sentence() {
        for status in [400, 404, 413, 429, 500, 502, 503] {
            assert!(!describe_status(status).is_empty());
        }
        assert_ne!(describe_status(429), describe_status(503));
    }
}
