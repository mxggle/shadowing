//! Which language the app speaks: Simplified Chinese or English. Settings keep the choice
//! ("" = follow the Mac's preferred language); messages pick their wording with `tr!`
//! (formatted) or `pick` (plain), so the webview gets errors in the language it shows.

use std::sync::atomic::{AtomicBool, Ordering};

/// Off until `apply` says otherwise, so tests read the Chinese wording.
static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// `choice` from settings: "zh", "en", or anything else for the Mac's language.
pub fn apply(choice: &str) {
    let english = match choice {
        "zh" => false,
        "en" => true,
        _ => system() == "en",
    };
    ENGLISH.store(english, Ordering::Relaxed);
}

/// "zh" when the Mac's first preferred language is Chinese, else "en".
/// (WKWebView's `navigator.language` follows the app bundle, not the user.)
pub fn system() -> &'static str {
    match preferred() {
        Some(tag) if tag.starts_with("zh") => "zh",
        Some(_) => "en",
        None => "zh",
    }
}

#[cfg(target_os = "macos")]
fn preferred() -> Option<String> {
    use objc2_foundation::NSLocale;
    NSLocale::preferredLanguages()
        .firstObject()
        .map(|tag| tag.to_string())
}

#[cfg(not(target_os = "macos"))]
fn preferred() -> Option<String> {
    std::env::var("LANG").ok()
}

/// The wording for the language in use.
pub fn pick(zh: &'static str, en: &'static str) -> &'static str {
    if english() {
        en
    } else {
        zh
    }
}

/// `format!` in the language in use: `tr!("已下载 {n} 个", "{n} downloaded", n = n)`.
/// Both strings take the same arguments.
#[macro_export]
macro_rules! tr {
    ($zh:literal, $en:literal $(, $($arg:tt)*)?) => {
        if $crate::i18n::english() {
            format!($en $(, $($arg)*)?)
        } else {
            format!($zh $(, $($arg)*)?)
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chinese_until_told() {
        assert_eq!(pick("中文", "English"), "中文");
        let n = 3;
        assert_eq!(tr!("{n} 句", "{n} sentences"), "3 句");
    }
}
