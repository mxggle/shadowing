//! File and folder names made from titles (what an import is called in the
//! learner's folder). The same on every computer, so a folder copied between a
//! Mac and a PC keeps its names. src/lib/imports.ts `folderName` mirrors this
//! for the folder groups shown while downloading: change both together.

/// Bytes of a file name before the extension, leaving room for “ (12)” and “.m4a”.
pub const MAX_NAME_BYTES: usize = 180;

/// A file or folder name from a title: no `/` `:` or other characters that some
/// disks refuse, not hidden (the folder list skips hidden files), not ending in
/// a dot or space (Windows drops those), not a name Windows keeps for devices,
/// not too long.
pub fn safe_name(title: &str) -> String {
    let replaced: String = title
        .chars()
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let mut name = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    name = name.trim_start_matches(['.', ' ']).to_string();
    if let Some(end) = device_name(&name) {
        name.insert(end, '_');
    }
    if name.len() > MAX_NAME_BYTES {
        let mut cut = MAX_NAME_BYTES;
        while !name.is_char_boundary(cut) {
            cut -= 1;
        }
        name.truncate(cut);
    }
    let name = name.trim_end_matches(['.', ' ']).to_string();
    if name.is_empty() {
        crate::i18n::pick("未命名", "Untitled").into()
    } else {
        name
    }
}

/// Where the device name ends when `name` is one Windows keeps for devices,
/// whatever follows the first dot: `CON`, `nul.txt`, `Com1 .tar.gz`.
fn device_name(name: &str) -> Option<usize> {
    let base = name.split('.').next().unwrap_or("").trim_end_matches(' ');
    let fixed = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"];
    let numbered = base.len() >= 4
        && base.is_char_boundary(3)
        && ["COM", "LPT"]
            .iter()
            .any(|p| base[..3].eq_ignore_ascii_case(p))
        && matches!(
            &base[3..],
            "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
        );
    let reserved = numbered || fixed.iter().any(|d| base.eq_ignore_ascii_case(d));
    reserved.then_some(base.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same cases as `folderName` in src/lib/imports.test.ts.
    #[test]
    fn names_from_titles() {
        for (title, name) in [
            (
                "日本語練習／中級【～によって】会話",
                "日本語練習／中級【～によって】会話",
            ),
            ("AC/DC: Live?  \"Best\"\n", "AC DC Live Best"),
            ("a/b: c", "a b c"),
            ("...hidden", "hidden"),
            ("  ..  ", "未命名"),
            ("../..", "未命名"),
            ("ends with dots...", "ends with dots"),
            ("tab\there\u{3000}wide\u{a0}space", "tab here wide space"),
            ("c1\u{85}control\u{9f}chars\u{7f}", "c1 control chars"),
            ("CON", "CON_"),
            ("con.txt", "con_.txt"),
            ("Nul .tar.gz", "Nul_ .tar.gz"),
            ("aux...", "aux_"),
            ("COM1", "COM1_"),
            ("lpt9.mp3", "lpt9_.mp3"),
            ("COM¹", "COM¹_"),
            ("CONOUT$", "CONOUT$_"),
            ("COM10", "COM10"),
            ("CONSOLE", "CONSOLE"),
            ("con-game", "con-game"),
            ("Prn: Live", "Prn Live"),
        ] {
            assert_eq!(safe_name(title), name, "{title:?}");
        }
        let long = safe_name(&"あ".repeat(100));
        assert_eq!(long, "あ".repeat(60));
        let device = safe_name(&format!("con.{}", "x".repeat(300)));
        assert!(device.starts_with("con_.") && device.len() == MAX_NAME_BYTES);
    }
}
