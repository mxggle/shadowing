//! `import/resolve` and `import/run` with yt-dlp. Audio is YouTube's own AAC
//! track (m4a, itag 140): no re-encoding and no ffmpeg; the app plays the
//! DASH m4a yt-dlp writes without ffmpeg. Subtitles: only the ones people wrote.

use crate::run::run;
use crate::tools::{self, Tools};
use crate::{progress, Ctx};
use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;

const AUDIO: &str = "bestaudio[ext=m4a]";
const NO_M4A: &str = "这个视频没有 m4a 音轨（应用放不了 Opus / WebM 格式），下载不了";

fn command(ctx: &Ctx, tools: &Tools) -> Command {
    let mut c = Command::new(&tools.ytdlp);
    if cfg!(windows) {
        // Python on Windows would write in the system's code page.
        c.env("PYTHONUTF8", "1");
    }
    c.args(["--ignore-config", "--no-playlist", "--no-mtime"]);
    c.arg("--cache-dir").arg(ctx.data.join("cache"));
    if let Some(js) = &tools.js {
        c.args(["--js-runtimes", js]);
    }
    c
}

/// Runs yt-dlp; a failure becomes a sentence the learner can act on.
fn ytdlp(ctx: &Ctx, command: Command, line: &mut dyn FnMut(&str)) -> Result<(), String> {
    let out = run(ctx, command, line, &mut || {})?;
    if out.ok {
        return Ok(());
    }
    let (message, outdated) = explain(&out.stderr);
    if outdated {
        tools::check_again(ctx);
    }
    Err(message)
}

pub fn resolve(ctx: &Ctx, url: &str) -> Result<Value, String> {
    let tools = tools::ensure(ctx)?;
    progress("读取视频信息", 0, 0);
    let mut c = command(ctx, &tools);
    c.args(["-J", "--skip-download", "--", url]);
    let mut body = String::new();
    ytdlp(ctx, c, &mut |l| body.push_str(l))?;
    let info: Value = serde_json::from_str(&body).map_err(|_| "yt-dlp 的回答看不懂".to_string())?;
    describe(&info)
}

/// What the app shows before downloading (see `Resolved` in the app's plugins/import.rs).
fn describe(info: &Value) -> Result<Value, String> {
    if info["is_live"] == true {
        return Err("直播还没结束，不能下载".into());
    }
    let has_m4a = info["formats"].as_array().is_some_and(|formats| {
        formats
            .iter()
            .any(|f| f["ext"] == "m4a" && f["vcodec"] == "none" && f["acodec"] != "none")
    });
    if !has_m4a {
        return Err(NO_M4A.into());
    }
    let mut subtitles: Vec<Value> = info["subtitles"]
        .as_object()
        .map(|subs| {
            subs.iter()
                .filter(|(lang, list)| lang.as_str() != "live_chat" && list.as_array().is_some_and(|l| !l.is_empty()))
                .map(|(lang, list)| json!({ "lang": lang, "name": list[0]["name"].as_str().unwrap_or(lang) }))
                .collect()
        })
        .unwrap_or_default();
    subtitles.sort_by(|a, b| a["lang"].as_str().cmp(&b["lang"].as_str()));
    let uploader = info["uploader"]
        .as_str()
        .or(info["channel"].as_str())
        .map(str::trim);
    Ok(json!({
        "title": info["title"].as_str().unwrap_or("未命名"),
        "duration": info["duration"].as_f64(),
        "uploader": uploader,
        "language": info["language"].as_str(),
        "subtitles": subtitles,
    }))
}

/// A language code yt-dlp gets as-is (`--sub-langs` takes regular expressions).
fn plain_lang(lang: &str) -> bool {
    !lang.is_empty()
        && lang.len() <= 20
        && lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// `SHPROG <done> <total> <estimate>` from `--progress-template` → (done, total).
fn parse_progress(line: &str) -> Option<(u64, u64)> {
    let mut parts = line.strip_prefix("SHPROG ")?.split(' ');
    let n = |s: Option<&str>| s.and_then(|s| s.parse::<f64>().ok()).map(|f| f as u64);
    let done = n(parts.next())?;
    let total = n(parts.next()).or(n(parts.next())).unwrap_or(0);
    Some((done, total))
}

pub fn download(
    ctx: &Ctx,
    url: &str,
    out: &Path,
    subtitles: Option<&str>,
) -> Result<Value, String> {
    let tools = tools::ensure(ctx)?;
    progress("开始下载", 0, 0);
    let mut c = command(ctx, &tools);
    c.args(["-f", AUDIO, "--newline", "--progress-template"]);
    c.arg("download:SHPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s");
    c.arg("-o").arg(out.join("audio.%(ext)s"));
    let lang = subtitles.filter(|l| plain_lang(l));
    if let Some(lang) = lang {
        c.args(["--write-subs", "--sub-format", "vtt", "--sub-langs", lang]);
    }
    c.args(["--", url]);
    ytdlp(ctx, c, &mut |l| {
        if let Some((done, total)) = parse_progress(l) {
            progress("下载音频", done, total);
        }
    })?;

    let audio = out.join("audio.m4a");
    if !audio.is_file() {
        return Err(NO_M4A.into());
    }
    let mut files = vec![json!({ "path": "audio.m4a", "kind": "audio" })];
    if let Some(lang) = lang {
        let name = format!("audio.{lang}.vtt");
        if out.join(&name).is_file() {
            files.push(json!({ "path": name, "kind": "subtitle", "lang": lang }));
        }
    }
    Ok(json!({ "files": files }))
}

/// yt-dlp's error output → (what to tell the learner, whether yt-dlp may be out of date).
fn explain(stderr: &[String]) -> (String, bool) {
    let text = stderr.join("\n");
    let has = |needles: &[&str]| needles.iter().any(|n| text.contains(n));
    let message = if has(&["Sign in to confirm you", "not a bot"]) {
        "YouTube 要求登录确认不是机器人。过一会儿再试，或换个网络。"
    } else if has(&["Private video"]) {
        "这是私享视频，下载不了"
    } else if has(&["members-only", "Join this channel"]) {
        "这是频道会员才能看的视频，下载不了"
    } else if has(&[
        "confirm your age",
        "age-restricted",
        "Sign in to confirm your age",
    ]) {
        "这个视频有年龄限制，要登录才能看，暂时下载不了"
    } else if has(&[
        "not available in your country",
        "geo restriction",
        "geo-restricted",
    ]) {
        "这个视频在你所在的地区不能看"
    } else if has(&[
        "Video unavailable",
        "This video is unavailable",
        "has been removed",
        "This video has been terminated",
    ]) {
        "视频不存在或已被删除"
    } else if has(&["live event will begin", "is a live", "Premieres in"]) {
        "直播或首映还没结束，不能下载"
    } else if has(&["Requested format is not available"]) {
        NO_M4A
    } else if has(&["HTTP Error 429", "Too Many Requests"]) {
        "请求太频繁，被 YouTube 暂时限制了，过一会儿再试"
    } else if has(&[
        "Unable to extract",
        "nsig extraction failed",
        "Signature extraction failed",
        "Unsupported URL",
    ]) {
        return (
            "YouTube 改版了，yt-dlp 需要更新。再试一次会先检查有没有新版本。".into(),
            true,
        );
    } else if has(&[
        "getaddrinfo",
        "Unable to download webpage",
        "timed out",
        "Connection refused",
        "Network is unreachable",
    ]) {
        "连不上 YouTube，请检查网络（或代理）"
    } else {
        let last = stderr
            .iter()
            .rev()
            .find(|l| l.starts_with("ERROR:"))
            .or(stderr.last())
            .map(|l| strip_error(l))
            .unwrap_or_default();
        return (
            if last.is_empty() {
                "下载失败".into()
            } else {
                format!("yt-dlp：{last}")
            },
            false,
        );
    };
    (message.into(), false)
}

/// "ERROR: [youtube] abc: Something" → "Something"; other lines lose only "ERROR:".
fn strip_error(line: &str) -> String {
    let rest = line.strip_prefix("ERROR:").unwrap_or(line).trim();
    let Some((_, said)) = rest.strip_prefix('[').and_then(|r| r.split_once("] ")) else {
        return rest.to_string();
    };
    match said.split_once(": ") {
        Some((id, message)) if !id.contains(' ') => message.trim().to_string(),
        _ => said.trim().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(s: &str) -> Vec<String> {
        s.lines().map(String::from).collect()
    }

    #[test]
    fn progress_lines() {
        assert_eq!(
            parse_progress("SHPROG 1024 11299164 NA"),
            Some((1024, 11299164))
        );
        assert_eq!(parse_progress("SHPROG 1024 NA 2048.5"), Some((1024, 2048)));
        assert_eq!(parse_progress("SHPROG 1024 NA NA"), Some((1024, 0)));
        assert_eq!(parse_progress("[download] 50%"), None);
    }

    #[test]
    fn describes_a_video() {
        let info = json!({
            "title": "日本語練習", "duration": 698.0, "channel": "Yuki", "language": "ja",
            "formats": [
                { "format_id": "251", "ext": "webm", "vcodec": "none", "acodec": "opus" },
                { "format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2" }
            ],
            "subtitles": {
                "ja": [{ "ext": "vtt", "name": "Japanese" }],
                "en": [{ "ext": "vtt", "name": "English" }],
                "live_chat": [{ "ext": "json" }],
                "xx": []
            }
        });
        let d = describe(&info).unwrap();
        assert_eq!(d["title"], "日本語練習");
        assert_eq!(d["uploader"], "Yuki");
        assert_eq!(d["duration"], 698.0);
        let langs: Vec<&str> = d["subtitles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["lang"].as_str().unwrap())
            .collect();
        assert_eq!(langs, ["en", "ja"]);
        assert_eq!(d["subtitles"][1]["name"], "Japanese");
    }

    #[test]
    fn refuses_live_and_opus_only() {
        assert!(describe(&json!({ "is_live": true }))
            .unwrap_err()
            .contains("直播"));
        let opus = json!({ "formats": [{ "ext": "webm", "vcodec": "none", "acodec": "opus" }] });
        assert_eq!(describe(&opus).unwrap_err(), NO_M4A);
        // A muxed m4a video isn't an audio track.
        let muxed = json!({ "formats": [{ "ext": "m4a", "vcodec": "avc1", "acodec": "mp4a" }] });
        assert!(describe(&muxed).is_err());
    }

    #[test]
    fn explains_errors() {
        let (m, outdated) = explain(&lines(
            "WARNING: x\nERROR: [youtube] abc: Sign in to confirm you're not a bot.",
        ));
        assert!(m.contains("机器人") && !outdated);
        assert!(
            explain(&lines("ERROR: [youtube] abc: Private video. Sign in"))
                .0
                .contains("私享")
        );
        assert!(explain(&lines("ERROR: [youtube] abc: Video unavailable"))
            .0
            .contains("不存在"));
        assert!(explain(&lines(
            "ERROR: unable to download video data: HTTP Error 429: Too Many Requests"
        ))
        .0
        .contains("频繁"));
        let (m, outdated) = explain(&lines(
            "ERROR: [youtube] abc: Unable to extract initial player response",
        ));
        assert!(m.contains("更新") && outdated);
        assert_eq!(
            explain(&lines("ERROR: [youtube] abc: Something new happened")).0,
            "yt-dlp：Something new happened"
        );
        assert_eq!(explain(&[]).0, "下载失败");
    }

    #[test]
    fn strips_error_prefixes() {
        assert_eq!(strip_error("ERROR: [youtube] FFMoTdeD1aM: Boom"), "Boom");
        assert_eq!(strip_error("ERROR: Boom: with colon"), "Boom: with colon");
        assert_eq!(strip_error("plain line"), "plain line");
    }

    #[test]
    fn only_plain_language_codes() {
        assert!(plain_lang("ja") && plain_lang("zh-Hant") && plain_lang("en-US"));
        assert!(!plain_lang("") && !plain_lang(".*") && !plain_lang("ja,en"));
    }
}
