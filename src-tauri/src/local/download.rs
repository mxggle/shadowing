//! Resumable, verified model downloads: bytes go to `<file>.part` (kept across
//! cancels and restarts, resumed with an HTTP Range request), the SHA-256 is
//! checked, and only then is the file renamed into place.

use crate::ai::http::{client, describe_status};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub const CANCELLED: &str = "已取消";
/// Big files on slow lines: hours, not the 30 s used for API calls.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(6 * 3600);
/// A connection that stops sending (sleep, Wi-Fi drop without a reset) is given up after this.
const STALL: Duration = Duration::from_secs(60);
const STALLED: &str = "下载停住了（1 分钟没有收到数据），请检查网络后重试，会从断点继续";
const STALLED_EN: &str =
    "The download stalled (no data for 1 minute). Check your network and try again; it will pick up where it left off.";

pub fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    dest.with_file_name(name)
}

/// Bytes already on disk for an unfinished download.
pub fn partial_len(dest: &Path) -> u64 {
    fs::metadata(part_path(dest)).map(|m| m.len()).unwrap_or(0)
}

pub struct Spec<'a> {
    pub url: &'a str,
    pub dest: &'a Path,
    pub size: u64,
    pub sha256: &'a str,
}

/// `progress(done, total)` in bytes.
pub async fn download(
    spec: &Spec<'_>,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    if let Some(dir) = spec.dest.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let part = part_path(spec.dest);
    let mut have = partial_len(spec.dest);
    if have > spec.size {
        fs::remove_file(&part).map_err(|e| e.to_string())?;
        have = 0;
    }
    // Hash what is already there, then keep hashing as bytes arrive.
    let mut hasher = Sha256::new();
    if have > 0 {
        hash_file(&part, &mut hasher)?;
    }

    if have < spec.size {
        let mut req = client().get(spec.url).timeout(DOWNLOAD_TIMEOUT);
        if have > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let mut res = tokio::select! {
            r = req.send() => r.map_err(|e| net_error(&e))?,
            _ = cancelled(cancel) => return Err(cancelled_error()),
        };
        let status = res.status().as_u16();
        if status == 200 && have > 0 {
            // Server ignored the range: start over.
            have = 0;
            hasher = Sha256::new();
        } else if status != 200 && status != 206 {
            let body = res.text().await.unwrap_or_default();
            return Err(describe_status(status, &body, "Hugging Face"));
        }
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .append(have > 0)
            .truncate(have == 0)
            .open(&part)
            .map_err(|e| write_error(&e))?;
        progress(have, spec.size);
        // Cancel is checked while waiting for bytes too, not only when they arrive.
        loop {
            let next = tokio::select! {
                r = tokio::time::timeout(STALL, res.chunk()) => r,
                _ = cancelled(cancel) => return Err(cancelled_error()),
            };
            let Some(chunk) = next
                .map_err(|_| crate::i18n::pick(STALLED, STALLED_EN).to_string())?
                .map_err(|e| net_error(&e))?
            else {
                break;
            };
            file.write_all(&chunk).map_err(|e| write_error(&e))?;
            hasher.update(&chunk);
            have += chunk.len() as u64;
            progress(have, spec.size);
        }
        file.flush().map_err(|e| e.to_string())?;
    }

    let digest = format!("{:x}", hasher.finalize());
    if have != spec.size || digest != spec.sha256 {
        let _ = fs::remove_file(&part);
        return Err(crate::i18n::pick(
            "下载的文件不完整或已损坏，请重新下载",
            "The downloaded file is incomplete or damaged. Download it again.",
        )
        .into());
    }
    crate::store::replace(&part, spec.dest).map_err(|e| e.to_string())
}

fn hash_file(path: &Path, hasher: &mut Sha256) -> Result<(), String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut buf = vec![0; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(());
        }
        hasher.update(&buf[..n]);
    }
}

/// `CANCELLED` in the interface language (`transcribe::is_cancelled` knows both).
fn cancelled_error() -> String {
    crate::i18n::pick(CANCELLED, "Cancelled").into()
}

fn write_error(e: &std::io::Error) -> String {
    tr!(
        "无法写入模型文件：{e}",
        "Couldn't write the model file: {e}"
    )
}

fn net_error(e: &reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        crate::i18n::pick(
            "下载中断：无法连接到 Hugging Face，请检查网络后重试（已下载的部分会保留）",
            "The download stopped: couldn't reach Hugging Face. Check your network and try again (what's downloaded so far is kept).",
        )
        .into()
    } else {
        tr!(
            "下载中断：{e}（已下载的部分会保留）",
            "The download stopped: {e} (what's downloaded so far is kept)."
        )
    }
}

async fn cancelled(flag: &AtomicBool) {
    while !flag.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    const BODY: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

    fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    /// Serves BODY, honouring `Range: bytes=N-`; records each Range header seen.
    fn server() -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/model.bin", listener.local_addr().unwrap());
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let seen = ranges.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut range = None;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        range = Some(v.trim().trim_end_matches('-').parse::<usize>().unwrap());
                    }
                    if line == "\r\n" {
                        break;
                    }
                }
                seen.lock().unwrap().push(format!("{range:?}"));
                let (status, body) = match range {
                    Some(from) => ("206 Partial Content", &BODY[from..]),
                    None => ("200 OK", BODY),
                };
                let head = format!(
                    "HTTP/1.1 {status}\r\nconnection: close\r\ncontent-length: {}\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body);
            }
        });
        (url, ranges)
    }

    #[tokio::test]
    async fn resumes_from_the_partial_file_and_verifies() {
        let (url, ranges) = server();
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("models/m.bin");
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        fs::write(part_path(&dest), &BODY[..10]).unwrap();
        let spec = Spec {
            url: &url,
            dest: &dest,
            size: BODY.len() as u64,
            sha256: &sha(BODY),
        };
        let mut last = (0, 0);
        download(&spec, &AtomicBool::new(false), |d, t| last = (d, t))
            .await
            .unwrap();
        assert_eq!(fs::read(&dest).unwrap(), BODY);
        assert!(!part_path(&dest).exists());
        assert_eq!(*ranges.lock().unwrap(), ["Some(10)"]);
        assert_eq!(last, (36, 36));
    }

    #[tokio::test]
    async fn a_corrupt_download_is_thrown_away() {
        let (url, _) = server();
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("m.bin");
        let spec = Spec {
            url: &url,
            dest: &dest,
            size: BODY.len() as u64,
            sha256: &sha(b"something else"),
        };
        let err = download(&spec, &AtomicBool::new(false), |_, _| {})
            .await
            .unwrap_err();
        assert!(err.contains("损坏"), "{err}");
        assert!(!dest.exists() && !part_path(&dest).exists());
    }

    #[tokio::test]
    async fn cancelling_keeps_the_partial_file() {
        let (url, _) = server();
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("m.bin");
        fs::write(part_path(&dest), &BODY[..10]).unwrap();
        let spec = Spec {
            url: &url,
            dest: &dest,
            size: BODY.len() as u64,
            sha256: &sha(BODY),
        };
        let err = download(&spec, &AtomicBool::new(true), |_, _| {})
            .await
            .unwrap_err();
        assert_eq!(err, CANCELLED);
        assert!(!dest.exists());
        assert_eq!(fs::read(part_path(&dest)).unwrap(), &BODY[..10]);
    }

    /// The server sends a few bytes, then nothing (a dropped Wi-Fi without a reset).
    #[tokio::test]
    async fn cancel_works_while_the_connection_is_stalled() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/model.bin", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok_and(|n| n > 0) && line != "\r\n" {
                line.clear();
            }
            let head = format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n", BODY.len());
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&BODY[..10]);
            let _ = stream.flush();
            std::thread::sleep(Duration::from_secs(30));
        });
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("m.bin");
        let spec = Spec {
            url: &url,
            dest: &dest,
            size: BODY.len() as u64,
            sha256: &sha(BODY),
        };
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        // Cancelled once the first bytes are in and the connection has gone quiet
        // (not after a fixed time: under load the request itself can take longer).
        let got = Arc::new(Mutex::new(0u64));
        let seen = got.clone();
        let cancelled_at = Arc::new(Mutex::new(None));
        let at = cancelled_at.clone();
        std::thread::spawn(move || {
            while *seen.lock().unwrap() < 10 {
                std::thread::sleep(Duration::from_millis(10));
            }
            std::thread::sleep(Duration::from_millis(300));
            *at.lock().unwrap() = Some(std::time::Instant::now());
            flag.store(true, Ordering::Relaxed);
        });
        let err = download(&spec, &cancel, |done, _| *got.lock().unwrap() = done)
            .await
            .unwrap_err();
        assert_eq!(err, CANCELLED);
        let since = cancelled_at.lock().unwrap().expect("cancelled").elapsed();
        assert!(since < Duration::from_secs(2), "{since:?}");
        assert_eq!(fs::read(part_path(&dest)).unwrap(), &BODY[..10]);
    }
}
