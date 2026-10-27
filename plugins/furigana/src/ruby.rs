//! Which characters of a word get which reading: 食べ物 (タベモノ) is 食 た, べ,
//! 物 もの. Only runs with kanji get a reading; kana between them must match the
//! reading, which is how it's split. And the reading in the style picked.

/// A piece of a sentence and what's shown over it (only over kanji).
#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    pub text: String,
    pub ruby: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Style {
    Hiragana,
    Katakana,
    Romaji,
}

impl Style {
    pub fn parse(value: Option<&str>) -> Self {
        match value {
            Some("katakana") => Style::Katakana,
            Some("romaji") => Style::Romaji,
            _ => Style::Hiragana,
        }
    }
}

fn is_kana(c: char) -> bool {
    matches!(c, '\u{3041}'..='\u{3096}' | '\u{30A1}'..='\u{30FA}' | 'ー' | 'ゝ' | 'ゞ' | 'ヽ' | 'ヾ')
}

pub fn is_kanji(c: char) -> bool {
    matches!(c, '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' | '\u{F900}'..='\u{FAFF}' | '\u{20000}'..='\u{2FA1F}' | '々' | '〆' | 'ヶ' | 'ヵ')
}

/// Katakana → hiragana; everything else stays.
pub fn hiragana(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\u{30A1}'..='\u{30F6}' => char::from_u32(c as u32 - 0x60).unwrap_or(c),
            _ => c,
        })
        .collect()
}

/// Hiragana → katakana; everything else stays.
pub fn katakana(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\u{3041}'..='\u{3096}' => char::from_u32(c as u32 + 0x60).unwrap_or(c),
            _ => c,
        })
        .collect()
}

/// One word (`surface`) with its reading (katakana, from the dictionary) split
/// over its kanji runs. Without a way to split it, the whole reading goes over
/// the whole word.
pub fn word(surface: &str, reading: &str) -> Vec<Piece> {
    let plain = || {
        vec![Piece {
            text: surface.to_string(),
            ruby: None,
        }]
    };
    if !surface.chars().any(is_kanji) {
        return plain();
    }
    let reading = hiragana(reading);
    if reading.is_empty() || !reading.chars().all(is_kana) {
        return plain();
    }
    // Runs of kana and of anything else, in order.
    let mut runs: Vec<(bool, String)> = Vec::new();
    for c in surface.chars() {
        let kana = is_kana(c);
        match runs.last_mut() {
            Some((k, text)) if *k == kana => text.push(c),
            _ => runs.push((kana, c.to_string())),
        }
    }
    let reading: Vec<char> = reading.chars().collect();
    match split(&runs, &reading) {
        Some(parts) => runs
            .into_iter()
            .zip(parts)
            .map(|((kana, text), part)| {
                let ruby = (!kana && text.chars().any(is_kanji)).then_some(part);
                Piece { text, ruby }
            })
            .collect(),
        None => vec![Piece {
            text: surface.to_string(),
            ruby: Some(reading.iter().collect()),
        }],
    }
}

/// The part of `reading` each run says: kana runs say themselves, others at
/// least one character. Tries shorter parts first.
fn split(runs: &[(bool, String)], reading: &[char]) -> Option<Vec<String>> {
    let Some(((kana, text), rest)) = runs.split_first() else {
        return reading.is_empty().then(Vec::new);
    };
    if *kana {
        let own: Vec<char> = hiragana(text).chars().collect();
        if reading.len() < own.len() || reading[..own.len()] != own[..] {
            return None;
        }
        let mut parts = split(rest, &reading[own.len()..])?;
        parts.insert(0, text.clone());
        return Some(parts);
    }
    for n in 1..=reading.len() {
        if let Some(mut parts) = split(rest, &reading[n..]) {
            parts.insert(0, reading[..n].iter().collect());
            return Some(parts);
        }
    }
    None
}

/// A hiragana reading in the style picked.
pub fn styled(reading: &str, style: Style) -> String {
    match style {
        Style::Hiragana => reading.to_string(),
        Style::Katakana => katakana(reading),
        Style::Romaji => romaji(reading),
    }
}

fn syllable(c: char) -> Option<&'static str> {
    Some(match c {
        'あ' => "a",
        'い' => "i",
        'う' => "u",
        'え' => "e",
        'お' => "o",
        'か' => "ka",
        'き' => "ki",
        'く' => "ku",
        'け' => "ke",
        'こ' => "ko",
        'が' => "ga",
        'ぎ' => "gi",
        'ぐ' => "gu",
        'げ' => "ge",
        'ご' => "go",
        'さ' => "sa",
        'し' => "shi",
        'す' => "su",
        'せ' => "se",
        'そ' => "so",
        'ざ' => "za",
        'じ' => "ji",
        'ず' => "zu",
        'ぜ' => "ze",
        'ぞ' => "zo",
        'た' => "ta",
        'ち' => "chi",
        'つ' => "tsu",
        'て' => "te",
        'と' => "to",
        'だ' => "da",
        'ぢ' => "ji",
        'づ' => "zu",
        'で' => "de",
        'ど' => "do",
        'な' => "na",
        'に' => "ni",
        'ぬ' => "nu",
        'ね' => "ne",
        'の' => "no",
        'は' => "ha",
        'ひ' => "hi",
        'ふ' => "fu",
        'へ' => "he",
        'ほ' => "ho",
        'ば' => "ba",
        'び' => "bi",
        'ぶ' => "bu",
        'べ' => "be",
        'ぼ' => "bo",
        'ぱ' => "pa",
        'ぴ' => "pi",
        'ぷ' => "pu",
        'ぺ' => "pe",
        'ぽ' => "po",
        'ま' => "ma",
        'み' => "mi",
        'む' => "mu",
        'め' => "me",
        'も' => "mo",
        'や' => "ya",
        'ゆ' => "yu",
        'よ' => "yo",
        'ら' => "ra",
        'り' => "ri",
        'る' => "ru",
        'れ' => "re",
        'ろ' => "ro",
        'わ' => "wa",
        'ゐ' => "i",
        'ゑ' => "e",
        'を' => "o",
        'ん' => "n",
        'ゔ' => "vu",
        'ぁ' => "a",
        'ぃ' => "i",
        'ぅ' => "u",
        'ぇ' => "e",
        'ぉ' => "o",
        'ゎ' => "wa",
        'ゕ' => "ka",
        'ゖ' => "ke",
        _ => return None,
    })
}

/// Hepburn, spelled the way the kana are (とうきょう → toukyou), so every
/// kana can be found in it.
pub fn romaji(reading: &str) -> String {
    let chars: Vec<char> = hiragana(reading).chars().collect();
    let mut out = String::new();
    let mut double = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let mut piece = match c {
            'っ' => {
                double = true;
                i += 1;
                continue;
            }
            'ー' => out
                .chars()
                .last()
                .filter(|v| "aiueo".contains(*v))
                .map(String::from)
                .unwrap_or_default(),
            _ => syllable(c)
                .map(String::from)
                .unwrap_or_else(|| c.to_string()),
        };
        // きゃ kya, しゃ sha, ちょ cho, じゅ ju.
        if let Some(small) = chars.get(i + 1).and_then(|n| match n {
            'ゃ' => Some('a'),
            'ゅ' => Some('u'),
            'ょ' => Some('o'),
            _ => None,
        }) {
            if let Some(stem) = piece.strip_suffix('i').filter(|s| !s.is_empty()) {
                piece = match stem {
                    "sh" | "ch" | "j" => format!("{stem}{small}"),
                    _ => format!("{stem}y{small}"),
                };
                i += 1;
            }
        }
        if c == 'ん'
            && chars
                .get(i + 1)
                .and_then(|n| syllable(*n))
                .is_some_and(|s| s.starts_with(['a', 'i', 'u', 'e', 'o', 'y']))
        {
            piece.push('\'');
        }
        if double {
            double = false;
            match piece.chars().next() {
                // っち tchi
                Some('c') => out.push('t'),
                Some(first) if !"aiueon".contains(first) => out.push(first),
                _ => {}
            }
        }
        out.push_str(&piece);
        i += 1;
    }
    if double {
        out.push('t');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shown(pieces: &[Piece]) -> String {
        pieces
            .iter()
            .map(|p| match &p.ruby {
                Some(r) => format!("{}({r})", p.text),
                None => p.text.clone(),
            })
            .collect()
    }

    #[test]
    fn splits_the_reading_over_kanji_runs() {
        assert_eq!(shown(&word("食べ物", "タベモノ")), "食(た)べ物(もの)");
        assert_eq!(shown(&word("行き", "イキ")), "行(い)き");
        assert_eq!(shown(&word("美味しい", "オイシイ")), "美味(おい)しい");
        assert_eq!(shown(&word("東京", "トウキョウ")), "東京(とうきょう)");
        assert_eq!(shown(&word("お茶", "オチャ")), "お茶(ちゃ)");
        assert_eq!(shown(&word("人々", "ヒトビト")), "人々(ひとびと)");
    }

    #[test]
    fn leaves_words_without_kanji_alone() {
        assert_eq!(
            word("ます", "マス"),
            vec![Piece {
                text: "ます".into(),
                ruby: None
            }]
        );
        assert_eq!(shown(&word("3", "*")), "3");
        assert_eq!(shown(&word("東京", "*")), "東京");
    }

    #[test]
    fn puts_the_whole_reading_over_a_word_it_cannot_split() {
        // The dictionary's reading doesn't have the kana the word is written with.
        assert_eq!(shown(&word("見る", "ミタ")), "見る(みた)");
    }

    #[test]
    fn styles() {
        assert_eq!(styled("とうきょう", Style::Katakana), "トウキョウ");
        assert_eq!(styled("とうきょう", Style::Hiragana), "とうきょう");
        assert_eq!(romaji("とうきょう"), "toukyou");
        assert_eq!(romaji("しゃしん"), "shashin");
        assert_eq!(romaji("ちょっと"), "chotto");
        assert_eq!(romaji("いっしょ"), "issho");
        assert_eq!(romaji("まっちゃ"), "matcha");
        assert_eq!(romaji("じゅぎょう"), "jugyou");
        assert_eq!(romaji("きんようび"), "kin'youbi");
        assert_eq!(romaji("げんいん"), "gen'in");
        assert_eq!(romaji("しんぶん"), "shinbun");
        assert_eq!(romaji("ふじさん"), "fujisan");
        assert_eq!(romaji("いっ"), "it");
        assert_eq!(Style::parse(Some("romaji")), Style::Romaji);
        assert_eq!(Style::parse(None), Style::Hiragana);
    }
}
