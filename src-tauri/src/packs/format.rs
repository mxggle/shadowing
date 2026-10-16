//! What the 素材库 server publishes: `manifest.json` lists the packs, and each
//! pack's own file names its audio (with sizes and SHA-256), the sentences with
//! their speakers, and an explanation for each sentence. Everything read from
//! the network is checked here before a byte of it touches the disk.

use crate::explain::Explanation;
use crate::transcript::Sentence;
use reqwest::Url;
use serde::{Deserialize, Serialize};

/// Format versions this build understands.
pub const MANIFEST_VERSION: u32 = 1;
const MAX_TRACKS: usize = 200;
const MAX_FILE: u64 = 500_000_000;
const MAX_NAME: usize = 80;

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub packs: Vec<Listing>,
}

/// One pack as the catalog shows it, before it is downloaded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub id: String,
    /// Goes up when the pack changes; an older copy on disk can then be updated.
    pub version: u32,
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// "ja", "en"…
    pub language: String,
    /// "N5–N4"
    #[serde(default)]
    pub level: String,
    /// "ai": voiced by speech synthesis (shown as AI 配音).
    #[serde(default)]
    pub voice: String,
    pub tracks: u32,
    /// Seconds of audio in all.
    pub duration: f64,
    /// Bytes to download: the pack file and all its audio.
    pub size: u64,
    /// The pack file, relative to the manifest.
    pub url: String,
    pub sha256: String,
    /// Size of the pack file.
    pub bytes: u64,
}

/// The pack file.
#[derive(Debug, Clone, Deserialize)]
pub struct Pack {
    pub id: String,
    pub version: u32,
    pub title: String,
    /// The folder it goes in, shown as a group in the library.
    pub folder: String,
    pub tracks: Vec<PackTrack>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PackTrack {
    /// Shown in the library ("01 コンビニで"); the file is saved under it.
    pub name: String,
    /// Relative to the pack file.
    pub file: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub speakers: Vec<String>,
    pub sentences: Vec<Sentence>,
    #[serde(default)]
    pub explanations: Vec<Note>,
}

/// The explanation of sentence `index`, written for the pack.
#[derive(Debug, Clone, Deserialize)]
pub struct Note {
    pub index: usize,
    #[serde(flatten)]
    pub explanation: Explanation,
}

impl PackTrack {
    /// The file name it is saved under: its name and the audio's extension.
    pub fn file_name(&self) -> String {
        let ext = self.file.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
        format!("{}.{}", self.name, ext.to_ascii_lowercase())
    }
}

/// A file or folder name from the server that is safe to create inside the packs folder.
pub fn safe_name(name: &str) -> bool {
    let n = name.chars().count();
    (1..=MAX_NAME).contains(&n)
        && name.trim() == name
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '\0'])
        && !name.chars().any(char::is_control)
}

fn sha256_ok(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn id_ok(id: &str) -> bool {
    (1..=40).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `relative` against `base`; only web addresses.
pub fn resolve(base: &str, relative: &str) -> Result<String, String> {
    let url = Url::parse(base)
        .and_then(|b| b.join(relative))
        .map_err(|_| "素材库的地址不对".to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(url.into()),
        _ => Err("素材库的地址不对".into()),
    }
}

pub fn parse_manifest(text: &str) -> Result<Vec<Listing>, String> {
    let manifest: Manifest =
        serde_json::from_str(text).map_err(|_| "素材库的列表读不出来，请稍后再试".to_string())?;
    if manifest.version > MANIFEST_VERSION {
        return Err("素材库有了新格式，请先更新应用".into());
    }
    // A listing this build can't use is left out rather than failing the whole list.
    Ok(manifest
        .packs
        .into_iter()
        .filter(|p| {
            id_ok(&p.id)
                && sha256_ok(&p.sha256)
                && !p.title.trim().is_empty()
                && p.bytes > 0
                && p.bytes <= MAX_FILE
                && p.duration.is_finite()
        })
        .collect())
}

/// The pack file, checked against the listing it was downloaded for.
pub fn parse_pack(text: &str, listing: &Listing) -> Result<Pack, String> {
    let bad = |why: &str| {
        format!(
            "素材包「{}」的内容有问题（{why}），请稍后再试",
            listing.title
        )
    };
    let pack: Pack = serde_json::from_str(text).map_err(|_| bad("读不出来"))?;
    if pack.id != listing.id || pack.version != listing.version {
        return Err(bad("版本对不上"));
    }
    if !safe_name(&pack.folder) {
        return Err(bad("文件夹名"));
    }
    if pack.tracks.is_empty() || pack.tracks.len() > MAX_TRACKS {
        return Err(bad("没有音频"));
    }
    let mut names = std::collections::HashSet::new();
    for track in &pack.tracks {
        let file_name = track.file_name();
        if !safe_name(&track.name)
            || !safe_name(&file_name)
            || !crate::library::is_audio(std::path::Path::new(&file_name))
            || !names.insert(file_name.to_lowercase())
        {
            return Err(bad("音频文件名"));
        }
        if !sha256_ok(&track.sha256) || track.size == 0 || track.size > MAX_FILE {
            return Err(bad("音频大小"));
        }
        sentences_ok(track).map_err(&bad)?;
    }
    Ok(pack)
}

fn sentences_ok(track: &PackTrack) -> Result<(), &'static str> {
    let s = &track.sentences;
    if s.is_empty() {
        return Err("没有字幕");
    }
    let times_ok = s
        .iter()
        .all(|x| x.start.is_finite() && x.end.is_finite() && x.start >= 0.0 && x.start < x.end)
        && s.windows(2).all(|w| w[0].start <= w[1].start);
    if !times_ok || s.iter().any(|x| x.text.trim().is_empty()) {
        return Err("字幕的时间");
    }
    let voices = track.speakers.len();
    if voices > 0
        && s.iter()
            .any(|x| x.speaker.is_some_and(|v| v as usize >= voices))
    {
        return Err("说话人");
    }
    if track.explanations.iter().any(|n| n.index >= s.len()) {
        return Err("解释");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn listing() -> Listing {
        Listing {
            id: "tokyo-daily".into(),
            version: 2,
            title: "东京日常会话".into(),
            description: String::new(),
            language: "ja".into(),
            level: "N5–N4".into(),
            voice: "ai".into(),
            tracks: 1,
            duration: 40.0,
            size: 1000,
            url: "tokyo-daily/2/pack.json".into(),
            sha256: SHA.into(),
            bytes: 100,
        }
    }

    fn pack_json(folder: &str, name: &str, file: &str) -> String {
        serde_json::json!({
            "id": "tokyo-daily", "version": 2, "title": "东京日常会话", "folder": folder,
            "tracks": [{
                "name": name, "file": file, "size": 10, "sha256": SHA,
                "speakers": ["店員", "客"],
                "sentences": [
                    {"start": 0.3, "end": 1.5, "text": "いらっしゃいませ。", "speaker": 0},
                    {"start": 2.0, "end": 3.0, "text": "これ、ください。", "speaker": 1}
                ],
                "explanations": [{"index": 1, "translation": "请给我这个。", "words": [], "points": []}]
            }]
        })
        .to_string()
    }

    #[test]
    fn names_that_could_leave_the_folder_are_refused() {
        for ok in ["东京日常会话", "01 コンビニで", "Unit 2 – At the station"] {
            assert!(safe_name(ok), "{ok}");
        }
        for bad in [
            "", "..", ".hidden", "a/b", "a\\b", " lead", "trail ", "a:b", "x\u{7}",
        ] {
            assert!(!safe_name(bad), "{bad:?}");
        }
        assert!(!safe_name(&"あ".repeat(81)));
    }

    #[test]
    fn a_good_pack_parses_and_keeps_its_notes() {
        let pack = parse_pack(
            &pack_json("东京日常会话", "01 コンビニで", "01.MP3"),
            &listing(),
        )
        .unwrap();
        let track = &pack.tracks[0];
        assert_eq!(track.file_name(), "01 コンビニで.mp3");
        assert_eq!(track.speakers, ["店員", "客"]);
        assert_eq!(track.sentences[1].speaker, Some(1));
        assert_eq!(
            track.explanations[0].explanation.translation,
            "请给我这个。"
        );
    }

    #[test]
    fn a_pack_with_unsafe_or_mismatched_parts_is_refused() {
        let l = listing();
        assert!(parse_pack(&pack_json("../escape", "01", "01.mp3"), &l).is_err());
        assert!(parse_pack(&pack_json("ok", "../../x", "01.mp3"), &l).is_err());
        assert!(parse_pack(&pack_json("ok", "01", "01.exe"), &l).is_err());
        let older = Listing {
            version: 1,
            ..listing()
        };
        assert!(parse_pack(&pack_json("ok", "01", "01.mp3"), &older)
            .unwrap_err()
            .contains("版本"));
        let bad_speaker =
            pack_json("ok", "01", "01.mp3").replace(r#""speaker":1"#, r#""speaker":5"#);
        assert!(parse_pack(&bad_speaker, &l).unwrap_err().contains("说话人"));
        let bad_note = pack_json("ok", "01", "01.mp3").replace(r#""index":1"#, r#""index":9"#);
        assert!(parse_pack(&bad_note, &l).unwrap_err().contains("解释"));
    }

    #[test]
    fn manifest_skips_listings_it_cannot_use_and_refuses_a_newer_format() {
        let good = serde_json::to_value(listing()).unwrap();
        let mut bad = good.clone();
        bad["id"] = "../x".into();
        let text = serde_json::json!({"version": 1, "packs": [good, bad]}).to_string();
        let packs = parse_manifest(&text).unwrap();
        assert_eq!(packs.len(), 1);
        assert_eq!(packs[0].title, "东京日常会话");
        let newer = serde_json::json!({"version": 9, "packs": []}).to_string();
        assert!(parse_manifest(&newer).unwrap_err().contains("更新应用"));
        assert!(parse_manifest("<html>").is_err());
    }

    #[test]
    fn files_resolve_next_to_the_manifest_and_only_on_the_web() {
        let base = "https://shadowing.nihongo.day/packs/manifest.json";
        assert_eq!(
            resolve(base, "tokyo-daily/2/pack.json").unwrap(),
            "https://shadowing.nihongo.day/packs/tokyo-daily/2/pack.json"
        );
        let pack = "https://shadowing.nihongo.day/packs/tokyo-daily/2/pack.json";
        assert_eq!(
            resolve(pack, "01.mp3").unwrap(),
            "https://shadowing.nihongo.day/packs/tokyo-daily/2/01.mp3"
        );
        assert!(resolve(base, "file:///etc/passwd").is_err());
    }
}
