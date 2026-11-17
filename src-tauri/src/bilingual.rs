//! Bilingual subtitles (双语字幕): each cue has the line as said and, on its own line, a
//! translation in another script ("今日は暑いね" / "今天好热啊"). Read as one language, the
//! two would run together into one sentence; here the translation lines are told apart
//! by their script, so the sentence keeps only what is said and the translation shows under it.

use std::collections::HashMap;

/// The kind of writing a line is in: enough to tell the two languages of a bilingual cue apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Script {
    /// Has kana.
    Japanese,
    Korean,
    /// Chinese characters and no kana.
    Han,
    Latin,
    Cyrillic,
}

/// The script most of a line's letters are in; None for a line of numbers or signs.
pub fn script(line: &str) -> Option<Script> {
    let (mut kana, mut hangul, mut han, mut latin, mut cyrillic) = (0, 0, 0, 0, 0);
    for c in line.chars() {
        match c as u32 {
            0x3040..=0x30FF | 0x31F0..=0x31FF | 0xFF66..=0xFF9D => kana += 1,
            0xAC00..=0xD7AF | 0x1100..=0x11FF | 0x3130..=0x318F => hangul += 1,
            0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF => han += 1,
            0x0400..=0x04FF => cyrillic += 1,
            _ if c.is_alphabetic() && (c as u32) < 0x0250 => latin += 1,
            _ => {}
        }
    }
    // A few kana among Chinese characters is Japanese (の, が, kana endings).
    if kana > 0 && kana * 10 >= han {
        return Some(Script::Japanese);
    }
    [
        (hangul, Script::Korean),
        (han + kana, Script::Han),
        (latin, Script::Latin),
        (cyrillic, Script::Cyrillic),
    ]
    .into_iter()
    .filter(|&(n, _)| n > 0)
    .max_by_key(|&(n, _)| n)
    .map(|(_, s)| s)
}

/// At least this share of cues has more than one line in a bilingual file…
const MULTI_LINE: f64 = 0.6;
/// …and at least this share of those starts and ends in different scripts.
const TWO_SCRIPTS: f64 = 0.8;

/// The script of the translation lines when the cues (each its lines) look bilingual;
/// None for subtitles in one language. `reader`: the script of the language the learner
/// reads (the interface's), which is the translation when one side is in it.
pub fn translation_script(cues: &[Vec<String>], reader: Script) -> Option<Script> {
    let multi: Vec<(Script, Script)> = cues
        .iter()
        .filter(|lines| lines.len() > 1)
        .filter_map(|lines| Some((script(lines.first()?)?, script(lines.last()?)?)))
        .collect();
    let all = cues.iter().filter(|l| !l.is_empty()).count();
    if all == 0 || (multi.len() as f64) < all as f64 * MULTI_LINE {
        return None;
    }
    let differ = multi.iter().filter(|(a, b)| a != b).count();
    if (differ as f64) < multi.len() as f64 * TWO_SCRIPTS {
        return None;
    }
    let most = |pick: fn(&(Script, Script)) -> Script| {
        let mut counts: HashMap<Script, usize> = HashMap::new();
        for pair in multi.iter().filter(|(a, b)| a != b) {
            *counts.entry(pick(pair)).or_default() += 1;
        }
        counts.into_iter().max_by_key(|&(_, n)| n).map(|(s, _)| s)
    };
    let (first, last) = (most(|p| p.0)?, most(|p| p.1)?);
    if first == last {
        return None;
    }
    // Usually the line as said comes first; but a file made for readers of Chinese often puts
    // the Chinese first, so a side in the learner's own script is the translation.
    Some(if first == reader { first } else { last })
}

/// One cue's lines split into what is said and its translation (`translation`: their script).
pub fn split(lines: &[String], translation: Script) -> (Vec<String>, Vec<String>) {
    let (theirs, said): (Vec<String>, Vec<String>) = lines
        .iter()
        .cloned()
        .partition(|l| script(l) == Some(translation));
    // A cue with only translation lines (a sign, a title card) keeps them as its text.
    if said.is_empty() {
        (theirs, Vec::new())
    } else {
        (said, theirs)
    }
}

/// The script of the language the learner reads ("zh" or "en").
pub fn reader_script(lang: &str) -> Script {
    if lang == "zh" {
        Script::Han
    } else {
        Script::Latin
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cues(pairs: &[&[&str]]) -> Vec<Vec<String>> {
        pairs
            .iter()
            .map(|c| c.iter().map(|s| s.to_string()).collect())
            .collect()
    }

    #[test]
    fn tells_scripts_apart() {
        assert_eq!(script("今日は暑いね"), Some(Script::Japanese));
        assert_eq!(script("東京大学に行きました。"), Some(Script::Japanese));
        assert_eq!(script("今天好热啊"), Some(Script::Han));
        assert_eq!(script("It's hot today."), Some(Script::Latin));
        assert_eq!(script("Ça va très bien"), Some(Script::Latin));
        assert_eq!(script("안녕하세요"), Some(Script::Korean));
        assert_eq!(script("Привет"), Some(Script::Cyrillic));
        assert_eq!(script("12:30 ♪"), None);
    }

    #[test]
    fn japanese_over_chinese() {
        let c = cues(&[
            &["今日は暑いね", "今天好热啊"],
            &["そうだね", "是啊"],
            &["散歩に行こうか", "去散步吧"],
        ]);
        assert_eq!(translation_script(&c, Script::Han), Some(Script::Han));
        assert_eq!(translation_script(&c, Script::Latin), Some(Script::Han));
        assert_eq!(
            split(&c[0], Script::Han),
            (
                vec!["今日は暑いね".to_string()],
                vec!["今天好热啊".to_string()]
            )
        );
    }

    #[test]
    fn chinese_first_for_a_chinese_reader() {
        let c = cues(&[&["你好吗？", "How are you?"], &["我很好", "I'm fine"]]);
        assert_eq!(translation_script(&c, Script::Han), Some(Script::Han));
        assert_eq!(
            split(&c[0], Script::Han),
            (
                vec!["How are you?".to_string()],
                vec!["你好吗？".to_string()]
            )
        );
        // Read by someone who reads English, English is the translation.
        assert_eq!(translation_script(&c, Script::Latin), Some(Script::Latin));
    }

    #[test]
    fn a_wrapped_line_in_one_language_is_not_bilingual() {
        let c = cues(&[
            &["Hello", "there."],
            &["How are", "you?"],
            &["今日は", "いい天気ですね。"],
        ]);
        assert_eq!(translation_script(&c, Script::Han), None);
        let single = cues(&[&["今日は暑いね", "今天好热啊"], &["そうだね"], &["行こう"]]);
        assert_eq!(translation_script(&single, Script::Han), None);
    }

    #[test]
    fn a_wrapped_original_keeps_both_its_lines() {
        let lines = cues(&[&["It's really hot", "today, isn't it?", "今天真热啊"]]);
        assert_eq!(
            split(&lines[0], Script::Han),
            (
                vec![
                    "It's really hot".to_string(),
                    "today, isn't it?".to_string()
                ],
                vec!["今天真热啊".to_string()]
            )
        );
    }
}
