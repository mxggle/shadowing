//! Tests for install.rs: a pack served from a local HTTP server.

use super::*;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

type Files = Arc<Mutex<HashMap<String, Vec<u8>>>>;

fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Serves `files` by path; anything else is a 404. Returns the base URL.
fn server(files: Files) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = stream.unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok_and(|n| n > 0) && line != "\r\n" {
                line.clear();
            }
            let path = first.split(' ').nth(1).unwrap_or("/").to_string();
            let path = percent_decode(&path);
            let body = files.lock().unwrap().get(&path).cloned();
            let (status, body) = match body {
                Some(b) => ("200 OK", b),
                None => ("404 Not Found", b"{}".to_vec()),
            };
            let head = format!(
                "HTTP/1.1 {status}\r\nconnection: close\r\ncontent-length: {}\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    base
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            out.push(u8::from_str_radix(&s[i + 1..i + 3], 16).unwrap());
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap()
}

struct Fixture {
    _dir: tempfile::TempDir,
    dirs: Dirs,
    files: Files,
    manifest: String,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path().canonicalize().unwrap();
    let dirs = Dirs {
        root: base.join("素材库"),
        transcripts: base.join("transcripts"),
        explanations: base.join("explanations"),
    };
    let files: Files = Arc::default();
    let manifest = format!("{}/packs/manifest.json", server(files.clone()));
    Fixture {
        _dir: dir,
        dirs,
        files,
        manifest,
    }
}

/// Publishes version `version` of a pack with `tracks` audio files; returns its listing.
fn publish(f: &Fixture, version: u32, tracks: &[&str]) -> Listing {
    let mut files = f.files.lock().unwrap();
    let mut entries = Vec::new();
    let mut size = 0;
    for (i, name) in tracks.iter().enumerate() {
        let audio = format!("audio {name} v{version}").into_bytes();
        let file = format!("{:02}.mp3", i + 1);
        entries.push(serde_json::json!({
            "name": name, "file": file, "size": audio.len(), "sha256": sha(&audio),
            "speakers": ["店員", "客"],
            "sentences": [
                {"start": 0.3, "end": 1.5, "text": "いらっしゃいませ。", "speaker": 0},
                {"start": 2.0, "end": 3.0, "text": format!("{name}、ください。"), "speaker": 1}
            ],
            "explanations": [
                {"index": 0, "translation": "欢迎光临。", "words": [], "points": []},
                {"index": 1, "translation": "请给我这个。", "words": [{"word": "ください", "reading": "", "meaning": "请给我"}], "points": []}
            ]
        }));
        size += audio.len() as u64;
        files.insert(format!("/packs/tokyo/{version}/{file}"), audio);
    }
    let pack = serde_json::json!({
        "id": "tokyo", "version": version, "title": "东京日常会话", "folder": "东京日常会话",
        "tracks": entries
    })
    .to_string()
    .into_bytes();
    let listing = Listing {
        id: "tokyo".into(),
        version,
        title: "东京日常会话".into(),
        description: String::new(),
        language: "ja".into(),
        level: "N5–N4".into(),
        voice: "ai".into(),
        tracks: tracks.len() as u32,
        duration: 3.0 * tracks.len() as f64,
        size: size + pack.len() as u64,
        url: format!("tokyo/{version}/pack.json"),
        sha256: sha(&pack),
        bytes: pack.len() as u64,
    };
    files.insert(format!("/packs/tokyo/{version}/pack.json"), pack);
    listing
}

async fn install_now(f: &Fixture, listing: &Listing) -> Result<Installed, String> {
    install(
        &f.dirs,
        &f.manifest,
        listing,
        &AtomicBool::new(false),
        |_, _| {},
    )
    .await
}

fn key(f: &Fixture, file: &str) -> String {
    f.dirs
        .root
        .join("东京日常会话")
        .join(file)
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

#[tokio::test]
async fn installs_audio_subtitles_speakers_and_explanations() {
    let f = fixture();
    let listing = publish(&f, 1, &["01 コンビニで", "02 駅で"]);
    let mut seen = Vec::new();
    let pack = install(
        &f.dirs,
        &f.manifest,
        &listing,
        &AtomicBool::new(false),
        |d, t| seen.push((d, t)),
    )
    .await
    .unwrap();
    assert_eq!(pack.files, ["01 コンビニで.mp3", "02 駅で.mp3"]);
    assert_eq!(seen.last(), Some(&(listing.size, listing.size)));
    assert!(seen.windows(2).all(|w| w[0].0 <= w[1].0), "{seen:?}");

    let tracks = crate::library::scan(&f.dirs.root).unwrap().tracks;
    let names: Vec<_> = tracks
        .iter()
        .map(|t| format!("{}/{}", t.rel_dir, t.name))
        .collect();
    assert_eq!(
        names,
        ["东京日常会话/01 コンビニで", "东京日常会话/02 駅で"]
    );

    let audio = key(&f, "02 駅で.mp3");
    let transcript = transcript::load(&f.dirs.transcripts, &audio).unwrap();
    assert_eq!(transcript.speakers, ["店員", "客"]);
    assert_eq!(transcript.sentences[1].text, "02 駅で、ください。");
    assert_eq!(transcript.sentences[1].speaker, Some(1));
    assert_eq!(transcript.sections.len(), 1);
    let notes = saved::load(&f.dirs.explanations, &audio, &transcript.sentences);
    assert_eq!(notes.len(), 2);
    assert_eq!(notes[1].explanation.translation, "请给我这个。");
    assert_eq!(notes[1].explanation.source, SOURCE);

    assert_eq!(installed(&f.dirs.root), [pack]);
    // The staging folder is gone; nothing hidden shows up as a track.
    assert!(!f.dirs.root.join(".downloading/tokyo").exists());
}

#[tokio::test]
async fn a_newer_version_replaces_the_old_one_and_its_notes() {
    let f = fixture();
    install_now(&f, &publish(&f, 1, &["01 コンビニで", "02 駅で"]))
        .await
        .unwrap();
    let old_audio = key(&f, "02 駅で.mp3");
    let v2 = publish(&f, 2, &["01 コンビニで"]);
    install_now(&f, &v2).await.unwrap();
    let packs = installed(&f.dirs.root);
    assert_eq!((packs.len(), packs[0].version), (1, 2));
    let tracks = crate::library::scan(&f.dirs.root).unwrap().tracks;
    assert_eq!(tracks.len(), 1);
    assert_eq!(
        std::fs::read(&tracks[0].path).unwrap(),
        "audio 01 コンビニで v2".as_bytes()
    );
    assert!(transcript::load(&f.dirs.transcripts, &old_audio).is_none());
}

#[tokio::test]
async fn a_corrupt_file_installs_nothing_and_remove_clears_everything() {
    let f = fixture();
    let listing = publish(&f, 1, &["01 コンビニで"]);
    f.files
        .lock()
        .unwrap()
        .insert("/packs/tokyo/1/01.mp3".into(), b"tampered".to_vec());
    let err = install_now(&f, &listing).await.unwrap_err();
    assert!(err.contains("损坏") || err.contains("不完整"), "{err}");
    assert!(installed(&f.dirs.root).is_empty());
    assert!(crate::library::scan(&f.dirs.root)
        .unwrap()
        .tracks
        .is_empty());

    let listing = publish(&f, 1, &["01 コンビニで"]);
    let pack = install_now(&f, &listing).await.unwrap();
    let audio = key(&f, "01 コンビニで.mp3");
    remove(&f.dirs, &pack).unwrap();
    assert!(installed(&f.dirs.root).is_empty());
    assert!(!f.dirs.root.join("东京日常会话").exists());
    assert!(transcript::load(&f.dirs.transcripts, &audio).is_none());
    assert!(!transcript::stored_path(&f.dirs.explanations, &audio).exists());
}

#[tokio::test]
async fn a_tampered_pack_file_is_refused() {
    let f = fixture();
    let listing = publish(&f, 1, &["01 コンビニで"]);
    let wrong = Listing {
        sha256: sha(b"other"),
        ..listing
    };
    assert!(install_now(&f, &wrong).await.is_err());
    assert!(installed(&f.dirs.root).is_empty());
}
