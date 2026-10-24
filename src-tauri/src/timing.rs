//! When each part of a sentence is said, so the playing sentence can light up
//! as it goes: a character at a time in Chinese and Japanese, a word at a time
//! in languages written with spaces. Only transcription knows these times
//! (`transcribe::sentences`); they follow the text through corrections, cuts
//! and joins. Sentences without them are lit whole, as before.

use crate::subtitles::is_cjk;

/// [UTF-16 offset in the text, seconds in the audio] for each character (or
/// word) that lights on its own, in text order.
pub type Times = Vec<(u32, f64)>;

/// Characters inside a word ("don't", "co-op"): they don't start a new one.
const IN_WORD: &[char] = &['\'', '’', '-'];

/// Written without spaces between words: each character lights on its own.
fn unspaced(c: char) -> bool {
    is_cjk(c) || ('\u{20000}'..='\u{3FFFF}').contains(&c)
}

/// For each character of `text`: its UTF-16 offset, whether it is said (a
/// letter or digit, as `transcribe::sentences::letters` counts them) and
/// whether it starts something lit on its own.
fn chars(text: &str) -> Vec<(u32, bool, bool)> {
    let mut out = Vec::new();
    let mut at = 0;
    let mut in_word = false;
    for c in text.chars() {
        let said = c.is_alphanumeric();
        out.push((at, said, said && (unspaced(c) || !in_word)));
        in_word = (said && !unspaced(c)) || (in_word && IN_WORD.contains(&c));
        at += c.len_utf16() as u32;
    }
    out
}

/// Times for `text`, given when each of its letters starts, in order
/// (`letter` is called once per letter): only those that start something
/// lit are kept, never earlier than the one before.
pub fn for_letters(text: &str, mut letter: impl FnMut() -> f64) -> Times {
    let mut out: Times = Vec::new();
    for (at, said, starts) in chars(text) {
        if !said {
            continue;
        }
        let t = letter();
        if starts {
            let t = out.last().map_or(t, |&(_, last)| t.max(last));
            out.push((at, (t * 100.0).round() / 100.0));
        }
    }
    out
}

/// `times` of `before`, moved onto `after` (the same sentence corrected).
/// Characters kept keep their time; where some were replaced, the new ones
/// that light on their own take the old ones' times in turn (寝蔵 → 寝相:
/// 相 is said when 蔵 was). New text with no time lights with what's before it.
pub fn follow(before: &str, after: &str, times: &[(u32, f64)]) -> Times {
    if times.is_empty() || before == after {
        return times.to_vec();
    }
    let (a, b) = (chars(before), chars(after));
    let (a_text, b_text): (Vec<char>, Vec<char>) =
        (before.chars().collect(), after.chars().collect());
    let (n, m) = (a_text.len(), b_text.len());
    if n * m > 1 << 20 {
        return Vec::new();
    }
    let time_at: Vec<Option<f64>> = a
        .iter()
        .map(|&(at, ..)| times.iter().find(|&&(o, _)| o == at).map(|&(_, t)| t))
        .collect();
    // Longest common subsequence, from the end: same[i][j] for a[i..], b[j..].
    let mut same = vec![vec![0u16; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            same[i][j] = if a_text[i] == b_text[j] {
                same[i + 1][j + 1] + 1
            } else {
                same[i + 1][j].max(same[i][j + 1])
            };
        }
    }
    let mut out: Times = Vec::new();
    let (mut i, mut j) = (0, 0);
    // A run of changes: times of the characters taken out, offsets of the new ones that light.
    let (mut gone, mut new): (Vec<f64>, Vec<u32>) = (Vec::new(), Vec::new());
    while i < n || j < m {
        if i < n && j < m && a_text[i] == b_text[j] && same[i][j] == same[i + 1][j + 1] + 1 {
            settle(&mut gone, &mut new, &mut out);
            if let Some(t) = time_at[i] {
                out.push((b[j].0, t));
            }
            (i, j) = (i + 1, j + 1);
        } else if i < n && (j == m || same[i + 1][j] >= same[i][j + 1]) {
            gone.extend(time_at[i]);
            i += 1;
        } else {
            if b[j].2 {
                new.push(b[j].0);
            }
            j += 1;
        }
    }
    settle(&mut gone, &mut new, &mut out);
    out.sort_by_key(|&(at, _)| at);
    out
}

/// Ends a run of changes: its new characters take the old ones' times in turn.
fn settle(gone: &mut Vec<f64>, new: &mut Vec<u32>, out: &mut Times) {
    out.extend(new.drain(..).zip(gone.drain(..)));
}

/// The times in [from, to) of a sentence cut there, counted from `from`.
pub fn within(times: &[(u32, f64)], from: u32, to: u32) -> Times {
    times
        .iter()
        .filter(|&&(at, _)| at >= from && at < to)
        .map(|&(at, t)| (at - from, t))
        .collect()
}

/// Only times that fit a text `length` UTF-16 units long, in order (sent back by the page).
pub fn fitting(times: &mut Times, length: u32) {
    let mut last: Option<u32> = None;
    times.retain(|&(at, t)| {
        let fits = at < length && t.is_finite() && last.is_none_or(|l| at > l);
        if fits {
            last = Some(at);
        }
        fits
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Letters said one a second from 0.
    fn timed(text: &str) -> Times {
        let mut t = -1.0;
        for_letters(text, || {
            t += 1.0;
            t
        })
    }

    #[test]
    fn japanese_lights_a_character_at_a_time_and_english_a_word() {
        assert_eq!(
            timed("「𠮷野家、です。」"),
            [(1, 0.0), (3, 1.0), (4, 2.0), (6, 3.0), (7, 4.0)]
        );
        assert_eq!(
            timed("Don't stop, co-op 2 go."),
            [(0, 0.0), (6, 4.0), (12, 8.0), (18, 12.0), (20, 13.0)]
        );
        assert_eq!(timed("'Hi' 3.5"), [(1, 0.0), (5, 2.0), (7, 3.0)]);
    }

    #[test]
    fn times_never_go_back_and_are_rounded() {
        let mut said = [2.004, 1.5, 3.0].into_iter();
        assert_eq!(
            for_letters("あいう", || said.next().unwrap()),
            [(0, 2.0), (1, 2.0), (2, 3.0)]
        );
    }

    #[test]
    fn a_corrected_character_takes_the_time_of_the_one_it_replaces() {
        let before = "ねえ、寝蔵アート";
        let times = timed(before);
        assert_eq!(
            follow(before, "ねえ、寝相アート", &times),
            [
                (0, 0.0),
                (1, 1.0),
                (3, 2.0),
                (4, 3.0),
                (5, 4.0),
                (6, 5.0),
                (7, 6.0)
            ]
        );
        // Taken out: the rest close up; put in: lit with what's before it.
        assert_eq!(
            follow(before, "寝蔵アート", &times),
            [(0, 2.0), (1, 3.0), (2, 4.0), (3, 5.0), (4, 6.0)]
        );
        assert_eq!(
            follow("寝相", "寝ている相", &[(0, 1.0), (1, 2.0)]),
            [(0, 1.0), (4, 2.0)]
        );
    }

    #[test]
    fn a_corrected_word_keeps_the_words_around_it() {
        let before = "I red the book twice.";
        let times = timed(before);
        assert_eq!(times, [(0, 0.0), (2, 1.0), (6, 4.0), (10, 7.0), (15, 11.0)]);
        assert_eq!(
            follow(before, "I read the books twice.", &times),
            [(0, 0.0), (2, 1.0), (7, 4.0), (11, 7.0), (17, 11.0)]
        );
        assert_eq!(follow(before, before, &times), times);
        assert!(follow(before, "Something else", &[]).is_empty());
    }

    #[test]
    fn a_cut_keeps_each_parts_own_times() {
        let times = vec![(0, 1.0), (2, 2.0), (5, 3.0)];
        assert_eq!(within(&times, 0, 3), [(0, 1.0), (2, 2.0)]);
        assert_eq!(within(&times, 4, 9), [(1, 3.0)]);
    }

    #[test]
    fn times_sent_back_must_fit_the_text() {
        let mut times = vec![
            (0, 1.0),
            (3, f64::NAN),
            (2, 2.0),
            (2, 2.5),
            (1, 3.0),
            (6, 4.0),
        ];
        fitting(&mut times, 6);
        assert_eq!(times, [(0, 1.0), (2, 2.0)]);
    }
}
