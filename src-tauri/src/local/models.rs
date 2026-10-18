//! The Whisper models the app offers, pinned to one Hugging Face commit with
//! their SHA-256, and how well each suits this Mac (memory, chip and disk: `system.rs`).

use crate::ai::providers::Text;
use serde::Serialize;

/// ggerganov/whisper.cpp at a fixed commit, so files never change under us.
const REPO: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: &'static str,
    pub name: Text,
    #[serde(skip)]
    pub file: &'static str,
    /// Bytes on disk.
    pub size: u64,
    #[serde(skip)]
    pub sha256: &'static str,
    /// Rough memory while transcribing, in GB.
    pub memory_gb: f64,
    pub note: Text,
}

impl Model {
    pub fn url(&self) -> String {
        format!("{REPO}/{}", self.file)
    }
}

pub const MODELS: &[Model] = &[
    Model {
        id: "large-v3-turbo-q5_0",
        name: Text::new("Large v3 Turbo（压缩）", "Large v3 Turbo (compressed)"),
        file: "ggml-large-v3-turbo-q5_0.bin",
        size: 574_041_195,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        memory_gb: 1.0,
        note: Text::new(
            "速度和准确度平衡，日语、英语都不错",
            "Balances speed and accuracy, good for both Japanese and English",
        ),
    },
    Model {
        id: "large-v3-turbo-q8_0",
        name: Text::same("Large v3 Turbo"),
        file: "ggml-large-v3-turbo-q8_0.bin",
        size: 874_188_075,
        sha256: "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1",
        memory_gb: 1.3,
        note: Text::new(
            "比压缩版略准一点，速度差不多",
            "A little more accurate than the compressed one, about as fast",
        ),
    },
    Model {
        id: "large-v3",
        name: Text::same("Large v3"),
        file: "ggml-large-v3.bin",
        size: 3_095_033_483,
        sha256: "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
        memory_gb: 3.9,
        note: Text::new(
            "最准（尤其日语），但慢很多",
            "The most accurate (especially for Japanese), but much slower",
        ),
    },
    Model {
        id: "small-q5_1",
        name: Text::same("Small"),
        file: "ggml-small-q5_1.bin",
        size: 190_085_487,
        sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
        memory_gb: 0.6,
        note: Text::new(
            "很快、很小，但日语错误较多，适合先试试",
            "Very fast and small, but makes more mistakes in Japanese; good for a first try",
        ),
    },
];

pub fn find(id: &str) -> Option<&'static Model> {
    MODELS.iter().find(|m| m.id == id)
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Fit {
    Good,
    /// Runs, but squeezes memory alongside other apps.
    Tight,
    TooBig,
}

pub fn fit(model: &Model, ram_gb: f64) -> Fit {
    if model.memory_gb <= ram_gb * 0.25 {
        Fit::Good
    } else if model.memory_gb <= ram_gb * 0.45 {
        Fit::Tight
    } else {
        Fit::TooBig
    }
}

/// Room left on the disk after a download, so it isn't filled to the brim.
pub const DISK_MARGIN: u64 = 500 * 1024 * 1024;

/// Strongest first: where the recommendation steps down to when disk space is short.
const BY_STRENGTH: [&str; 4] = [
    "large-v3",
    "large-v3-turbo-q8_0",
    "large-v3-turbo-q5_0",
    "small-q5_1",
];

/// The one model to suggest first, and why, for this chip, memory and free disk.
/// Turbo is accurate enough for Japanese and quick; only Max / Ultra chips with
/// plenty of memory get the full Large v3, and a nearly full disk steps down.
pub fn recommend(ram_gb: f64, chip: &str, free: Option<u64>) -> (&'static str, String) {
    let ram = ram_gb.round();
    let big_chip = chip.contains("Max") || chip.contains("Ultra");
    let (wanted, why) = if big_chip && ram_gb >= 32.0 {
        (
            "large-v3",
            tr!(
                "{chip} + {ram} GB 内存，跑得动最准的模型",
                "{chip} with {ram} GB of memory runs the most accurate model well"
            ),
        )
    } else if ram_gb >= 12.0 {
        (
            "large-v3-turbo-q8_0",
            tr!(
                "{ram} GB 内存，选比压缩版略准的 Turbo",
                "{ram} GB of memory: Turbo, a little more accurate than the compressed one"
            ),
        )
    } else {
        (
            "large-v3-turbo-q5_0",
            tr!(
                "{ram} GB 内存，选又快又省内存的压缩版",
                "{ram} GB of memory: the compressed Turbo, fast and light on memory"
            ),
        )
    };
    let Some(free) = free else {
        return (wanted, why);
    };
    let fits = |id: &&&str| find(id).is_some_and(|m| m.size + DISK_MARGIN <= free);
    let start = BY_STRENGTH.iter().position(|id| *id == wanted).unwrap_or(0);
    let space = gb(free);
    match BY_STRENGTH[start..].iter().find(fits) {
        Some(&id) if id == wanted => (id, why),
        Some(&id) => (
            id,
            tr!(
                "可用空间只有 {space}，选了小一点的模型",
                "Only {space} of free space, so a smaller model"
            ),
        ),
        None => (
            wanted,
            tr!(
                "可用空间只有 {space}，需要先清理出一些空间",
                "Only {space} of free space; free up some space first"
            ),
        ),
    }
}

fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1e9)
}

/// Local transcription is offered on Apple Silicon only; on Intel it is far too slow, and
/// on Windows only cloud services are offered for now (whisper.cpp is built with Metal).
pub fn supported() -> bool {
    cfg!(all(target_os = "macos", target_arch = "aarch64"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_well_formed() {
        for m in MODELS {
            assert_eq!(m.sha256.len(), 64, "{}", m.id);
            assert!(
                m.file.starts_with("ggml-") && m.file.ends_with(".bin"),
                "{}",
                m.id
            );
            assert!(m.url().starts_with("https://huggingface.co/"), "{}", m.id);
        }
        for id in BY_STRENGTH {
            assert!(find(id).is_some(), "{id}");
        }
    }

    #[test]
    fn fit_depends_on_memory() {
        let large = find("large-v3").unwrap();
        let turbo = find("large-v3-turbo-q5_0").unwrap();
        assert_eq!(fit(turbo, 8.0), Fit::Good);
        assert_eq!(fit(large, 8.0), Fit::TooBig);
        assert_eq!(fit(large, 12.0), Fit::Tight);
        assert_eq!(fit(large, 16.0), Fit::Good);
    }

    #[test]
    fn recommendation_follows_chip_memory_and_disk() {
        let roomy = Some(200_000_000_000);
        let pick = |ram, chip, free| recommend(ram, chip, free).0;
        assert_eq!(pick(8.0, "Apple M1", roomy), "large-v3-turbo-q5_0");
        assert_eq!(pick(16.0, "Apple M2", roomy), "large-v3-turbo-q8_0");
        assert_eq!(pick(16.0, "Apple M3 Max", roomy), "large-v3-turbo-q8_0");
        assert_eq!(pick(36.0, "Apple M3 Max", roomy), "large-v3");
        assert_eq!(pick(64.0, "Apple M2 Pro", roomy), "large-v3-turbo-q8_0");
        assert_eq!(pick(16.0, "Apple M2", None), "large-v3-turbo-q8_0");
        // A nearly full disk steps down to what fits, or says to make room.
        assert_eq!(
            pick(36.0, "Apple M3 Max", Some(2_000_000_000)),
            "large-v3-turbo-q8_0"
        );
        assert_eq!(
            pick(16.0, "Apple M2", Some(1_200_000_000)),
            "large-v3-turbo-q5_0"
        );
        assert_eq!(pick(16.0, "Apple M2", Some(800_000_000)), "small-q5_1");
        let (id, why) = recommend(16.0, "Apple M2", Some(100_000_000));
        assert_eq!(id, "large-v3-turbo-q8_0");
        assert!(why.contains("清理"), "{why}");
    }
}
