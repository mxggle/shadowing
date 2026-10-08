//! SRT / WebVTT parsing into timed sentences. Both formats share the
//! `start --> end` cue line, so one forgiving line scanner reads either.

use crate::transcript::Sentence;

/// Subtitle bytes as text: UTF-8 (with or without BOM) or UTF-16 with a BOM.
pub fn decode(bytes: &[u8]) -> Result<String, String> {
    let text = if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8(rest.to_vec()).ok()
    } else if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        utf16(rest, u16::from_le_bytes)
    } else if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        utf16(rest, u16::from_be_bytes)
    } else {
        String::from_utf8(bytes.to_vec()).ok()
    };
    text.ok_or_else(|| "字幕文件不是 UTF-8 编码，请先另存为 UTF-8".to_string())
}

fn utf16(bytes: &[u8], word: fn([u8; 2]) -> u16) -> Option<String> {
    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| word([c[0], c[1]])).collect();
    String::from_utf16(&units).ok()
}

/// Cues sorted by start. Headers, NOTE/STYLE blocks and cue ids are skipped;
/// a missing blank line between cues is tolerated.
pub fn parse(text: &str) -> Result<Vec<Sentence>, String> {
    struct Cue {
        start: f64,
        end: f64,
        lines: Vec<String>,
    }
    let mut cues: Vec<Cue> = Vec::new();
    let mut in_cue = false;
    for line in text.lines() {
        if let Some((start, end)) = parse_timing(line) {
            // Without a blank line, the previous cue swallowed this cue's index.
            if let Some(last) = cues.last_mut() {
                let is_index = |l: &String| l.chars().all(|c| c.is_ascii_digit());
                if last.lines.last().is_some_and(is_index) {
                    last.lines.pop();
                }
            }
            cues.push(Cue {
                start,
                end: end.max(start),
                lines: Vec::new(),
            });
            in_cue = true;
        } else if line.trim().is_empty() {
            in_cue = false;
        } else if in_cue {
            let cleaned = clean_line(line);
            if !cleaned.is_empty() {
                cues.last_mut().unwrap().lines.push(cleaned);
            }
        }
    }

    let mut out: Vec<Sentence> = Vec::new();
    for Cue { start, end, lines } in cues {
        let text = join_lines(&lines);
        if text.is_empty() {
            continue;
        }
        // Auto-generated captions repeat a line across back-to-back cues.
        if let Some(last) = out.last_mut() {
            if last.text == text && start - last.end < 0.5 {
                last.end = last.end.max(end);
                continue;
            }
        }
        out.push(Sentence { start, end, text });
    }
    out.sort_by(|a, b| a.start.total_cmp(&b.start));
    if out.is_empty() {
        return Err("文件里没有找到字幕".into());
    }
    Ok(out)
}

fn parse_timing(line: &str) -> Option<(f64, f64)> {
    let (left, right) = line.split_once("-->")?;
    // VTT cue settings ("align:start …") follow the end time.
    let right = right.split_whitespace().next()?;
    Some((parse_time(left.trim())?, parse_time(right)?))
}

/// "01:02:03,450", "01:02:03.450" or "02:03.450" → seconds.
fn parse_time(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    let (h, m, sec) = match parts.as_slice() {
        [h, m, s] => (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?, *s),
        [m, s] => (0, m.parse::<u32>().ok()?, *s),
        _ => return None,
    };
    let sec: f64 = sec.replace(',', ".").parse().ok()?;
    let t = f64::from(h) * 3600.0 + f64::from(m) * 60.0 + sec;
    t.is_finite().then_some(t)
}

/// Drops markup (`<i>`, `<v Name>`, `<00:01.000>`, `{\an8}`) and decodes entities.
fn clean_line(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        let close = match c {
            '<' => '>',
            '{' if chars.peek() == Some(&'\\') => '}',
            _ => {
                out.push(c);
                continue;
            }
        };
        for skipped in chars.by_ref() {
            if skipped == close {
                break;
            }
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&lrm;", "")
        .replace("&rlm;", "")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .trim()
        .to_string()
}

/// Joins wrapped lines: a space between words, nothing between CJK characters.
fn join_lines(lines: &[String]) -> String {
    let mut out = String::new();
    for line in lines {
        let glue = match (out.chars().last(), line.chars().next()) {
            (Some(a), Some(b)) => !(is_cjk(a) && is_cjk(b)),
            _ => false,
        };
        if glue {
            out.push(' ');
        }
        out.push_str(line);
    }
    out
}

pub(crate) fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3000..=0x30FF     // CJK punctuation, hiragana, katakana
        | 0x3400..=0x4DBF   // CJK extension A
        | 0x4E00..=0x9FFF   // CJK unified ideographs
        | 0xF900..=0xFAFF   // compatibility ideographs
        | 0xFF00..=0xFFEF) // full-width forms
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(s: &[Sentence]) -> Vec<&str> {
        s.iter().map(|s| s.text.as_str()).collect()
    }

    #[test]
    fn srt_with_crlf_tags_and_wrapped_lines() {
        let srt = "1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello</i>\r\nthere.\r\n\r\n\
                   2\r\n00:00:04,000 --> 00:00:06,250\r\n今日は\r\nいい天気ですね。\r\n";
        let s = parse(srt).unwrap();
        assert_eq!(texts(&s), ["Hello there.", "今日はいい天気ですね。"]);
        assert_eq!((s[0].start, s[0].end), (1.0, 3.5));
        assert_eq!((s[1].start, s[1].end), (4.0, 6.25));
    }

    #[test]
    fn vtt_header_notes_ids_settings_and_markup() {
        let vtt = "WEBVTT - lesson\n\nNOTE written by hand\n\nSTYLE\n::cue { color: red }\n\n\
                   intro\n00:01.000 --> 00:02.500 align:start position:10%\n<v Ken>Fish &amp; chips</v>\n\n\
                   01:00:00.000 --> 01:00:01.000\n<00:00:00.100><c>karaoke</c> {\\an8}words\n";
        let s = parse(vtt).unwrap();
        assert_eq!(texts(&s), ["Fish & chips", "karaoke words"]);
        assert_eq!((s[0].start, s[0].end), (1.0, 2.5));
        assert_eq!(s[1].start, 3600.0);
    }

    #[test]
    fn tolerates_missing_blank_lines_and_sorts() {
        let srt =
            "2\n00:00:05,000 --> 00:00:06,000\nsecond\n1\n00:00:01,000 --> 00:00:02,000\nfirst\n";
        assert_eq!(texts(&parse(srt).unwrap()), ["first", "second"]);
    }

    #[test]
    fn merges_repeated_rolling_captions() {
        let vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nsame\n\n00:00:02.010 --> 00:00:03.000\nsame\n";
        let s = parse(vtt).unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].end, 3.0);
    }

    #[test]
    fn empty_or_garbage_is_an_error() {
        assert!(parse("WEBVTT\n\n").is_err());
        assert!(parse("not a subtitle at all").is_err());
    }

    #[test]
    fn decodes_bom_variants_and_rejects_legacy_encodings() {
        assert_eq!(decode(b"\xEF\xBB\xBFhi").unwrap(), "hi");
        let utf16le: Vec<u8> = [0xFF, 0xFE]
            .into_iter()
            .chain("日本".encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        assert_eq!(decode(&utf16le).unwrap(), "日本");
        assert!(decode(&[0x93, 0xFA, 0x96, 0x7B]).is_err()); // Shift_JIS "日本"
    }
}
