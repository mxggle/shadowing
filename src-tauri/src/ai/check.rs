//! Checking a service works: list its models and, for explanations, actually
//! explain a sample sentence. Also spots local servers that are running.

use super::chat::{self, Prompt};
use super::providers::{self, Api, Feature, PRESETS};
use super::secrets::Secrets;
use super::Target;
use crate::{local, AppState};
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestReport {
    /// Usable models the service listed (0 if it has no list).
    models: usize,
    /// Whether the chosen model is among them (true when there is no list to check).
    model_found: bool,
    /// For explanations: the sample sentence and what the model said about it.
    sample: Option<String>,
    reply: Option<String>,
    millis: u64,
}

/// What the explanation check asks, in the learner's language.
fn sample_sentence(language: &str) -> &'static str {
    match language {
        "en" => "Shadowing means repeating what you hear, right after you hear it.",
        _ => "今日はいい天気ですね。散歩に行きましょう。",
    }
}

const SAMPLE_SYSTEM: &str =
    "你是耐心的语言老师。用简体中文解释用户给出的句子：先给出自然的中文翻译，\
     再用一两句话讲一个最值得注意的语法点或用法。总共不超过 100 字，不要用 Markdown 标题。";
const SAMPLE_SYSTEM_EN: &str = "You are a patient language teacher. Explain the user's sentence in English: \
     first a natural English translation, then one or two sentences on the grammar point or usage most worth noticing. \
     Under 80 words in all, no Markdown headings.";

/// Checks the chosen service for a feature: key, address, model, and (for
/// explanations) a real answer.
#[tauri::command]
pub async fn ai_test(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    feature: Feature,
) -> Result<TestReport, String> {
    let started = Instant::now();
    let choice = state.read(|d| d.ai.choice(feature).clone());
    let id = choice.provider.ok_or(crate::i18n::pick(
        "还没有选择服务",
        "Choose a service first.",
    ))?;
    if id == local::PROVIDER {
        let models = local::downloaded(&state);
        return Ok(TestReport {
            model_found: models.contains(&choice.model.as_str()),
            models: models.len(),
            sample: None,
            reply: None,
            millis: 0,
        });
    }
    let target = Target::resolve(&state, &secrets, &id)?
        .ready(&secrets)
        .await?;
    let listed = target.endpoint().list_models().await;
    if feature == Feature::Transcribe {
        let models = providers::filter_models(target.preset, feature, listed?);
        return Ok(TestReport {
            model_found: models.contains(&choice.model),
            models: models.len(),
            sample: None,
            reply: None,
            millis: started.elapsed().as_millis() as u64,
        });
    }

    // Explanations: some servers have no model list, so the real answer is what counts.
    let models = listed
        .map(|ids| providers::filter_models(target.preset, feature, ids))
        .unwrap_or_default();
    if choice.model.is_empty() {
        return Err(crate::i18n::pick("还没有选择模型", "Choose a model first.").into());
    }
    let sample = sample_sentence(&state.read(|d| d.settings.transcribe_language.clone()));
    let prompt = Prompt {
        system: crate::i18n::pick(SAMPLE_SYSTEM, SAMPLE_SYSTEM_EN),
        user: sample,
        max_tokens: 1024,
    };
    let reply = chat::complete(&target, &choice.model, &prompt).await?;
    Ok(TestReport {
        model_found: models.is_empty() || models.contains(&choice.model),
        models: models.len(),
        sample: Some(sample.to_string()),
        reply: Some(reply),
        millis: started.elapsed().as_millis() as u64,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Running {
    id: &'static str,
    models: usize,
}

/// Local servers (Ollama, LM Studio) that answer right now, with how many models they have.
#[tauri::command]
pub async fn ai_detect_local(state: State<'_, AppState>) -> Result<Vec<Running>, String> {
    let mut found = Vec::new();
    for preset in PRESETS.iter().filter(|p| p.local && p.api == Api::OpenAi) {
        let base = state.read(|d| d.ai.base_url(preset));
        let probe = super::http::client()
            .get(format!("{base}/models"))
            .timeout(Duration::from_millis(800))
            .send()
            .await;
        let Ok(res) = probe else { continue };
        let Ok(v) = res.json::<serde_json::Value>().await else {
            continue;
        };
        if let Some(list) = v["data"].as_array() {
            found.push(Running {
                id: preset.id,
                models: list.len(),
            });
        }
    }
    Ok(found)
}
