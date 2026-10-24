//! Words the transcriber was unsure of → the parts of each sentence to
//! underline, so a likely mishearing (寝蔵 for 寝相) is easy to spot and check.

use super::sentences::{counts, letters, Word};
use crate::subtitles::is_cjk;
use crate::transcript::Sentence;

/// Words below this probability are marked. On five Japanese dialogue tracks
/// (large-v3-turbo, ~10 minutes) this marked about one word every two minutes,
/// half of them real mistakes (来たい for 着たい, the kanji of a name).
const UNSURE_BELOW: f64 = 0.4;

/// One entry per letter, as `sentences::Clock` counts them: whether its word
/// was unsure. Words of only hiragana (and ー) are never marked: they are mostly
/// fillers, particles and drawn-out endings (え, の, なー); the mishearings worth
/// checking are in kanji, katakana and other scripts.
pub(super) fn per_letter(words: &[Word]) -> Vec<bool> {
    words
        .iter()
        .flat_map(|w| {
            let unsure = w.probability.is_some_and(|p| p < UNSURE_BELOW)
                && !w
                    .word
                    .chars()
                    .filter(|&c| counts(c))
                    .all(|c| is_hiragana(c) || c == 'ー');
            std::iter::repeat_n(unsure, letters(&w.word))
        })
        .collect()
}

/// Fills in `unsure` on sentences that follow each other letter by letter
/// over `per_letter`'s output (`scale`: its letters per sentence letter).
pub(super) fn mark(sentences: &mut [Sentence], unsure: &[bool], scale: f64) {
    if !unsure.contains(&true) {
        return;
    }
    let mut letter = 0;
    for s in sentences {
        let flags: Vec<bool> = s
            .text
            .chars()
            .map(|c| {
                if !counts(c) {
                    return false;
                }
                let i = ((letter as f64 * scale) as usize).min(unsure.len() - 1);
                letter += 1;
                unsure[i]
            })
            .collect();
        s.unsure = ranges(&s.text, &flags);
    }
}

/// Runs of marked characters as UTF-16 ranges, widened to the whole word in
/// katakana and in scripts written with spaces. A kanji stays on its own, so
/// the doubtful character in a compound stands out.
fn ranges(text: &str, flags: &[bool]) -> Vec<[u32; 2]> {
    let chars: Vec<char> = text.chars().collect();
    let mut marked = flags.to_vec();
    for i in (0..chars.len()).filter(|&i| flags[i]) {
        let Some(k) = kind(chars[i]) else { continue };
        for j in (0..i).rev().take_while(|&j| kind(chars[j]) == Some(k)) {
            marked[j] = true;
        }
        for j in (i + 1..chars.len()).take_while(|&j| kind(chars[j]) == Some(k)) {
            marked[j] = true;
        }
    }
    let mut out: Vec<[u32; 2]> = Vec::new();
    let mut at = 0;
    for (c, m) in chars.iter().zip(marked) {
        let width = c.len_utf16() as u32;
        if m {
            match out.last_mut() {
                Some(r) if r[1] == at => r[1] += width,
                _ => out.push([at, at + width]),
            }
        }
        at += width;
    }
    out
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Katakana,
    Spaced,
}

/// What a mark widens over: a katakana word (with its ー), or a word of letters and digits.
fn kind(c: char) -> Option<Kind> {
    if ('\u{30A1}'..='\u{30FF}').contains(&c) && c != '・' {
        Some(Kind::Katakana)
    } else if c.is_alphanumeric() && !is_cjk(c) && !('\u{20000}'..='\u{3FFFF}').contains(&c) {
        Some(Kind::Spaced)
    } else {
        None
    }
}

fn is_hiragana(c: char) -> bool {
    ('\u{3041}'..='\u{309F}').contains(&c)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, p: Option<f64>) -> Word {
        Word {
            word: text.into(),
            start: 0.0,
            end: 0.0,
            probability: p,
        }
    }

    fn sentence(text: &str) -> Sentence {
        Sentence {
            start: 0.0,
            end: 1.0,
            text: text.into(),
            speaker: None,
            unsure: Vec::new(),
            times: Vec::new(),
        }
    }

    /// Marks for one sentence spoken as `words`.
    fn marked(text: &str, words: &[(&str, f64)]) -> Vec<[u32; 2]> {
        let words: Vec<Word> = words.iter().map(|&(w, p)| word(w, Some(p))).collect();
        let mut s = [sentence(text)];
        mark(&mut s, &per_letter(&words), 1.0);
        s[0].unsure.clone()
    }

    #[test]
    fn an_unsure_kanji_is_marked_on_its_own() {
        let words = [
            ("ね", 0.4),
            ("え", 0.99),
            ("寝", 0.83),
            ("蔵", 0.26),
            ("ア", 0.99),
            ("ート", 1.0),
        ];
        assert_eq!(marked("ねえ、寝蔵アートって?", &words), [[4, 5]]);
    }

    #[test]
    fn katakana_and_spaced_words_are_marked_whole() {
        assert_eq!(
            marked(
                "ネゾウアート",
                &[("ネ", 0.3), ("ゾウ", 0.9), ("アート", 0.9)]
            ),
            [[0, 6]]
        );
        let words = [("Sh", 0.9), ("adow", 0.3), ("ing", 0.9), ("means", 0.99)];
        assert_eq!(marked("Shadowing means", &words), [[0, 9]]);
    }

    #[test]
    fn sure_words_hiragana_and_missing_probabilities_are_left_alone() {
        assert!(marked("あ、来たい", &[("あ", 0.9), ("来", 0.9), ("たい", 0.9)]).is_empty());
        assert!(marked("えぇ、面白", &[("え", 0.31), ("ぇ", 0.9), ("面白", 0.9)]).is_empty());
        assert!(marked("来たいなー。", &[("来", 0.9), ("たいな", 0.9), ("ー", 0.3)]).is_empty());
        let mut s = [sentence("寝蔵")];
        mark(&mut s, &per_letter(&[word("寝蔵", None)]), 1.0);
        assert!(s[0].unsure.is_empty());
    }

    #[test]
    fn marks_follow_on_across_sentences_in_utf16_units() {
        let words = [
            ("𠮷", 0.9),
            ("野", 0.2),
            ("家", 0.9),
            ("来", 0.35),
            ("た", 0.9),
        ];
        let mut s = [sentence("𠮷野家。"), sentence("来た。")];
        mark(
            &mut s,
            &per_letter(&words.map(|(w, p)| word(w, Some(p)))),
            1.0,
        );
        assert_eq!(
            (s[0].unsure.clone(), s[1].unsure.clone()),
            (vec![[2, 3]], vec![[0, 1]])
        );
    }
}
