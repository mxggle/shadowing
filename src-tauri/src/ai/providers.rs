//! The services the app knows how to talk to. Every one speaks either the
//! OpenAI-compatible API or Anthropic's own; the rest is a label and a URL.

use crate::library::natural_cmp;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Feature {
    /// Audio → timed sentences.
    Transcribe,
    /// Sentence explanation and word lookup.
    Chat,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Api {
    OpenAi,
    Anthropic,
    /// Runs inside the app (whisper.cpp), no HTTP at all.
    Builtin,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyPolicy {
    Required,
    /// Custom servers may or may not want one.
    Optional,
    None,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub api: Api,
    /// Empty for custom servers: the user types it.
    pub base_url: &'static str,
    /// Runs on this Mac; nothing leaves the device.
    pub local: bool,
    pub key: KeyPolicy,
    /// Where to create an API key.
    pub key_url: Option<&'static str>,
    pub features: &'static [Feature],
    pub transcribe_model: Option<&'static str>,
    /// USD per hour of audio, per transcription model, for the estimate shown before starting.
    pub transcribe_prices: &'static [(&'static str, f64)],
    pub chat_model: Option<&'static str>,
    /// One line under the choice, in the UI language.
    pub note: &'static str,
}

impl Preset {
    pub fn default_model(&self, feature: Feature) -> Option<&'static str> {
        match feature {
            Feature::Transcribe => self.transcribe_model,
            Feature::Chat => self.chat_model,
        }
    }

    pub fn supports(&self, feature: Feature) -> bool {
        self.features.contains(&feature)
    }
}

const CLOUD: Preset = Preset {
    id: "",
    name: "",
    api: Api::OpenAi,
    base_url: "",
    local: false,
    key: KeyPolicy::Required,
    key_url: None,
    features: &[Feature::Chat],
    transcribe_model: None,
    transcribe_prices: &[],
    chat_model: None,
    note: "",
};

pub const PRESETS: &[Preset] = &[
    Preset {
        id: crate::local::PROVIDER,
        name: "本机",
        api: Api::Builtin,
        local: true,
        key: KeyPolicy::None,
        features: &[Feature::Transcribe],
        note: "在这台 Mac 上用 Whisper 转写：免费、可离线，需要先下载一个模型",
        ..CLOUD
    },
    Preset {
        id: "groq",
        name: "Groq",
        base_url: "https://api.groq.com/openai/v1",
        key_url: Some("https://console.groq.com/keys"),
        features: &[Feature::Transcribe],
        transcribe_model: Some("whisper-large-v3"),
        transcribe_prices: &[
            ("whisper-large-v3", 0.111),
            ("whisper-large-v3-turbo", 0.04),
        ],
        note: "Whisper large-v3，约 $0.11 / 小时音频，速度很快",
        ..CLOUD
    },
    Preset {
        id: "openai",
        name: "OpenAI",
        base_url: "https://api.openai.com/v1",
        key_url: Some("https://platform.openai.com/api-keys"),
        features: &[Feature::Transcribe, Feature::Chat],
        transcribe_model: Some("whisper-1"),
        transcribe_prices: &[("whisper-1", 0.36)],
        chat_model: Some("gpt-5-mini"),
        note: "转写用 whisper-1（约 $0.36 / 小时）；解释可选 GPT 系列",
        ..CLOUD
    },
    Preset {
        id: "anthropic",
        name: "Anthropic",
        api: Api::Anthropic,
        base_url: "https://api.anthropic.com/v1",
        key_url: Some("https://console.anthropic.com/settings/keys"),
        chat_model: Some("claude-haiku-5-5"),
        note: "Claude 系列",
        ..CLOUD
    },
    Preset {
        id: "gemini",
        name: "Google Gemini",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        key_url: Some("https://aistudio.google.com/apikey"),
        note: "Gemini 系列；免费额度的数据可能被 Google 用于改进模型",
        ..CLOUD
    },
    Preset {
        id: "deepseek",
        name: "DeepSeek",
        base_url: "https://api.deepseek.com",
        key_url: Some("https://platform.deepseek.com/api_keys"),
        note: "价格低，中文好",
        ..CLOUD
    },
    Preset {
        id: "openrouter",
        name: "OpenRouter",
        base_url: "https://openrouter.ai/api/v1",
        key_url: Some("https://openrouter.ai/keys"),
        note: "一个 Key 使用多家的模型",
        ..CLOUD
    },
    Preset {
        id: "ollama",
        name: "Ollama",
        base_url: "http://localhost:11434/v1",
        local: true,
        key: KeyPolicy::None,
        note: "本机运行，需要先安装并启动 Ollama",
        ..CLOUD
    },
    Preset {
        id: "lmstudio",
        name: "LM Studio",
        base_url: "http://localhost:1234/v1",
        local: true,
        key: KeyPolicy::None,
        note: "本机运行，需要在 LM Studio 里启动本地服务",
        ..CLOUD
    },
    Preset {
        id: "custom-transcribe",
        name: "自定义",
        key: KeyPolicy::Optional,
        features: &[Feature::Transcribe],
        note: "任何 OpenAI 兼容的转写服务（需要支持 verbose_json 时间戳）",
        ..CLOUD
    },
    Preset {
        id: "custom-chat",
        name: "自定义",
        key: KeyPolicy::Optional,
        note: "任何 OpenAI 兼容的服务",
        ..CLOUD
    },
];

pub fn find(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|p| p.id == id)
}

const NOT_CHAT: &[&str] = &[
    "whisper",
    "tts",
    "embed",
    "dall-e",
    "image",
    "audio",
    "realtime",
    "moderation",
    "transcribe",
    "search",
    "computer-use",
    "sora",
    "guard",
    "davinci",
    "babbage",
];

/// Model ids worth offering for a feature, tidied and sorted. Custom servers
/// may name models anything, so their transcription list is left alone.
pub fn filter_models(preset: &Preset, feature: Feature, ids: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = ids
        .into_iter()
        .map(|id| id.strip_prefix("models/").map(str::to_string).unwrap_or(id))
        .filter(|id| {
            let lower = id.to_ascii_lowercase();
            match feature {
                Feature::Transcribe => preset.base_url.is_empty() || lower.contains("whisper"),
                Feature::Chat => !NOT_CHAT.iter().any(|n| lower.contains(n)),
            }
        })
        .collect();
    out.sort_by(|a, b| natural_cmp(a, b));
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn presets_are_consistent() {
        for p in PRESETS {
            assert!(!p.features.is_empty(), "{}", p.id);
            for f in p.features {
                // Custom servers have no default model; everything else names one or lists them.
                if p.base_url.is_empty() {
                    assert!(p.default_model(*f).is_none());
                }
            }
            assert_eq!(p.local, p.key == KeyPolicy::None, "{}", p.id);
            assert!(
                p.base_url.is_empty() || !p.base_url.ends_with('/'),
                "{}",
                p.id
            );
        }
        let unique: std::collections::HashSet<_> = PRESETS.iter().map(|p| p.id).collect();
        assert_eq!(unique.len(), PRESETS.len());
    }

    #[test]
    fn transcription_lists_keep_whisper_models() {
        let groq = find("groq").unwrap();
        let got = filter_models(
            groq,
            Feature::Transcribe,
            ids(&[
                "llama-3.3-70b",
                "whisper-large-v3-turbo",
                "whisper-large-v3",
            ]),
        );
        assert_eq!(got, ["whisper-large-v3", "whisper-large-v3-turbo"]);
        let custom = find("custom-transcribe").unwrap();
        assert_eq!(
            filter_models(custom, Feature::Transcribe, ids(&["parakeet"])),
            ["parakeet"]
        );
    }

    #[test]
    fn chat_lists_drop_audio_image_and_embedding_models() {
        let openai = find("openai").unwrap();
        let got = filter_models(
            openai,
            Feature::Chat,
            ids(&[
                "gpt-5-mini",
                "whisper-1",
                "text-embedding-3-small",
                "gpt-4o-mini-transcribe",
                "dall-e-3",
                "gpt-5",
                "tts-1",
            ]),
        );
        assert_eq!(got, ["gpt-5", "gpt-5-mini"]);
    }

    #[test]
    fn gemini_ids_lose_their_prefix() {
        let gemini = find("gemini").unwrap();
        let got = filter_models(
            gemini,
            Feature::Chat,
            ids(&["models/gemini-3-flash", "models/gemini-3-flash"]),
        );
        assert_eq!(got, ["gemini-3-flash"]);
    }
}
