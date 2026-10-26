//! The picture too (声音 + 画面): which heights a video comes in, how yt-dlp is
//! asked for them, and putting the downloaded picture and sound in one mp4
//! (`mux`: no ffmpeg, no re-encoding). The picture is H.264 in mp4 (`avc1`), which
//! both the Mac's and Windows' webviews play; the sound the same m4a as without it.

use crate::{mux, progress, Ctx, CANCELLED};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Heights offered: lower is too blurry to watch someone speak, higher too big to be worth it.
const LOWEST: u64 = 360;
const HIGHEST: u64 = 1080;

/// A picture-only H.264 mp4 over plain HTTPS (the DASH files the merge was tried on, not m3u8).
fn is_picture(f: &Value) -> bool {
    f["ext"] == "mp4"
        && f["acodec"] == "none"
        && f["vcodec"].as_str().is_some_and(|v| v.starts_with("avc1"))
        && f["protocol"] == "https"
        && f["height"].is_u64()
}

/// The m4a sound yt-dlp picks (`bestaudio[ext=m4a]`): the one with the highest bitrate.
fn sound(info: &Value) -> Option<&Value> {
    info["formats"]
        .as_array()?
        .iter()
        .filter(|f| f["ext"] == "m4a" && f["vcodec"] == "none" && f["acodec"] != "none")
        .max_by(|a, b| rate(a).total_cmp(&rate(b)))
}

fn rate(f: &Value) -> f64 {
    f["tbr"]
        .as_f64()
        .or(f["abr"].as_f64())
        .or(f["vbr"].as_f64())
        .unwrap_or(0.0)
}

fn size(f: &Value) -> Option<u64> {
    f["filesize"].as_u64().or(f["filesize_approx"].as_u64())
}

/// For the confirmation (`Resolved` in the app): `videos`, the heights the picture comes
/// in with about how big each download is (sound included), and `audioSize`.
pub fn choices(info: &Value) -> (Value, Value) {
    let audio = sound(info).and_then(size);
    // The best picture at each height, as yt-dlp's `bestvideo[height<=H]` would pick.
    let mut best: BTreeMap<u64, &Value> = BTreeMap::new();
    for f in info["formats"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| is_picture(f))
    {
        let h = f["height"].as_u64().unwrap_or(0);
        if (LOWEST..=HIGHEST).contains(&h) && best.get(&h).is_none_or(|b| rate(f) > rate(b)) {
            best.insert(h, f);
        }
    }
    let videos: Vec<Value> = best
        .into_iter()
        .map(|(height, f)| json!({ "height": height, "size": size(f).map(|v| v + audio.unwrap_or(0)) }))
        .collect();
    (json!(videos), json!(audio))
}

/// yt-dlp's `-f`: the picture at most `height` tall, and the sound, each its own file.
pub fn formats(height: u64) -> String {
    format!("bestvideo[ext=mp4][vcodec^=avc1][height<={height}][protocol=https],bestaudio[ext=m4a]")
}

/// After the download: the picture (`.mp4`) and the sound (`.m4a`) in `out`, merged into
/// `video.mp4`; the two are removed. Its name in `out`, for the app.
pub fn merge(ctx: &Ctx, out: &Path) -> Result<String, String> {
    let (mut picture, mut sound) = (None, None);
    for entry in std::fs::read_dir(out).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default();
        match path.extension().and_then(|e| e.to_str()) {
            Some("mp4") if stem.starts_with("part.") => picture = Some(path),
            Some("m4a") if stem.starts_with("part.") => sound = Some(path),
            _ => {}
        }
    }
    let (Some(picture), Some(sound)) = (picture, sound) else {
        return Err("没有下载到画面和声音".into());
    };
    let merged: PathBuf = out.join("video.mp4");
    mux::merge(&picture, &sound, &merged, &mut |done, total| {
        if ctx.cancelled() {
            return Err(CANCELLED.into());
        }
        progress("合成视频", done, total);
        Ok(())
    })?;
    let _ = std::fs::remove_file(&picture);
    let _ = std::fs::remove_file(&sound);
    Ok("video.mp4".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(id: &str, height: u64, tbr: f64, size: Option<u64>) -> Value {
        json!({ "format_id": id, "ext": "mp4", "vcodec": "avc1.4d401f", "acodec": "none", "protocol": "https",
                "height": height, "tbr": tbr, "filesize": size })
    }

    #[test]
    fn offers_each_height_with_its_best_picture_and_the_sound() {
        let info = json!({ "formats": [
            { "format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "abr": 129.5, "filesize": 11_000_000 },
            { "format_id": "139", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.5", "abr": 48.0, "filesize": 4_000_000 },
            picture("134", 360, 300.0, Some(20_000_000)),
            picture("136", 720, 1200.0, Some(80_000_000)),
            picture("136x", 720, 900.0, Some(60_000_000)),
            picture("160", 144, 80.0, Some(5_000_000)),
            picture("137", 1080, 2500.0, None),
            picture("401", 2160, 9000.0, Some(900_000_000)),
            { "format_id": "247", "ext": "webm", "vcodec": "vp9", "acodec": "none", "protocol": "https", "height": 720 },
            { "format_id": "95", "ext": "mp4", "vcodec": "avc1.4d401f", "acodec": "none", "protocol": "m3u8_native", "height": 480 },
            { "format_id": "18", "ext": "mp4", "vcodec": "avc1.42001E", "acodec": "mp4a.40.2", "protocol": "https", "height": 360 }
        ]});
        let (videos, audio) = choices(&info);
        assert_eq!(audio, 11_000_000);
        assert_eq!(
            videos,
            json!([
                { "height": 360, "size": 31_000_000 },
                { "height": 720, "size": 91_000_000 },
                { "height": 1080, "size": null }
            ])
        );
    }

    #[test]
    fn nothing_offered_without_an_h264_picture() {
        let info = json!({ "formats": [
            { "format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2" },
            { "format_id": "247", "ext": "webm", "vcodec": "vp9", "acodec": "none", "protocol": "https", "height": 720 }
        ]});
        assert_eq!(choices(&info).0, json!([]));
    }

    #[test]
    fn asks_for_the_picture_and_the_sound_as_two_files() {
        assert_eq!(
            formats(720),
            "bestvideo[ext=mp4][vcodec^=avc1][height<=720][protocol=https],bestaudio[ext=m4a]"
        );
    }
}
