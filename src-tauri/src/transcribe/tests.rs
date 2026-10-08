//! The whole job (decode → cut → upload → sentences) against a fake
//! OpenAI-compatible server on localhost.

use super::*;
use crate::ai::providers;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::AtomicBool;

/// Answers each request with `reply(n)` (n = 0, 1, …) and records the raw requests.
fn fake_server(reply: fn(usize) -> String) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        for (n, stream) in listener.incoming().enumerate() {
            let mut stream = stream.unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                head.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let len: usize = head
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse().unwrap())
                })
                .expect("multipart bodies have a length");
            let mut body = vec![0; len];
            reader.read_exact(&mut body).unwrap();
            log.lock()
                .unwrap()
                .push(format!("{head}{}", String::from_utf8_lossy(&body)));
            let json = reply(n);
            let res = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: {}\r\n\r\n{json}",
                json.len()
            );
            stream.write_all(res.as_bytes()).unwrap();
        }
    });
    (url, seen)
}

/// 9 s file: tone 0–3.5 s, silence 3.5–4.5 s, tone 4.5–9 s (44.1 kHz stereo).
fn speech_like_wav(dir: &Path) -> std::path::PathBuf {
    let path = dir.join("talk.wav");
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: 44_100,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(&path, spec).unwrap();
    for i in 0..44_100 * 9 {
        let t = i as f32 / 44_100.0;
        let v = if (3.5..4.5).contains(&t) {
            0
        } else {
            ((t * 300.0 * std::f32::consts::TAU).sin() * 9000.0) as i16
        };
        w.write_sample(v).unwrap();
        w.write_sample(v).unwrap();
    }
    w.finalize().unwrap();
    path
}

fn target(url: &str) -> Target {
    Target {
        preset: providers::find("custom-transcribe").unwrap(),
        base_url: url.to_string(),
        key: Some("sk-test".into()),
    }
}

const PLAN: ChunkPlan = ChunkPlan {
    max_secs: 4.0,
    search_secs: 1.5,
};

#[test]
fn transcribes_in_pieces_cut_at_pauses() {
    let (url, seen) = fake_server(|n| {
        format!(
            r#"{{"text":"Piece {n}.","segments":[{{"start":0.5,"end":1.5,"text":" Piece {n}.","avg_logprob":-0.1,"no_speech_prob":0.01}}],"words":[{{"word":"Piece","start":0.5,"end":1.0}},{{"word":"{n}","start":1.0,"end":1.5}}]}}"#
        )
    });
    let dir = tempfile::tempdir().unwrap();
    let audio = speech_like_wav(dir.path());
    let target = target(&url);
    let job = Job {
        audio: &audio,
        language: Some("en"),
        plan: PLAN,
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let ticks = Arc::new(Mutex::new(Vec::new()));
    let log = ticks.clone();
    let progress = Arc::new(move |done, total| log.lock().unwrap().push((done, total)));
    let sentences = run(&job, &mut cloud::Cloud::new(&target, "whisper-x"), progress).unwrap();

    let requests = seen.lock().unwrap().clone();
    assert_eq!(requests.len(), 3, "9 s in pieces of at most 4 s");
    let first = &requests[0];
    assert!(
        first.starts_with("POST /audio/transcriptions "),
        "{first:.80}"
    );
    assert!(first
        .to_ascii_lowercase()
        .contains("authorization: bearer sk-test"));
    for part in [
        "whisper-x",
        "verbose_json",
        "timestamp_granularities[]",
        "segment",
        "audio/wav",
    ] {
        assert!(first.contains(part), "missing {part}");
    }
    assert!(first.contains("name=\"language\"\r\n\r\nen"));
    assert!(first.contains("name=\"prompt\"\r\n\r\nHello, everyone."));
    assert!(
        requests[1].contains("name=\"prompt\"\r\n\r\nPiece 0."),
        "context from the previous piece"
    );

    // The first cut lands in the pause (3.5–4.0 s inside the search window).
    let texts: Vec<_> = sentences.iter().map(|s| s.text.as_str()).collect();
    assert_eq!(texts, ["Piece 0.", "Piece 1.", "Piece 2."]);
    let second_start = sentences[1].start - 0.5;
    assert!(
        (3.5..=4.0).contains(&second_start),
        "piece 2 starts at {second_start}"
    );
    assert!(sentences.windows(2).all(|w| w[0].end <= w[1].start));
    let ticks = ticks.lock().unwrap();
    let (done, total) = *ticks.last().unwrap();
    assert!(
        (done - 9.0).abs() < 0.01 && (total - 9.0).abs() < 0.01,
        "{ticks:?}"
    );
}

#[test]
fn cancelled_before_upload_sends_nothing() {
    let (url, seen) = fake_server(|_| "{}".into());
    let dir = tempfile::tempdir().unwrap();
    let audio = speech_like_wav(dir.path());
    let target = target(&url);
    let job = Job {
        audio: &audio,
        language: None,
        plan: PLAN,
        cancel: Arc::new(AtomicBool::new(true)),
    };
    let err = run(
        &job,
        &mut cloud::Cloud::new(&target, "m"),
        Arc::new(|_, _| {}),
    )
    .unwrap_err();
    assert_eq!(err, CANCELLED);
    assert!(seen.lock().unwrap().is_empty());
}

#[test]
fn a_reply_without_segments_means_no_speech() {
    let (url, _) = fake_server(|_| r#"{"text":"plain json only"}"#.into());
    let dir = tempfile::tempdir().unwrap();
    let audio = speech_like_wav(dir.path());
    let target = target(&url);
    let job = Job {
        audio: &audio,
        language: None,
        plan: ChunkPlan {
            max_secs: 20.0,
            search_secs: 2.0,
        },
        cancel: Arc::new(AtomicBool::new(false)),
    };
    // A reply with no segments parses, but yields no sentences.
    let err = run(
        &job,
        &mut cloud::Cloud::new(&target, "m"),
        Arc::new(|_, _| {}),
    )
    .unwrap_err();
    assert_eq!(err, "没有识别出语音");
}
