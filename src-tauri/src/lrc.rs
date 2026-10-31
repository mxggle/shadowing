//! LRC (lyrics) files, common beside textbook MP3s: `[mm:ss.xx]` before each
//! line and no end times, so a line lasts until the next one starts.

use crate::subtitles::{clean_line, join_lines};
use crate::transcript::Sentence;

/// The last line has nothing after it to end it: this long per character, within these bounds.
const LAST_SECS_PER_CHAR: f64 = 0.2;
const LAST_MIN: f64 = 3.0;
const LAST_MAX: f64 = 12.0;

/// Lines sorted by time. A line with several times appears at each; lines at
/// the same time (a sentence and its translation) are joined; an empty timed
/// line only ends the one before. `[offset:ms]` moves every line earlier.
pub fn parse(text: &str) -> Result<Vec<Sentence>, String> {
    let mut offset = 0.0;
    let mut timed: Vec<(f64, String)> = Vec::new();
    for line in text.lines() {
        let mut rest = line.trim();
        let mut times = Vec::new();
        while let Some((tag, after)) = rest.strip_prefix('[').and_then(|r| r.split_once(']')) {
            if let Some(t) = parse_time(tag) {
                times.push(t);
            } else if let Some(ms) = tag.strip_prefix("offset:") {
                offset = ms.trim().parse::<f64>().unwrap_or(0.0) / 1000.0;
            }
            // [ti:…], [ar:…] and other tags carry nothing to show.
            rest = after.trim_start();
        }
        let words = clean_line(rest);
        timed.extend(times.into_iter().map(|t| (t, words.clone())));
    }
    timed.sort_by(|a, b| a.0.total_cmp(&b.0));

    // One entry per time: the lines there joined, empty when there's only an end mark.
    let mut at: Vec<(f64, Vec<String>)> = Vec::new();
    for (t, words) in timed {
        let t = (t - offset).max(0.0);
        if at.last().is_none_or(|(last, _)| *last != t) {
            at.push((t, Vec::new()));
        }
        if !words.is_empty() {
            at.last_mut().unwrap().1.push(words);
        }
    }

    let mut out = Vec::new();
    for (k, (start, lines)) in at.iter().enumerate() {
        let text = join_lines(lines);
        if text.is_empty() {
            continue;
        }
        let end = at.get(k + 1).map_or_else(
            || start + (text.chars().count() as f64 * LAST_SECS_PER_CHAR).clamp(LAST_MIN, LAST_MAX),
            |next| next.0,
        );
        out.push(Sentence {
            start: *start,
            end,
            text,
            speaker: None,
            unsure: Vec::new(),
            times: Vec::new(),
        });
    }
    if out.is_empty() {
        return Err(
            crate::i18n::pick("文件里没有找到字幕", "No subtitles found in the file").into(),
        );
    }
    Ok(out)
}

/// "01:02.34", "01:02.345", "01:02:34" (hundredths after a colon) or "01:02" → seconds.
fn parse_time(tag: &str) -> Option<f64> {
    let digits = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    let parts: Vec<&str> = tag.trim().split(':').collect();
    let (m, s, frac) = match parts.as_slice() {
        [m, s] => match s.split_once('.') {
            Some((s, frac)) => (*m, s, frac),
            None => (*m, *s, "0"),
        },
        [m, s, frac] => (*m, *s, *frac),
        _ => return None,
    };
    if !(digits(m) && digits(s) && digits(frac)) {
        return None;
    }
    let secs: f64 = format!("{s}.{frac}").parse().ok()?;
    Some(m.parse::<f64>().ok()? * 60.0 + secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spans(s: &[Sentence]) -> Vec<(f64, f64, &str)> {
        s.iter()
            .map(|s| (s.start, s.end, s.text.as_str()))
            .collect()
    }

    #[test]
    fn lines_last_until_the_next_one() {
        let lrc = "[ti:第一课]\n[ar:教材]\n\n[00:01.00]你好。\n[00:03.50]你好，\n我叫小明。\n[00:06.25]再见。\n[00:08.00]\n";
        assert_eq!(
            spans(&parse(lrc).unwrap()),
            [
                (1.0, 3.5, "你好。"),
                (3.5, 6.25, "你好，"),
                (6.25, 8.0, "再见。")
            ]
        );
    }

    #[test]
    fn last_line_gets_a_length_by_its_text() {
        let s = parse("[00:10.00]Hi.\n[01:00.00]This line is long enough to need more than the shortest time.").unwrap();
        assert_eq!((s[0].start, s[0].end), (10.0, 60.0));
        assert_eq!(s[1].start, 60.0);
        assert!((s[1].end - 72.0).abs() < 1e-9);
        assert_eq!(parse("[00:01]短い。").unwrap()[0].end, 4.0);
    }

    #[test]
    fn repeated_times_translations_and_word_times() {
        let lrc = "[00:05.00][00:01.00]Chorus line\n[00:03.00]Good <00:03.40>morning.\n[00:03.00]早上好。\n";
        assert_eq!(
            spans(&parse(lrc).unwrap()),
            [
                (1.0, 3.0, "Chorus line"),
                (3.0, 5.0, "Good morning. 早上好。"),
                (5.0, 8.0, "Chorus line")
            ]
        );
    }

    #[test]
    fn time_forms_and_offset() {
        assert_eq!(parse_time("01:02.5"), Some(62.5));
        assert_eq!(parse_time("01:02.345"), Some(62.345));
        assert_eq!(parse_time("01:02:34"), Some(62.34));
        assert_eq!(parse_time("75:00"), Some(4500.0));
        assert_eq!(parse_time("ti:Lesson"), None);
        assert_eq!(parse_time("nan:inf"), None);
        let s = parse("[offset:+500]\n[00:02.00]A\n[00:04.00]B\n").unwrap();
        assert_eq!(spans(&s)[..1], [(1.5, 3.5, "A")]);
    }

    #[test]
    fn nothing_timed_is_an_error() {
        assert!(parse("[ti:Only tags]\nplain text\n").is_err());
        assert!(parse("").is_err());
    }
}
