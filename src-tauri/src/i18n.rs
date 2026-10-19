//! Interface language: Simplified Chinese or English. Settings keep the learner's choice
//! ("" = follow the Mac's language, "zh", "en"); the resolved language is one global flag
//! that messages built in Rust read through `tr!` / `pick`.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn is_en() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// The language in use: "zh" or "en".
pub fn current() -> &'static str {
    pick("zh", "en")
}

/// Applies a setting and returns the language now in use ("zh" or "en").
pub fn apply(setting: &str) -> &'static str {
    ENGLISH.store(
        resolve(setting, sys_locale::get_locales()),
        Ordering::Relaxed,
    );
    current()
}

/// English unless the setting or, when it follows the system, the Mac's first preferred
/// language is Chinese (any script or region).
fn resolve(setting: &str, mut system: impl Iterator<Item = String>) -> bool {
    match setting {
        "zh" => false,
        "en" => true,
        _ => !system
            .next()
            .is_some_and(|l| l.to_ascii_lowercase().starts_with("zh")),
    }
}

/// The Chinese or the English text, for messages without arguments.
pub fn pick(zh: &'static str, en: &'static str) -> &'static str {
    if is_en() {
        en
    } else {
        zh
    }
}

/// The macOS wording or the Windows one, for text that names the computer or one of its
/// parts: "这台 Mac" / "这台电脑", "this Mac" / "this PC", "钥匙串" / "Windows 凭据管理器".
/// `pick(os(..), os(..))` for messages; usable in constants too.
pub const fn os(mac: &'static str, windows: &'static str) -> &'static str {
    if cfg!(target_os = "macos") {
        mac
    } else {
        windows
    }
}

/// `format!` with the Chinese or the English template: `tr!("找不到 {name}", "{name} not found")`.
/// `#[macro_use]` on the module in lib.rs makes it usable in every module declared after it.
macro_rules! tr {
    ($zh:literal, $en:literal $(, $arg:expr)* $(,)?) => {
        if $crate::i18n::is_en() {
            format!($en $(, $arg)*)
        } else {
            format!($zh $(, $arg)*)
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn system(langs: &[&str]) -> impl Iterator<Item = String> {
        langs
            .iter()
            .map(|l| l.to_string())
            .collect::<Vec<_>>()
            .into_iter()
    }

    #[test]
    fn follows_the_first_system_language() {
        assert!(!resolve("", system(&["zh-Hans-CN", "en-US"])));
        assert!(!resolve("", system(&["zh-Hant-TW"])));
        assert!(resolve("", system(&["ja-JP", "zh-Hans-CN"])));
        assert!(resolve("", system(&["en-US"])));
        assert!(resolve("", system(&[])));
    }

    #[test]
    fn a_choice_wins_over_the_system() {
        assert!(!resolve("zh", system(&["en-US"])));
        assert!(resolve("en", system(&["zh-Hans-CN"])));
    }
}
