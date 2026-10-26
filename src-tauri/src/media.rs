//! Serves a video's file to the webview's `<video>`, which shows the picture (muted;
//! the engine plays the sound). Over http://127.0.0.1, not a custom scheme: WebKit
//! fetches a custom scheme's video a frame at a time, each a round trip through the
//! app, and playback fell behind real time; over HTTP its media stack streams.
//!
//! Only this app can use it: it listens on 127.0.0.1 alone, every address carries a
//! token made fresh at each launch, and only what `allow` passes is served (videos in
//! the approved folder or the samples, see lib.rs). A video can be gigabytes: it is
//! streamed in pieces, never read whole.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

/// Where the webview finds videos: `{base}/{the path, as encodeURIComponent writes it}`.
pub struct Server {
    pub base: String,
}

type Allow = dyn Fn(&Path) -> Option<PathBuf> + Send + Sync;

const CHUNK: usize = 64 * 1024;
const MAX_HEAD: usize = 16 * 1024;

pub fn start(
    allow: impl Fn(&Path) -> Option<PathBuf> + Send + Sync + 'static,
) -> io::Result<Server> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| io::Error::other(e.to_string()))?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let site = Arc::new(Site {
        token: token.clone(),
        host: format!("127.0.0.1:{port}"),
        allow: Box::new(allow),
    });
    thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            let site = site.clone();
            thread::spawn(move || {
                // A webview that has seen enough closes the connection mid-stream.
                let _ = site.answer(conn);
            });
        }
    });
    Ok(Server {
        base: format!("http://127.0.0.1:{port}/{token}"),
    })
}

struct Site {
    token: String,
    /// What the webview's requests say they're for; anything else (a page elsewhere
    /// using a name that points here) is refused.
    host: String,
    allow: Box<Allow>,
}

impl Site {
    fn answer(&self, mut conn: TcpStream) -> io::Result<()> {
        conn.set_read_timeout(Some(Duration::from_secs(10)))?;
        let Some(req) = read_head(&mut conn)?.as_deref().and_then(Head::parse) else {
            return reply(&mut conn, 400, &[]);
        };
        if req.host != self.host {
            return reply(&mut conn, 403, &[]);
        }
        if req.method != "GET" && req.method != "HEAD" {
            return reply(&mut conn, 405, &[]);
        }
        let path = req
            .target
            .strip_prefix('/')
            .and_then(|t| t.strip_prefix(self.token.as_str()))
            .and_then(|t| t.strip_prefix('/'))
            .and_then(decode);
        let Some(path) = path else {
            return reply(&mut conn, 404, &[]);
        };
        let Some(file) = (self.allow)(Path::new(&path)) else {
            return reply(&mut conn, 403, &[]);
        };
        let Ok(mut f) = File::open(&file) else {
            return reply(&mut conn, 404, &[]);
        };
        let len = f.metadata()?.len();
        let Some((start, end)) = range(req.range.as_deref(), len) else {
            return reply(
                &mut conn,
                416,
                &[("Content-Range", format!("bytes */{len}"))],
            );
        };
        let n = end + 1 - start;
        let mut headers = vec![
            ("Content-Type", mime(&file).to_string()),
            ("Accept-Ranges", "bytes".to_string()),
            ("Content-Length", n.to_string()),
            ("Cache-Control", "no-store".to_string()),
        ];
        let code = if req.range.is_some() {
            headers.push(("Content-Range", format!("bytes {start}-{end}/{len}")));
            206
        } else {
            200
        };
        reply(&mut conn, code, &headers)?;
        if req.method == "GET" {
            f.seek(SeekFrom::Start(start))?;
            let mut rest = f.take(n);
            let mut buf = vec![0u8; CHUNK];
            loop {
                let got = rest.read(&mut buf)?;
                if got == 0 {
                    break;
                }
                conn.write_all(&buf[..got])?;
            }
        }
        conn.flush()
    }
}

/// The request line and headers (the body, if any, is never needed). None when the
/// connection closed first.
fn read_head(conn: &mut TcpStream) -> io::Result<Option<String>> {
    let mut head = Vec::new();
    let mut buf = [0u8; 2048];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        let got = conn.read(&mut buf)?;
        if got == 0 || head.len() + got > MAX_HEAD {
            return Ok(None);
        }
        head.extend_from_slice(&buf[..got]);
    }
    Ok(String::from_utf8(head).ok())
}

fn reply(conn: &mut TcpStream, code: u16, headers: &[(&str, String)]) -> io::Result<()> {
    let reason = match code {
        200 => "OK",
        206 => "Partial Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Range Not Satisfiable",
    };
    let mut out = format!("HTTP/1.1 {code} {reason}\r\nConnection: close\r\n");
    for (name, value) in headers {
        out.push_str(&format!("{name}: {value}\r\n"));
    }
    if code >= 400 {
        out.push_str("Content-Length: 0\r\n");
    }
    out.push_str("\r\n");
    conn.write_all(out.as_bytes())
}

#[derive(Debug, PartialEq)]
struct Head {
    method: String,
    target: String,
    host: String,
    range: Option<String>,
}

impl Head {
    fn parse(text: &str) -> Option<Head> {
        let mut lines = text.split("\r\n");
        let mut first = lines.next()?.split(' ');
        let (method, target) = (first.next()?.to_string(), first.next()?.to_string());
        let (mut host, mut range) = (String::new(), None);
        for line in lines {
            let Some((name, value)) = line.split_once(':') else {
                continue;
            };
            match name.trim().to_ascii_lowercase().as_str() {
                "host" => host = value.trim().to_string(),
                "range" => range = Some(value.trim().to_string()),
                _ => {}
            }
        }
        Some(Head {
            method,
            target,
            host,
            range,
        })
    }
}

fn mime(file: &Path) -> &'static str {
    match file
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mov") => "video/quicktime",
        _ => "video/mp4",
    }
}

/// The bytes to send, first and last (inclusive), for a `Range` header (the first
/// range of several; none = the whole file) on a file of `len` bytes. None when the
/// range lies outside the file (an empty file has none).
fn range(header: Option<&str>, len: u64) -> Option<(u64, u64)> {
    let last = len.checked_sub(1)?;
    let (start, end) = match header {
        None => (0, last),
        Some(h) => {
            let spec = h.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
            let (a, b) = spec.split_once('-')?;
            match (a.trim(), b.trim()) {
                ("", suffix) => (len - suffix.parse::<u64>().ok()?.min(len), last),
                (a, "") => (a.parse().ok()?, last),
                (a, b) => (a.parse().ok()?, b.parse::<u64>().ok()?.min(last)),
            }
        }
    };
    (start <= end).then_some((start, end))
}

/// Undoes `encodeURIComponent`.
fn decode(s: &str) -> Option<String> {
    let mut out = Vec::with_capacity(s.len());
    let mut bytes = s.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let hex = [bytes.next()?, bytes.next()?];
            out.push(u8::from_str_radix(std::str::from_utf8(&hex).ok()?, 16).ok()?);
        } else {
            out.push(b);
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(range(None, 100), Some((0, 99)));
        assert_eq!(range(Some("bytes=0-1"), 100), Some((0, 1)));
        assert_eq!(range(Some("bytes=10-"), 100), Some((10, 99)));
        assert_eq!(range(Some("bytes=90-200"), 100), Some((90, 99)));
        assert_eq!(range(Some("bytes=-10"), 100), Some((90, 99)));
        assert_eq!(range(Some("bytes=-500"), 100), Some((0, 99)));
        assert_eq!(range(Some("bytes=5-9, 20-30"), 100), Some((5, 9)));
        assert_eq!(range(Some("bytes=100-"), 100), None);
        assert_eq!(range(Some("bytes=9-5"), 100), None);
        assert_eq!(range(Some("lines=1-2"), 100), None);
        assert_eq!(range(Some("bytes=x-"), 100), None);
        assert_eq!(range(Some("bytes=0-"), 0), None);
        assert_eq!(range(None, 0), None);
    }

    #[test]
    fn decodes_paths() {
        assert_eq!(
            decode("%2FUsers%2Fa%2F%E6%97%A5%E6%9C%AC%20b.mp4").as_deref(),
            Some("/Users/a/日本 b.mp4")
        );
        assert_eq!(
            decode("C%3A%5CVideos%5Ca.mp4").as_deref(),
            Some(r"C:\Videos\a.mp4")
        );
        assert_eq!(decode("%2"), None);
        assert_eq!(decode("%zz"), None);
        assert_eq!(decode("%FF"), None);
    }

    #[test]
    fn reads_request_heads() {
        let head = Head::parse(
            "GET /t/a.mp4 HTTP/1.1\r\nHost: 127.0.0.1:5\r\nRANGE: bytes=0-1\r\nAccept: */*\r\n\r\n",
        );
        assert_eq!(
            head,
            Some(Head {
                method: "GET".into(),
                target: "/t/a.mp4".into(),
                host: "127.0.0.1:5".into(),
                range: Some("bytes=0-1".into())
            })
        );
        assert_eq!(Head::parse("nonsense"), None);
    }

    /// Sends `head` (its `{host}` and `{token}` filled in) like a webview would;
    /// the status code and the body.
    fn ask(server: &Server, head: &str) -> (u16, Vec<u8>) {
        let rest = server.base.strip_prefix("http://").unwrap();
        let (host, token) = rest.split_once('/').unwrap();
        let mut conn = TcpStream::connect(host).unwrap();
        let head = head.replace("{host}", host).replace("{token}", token);
        conn.write_all(head.as_bytes()).unwrap();
        let mut out = Vec::new();
        conn.read_to_end(&mut out).unwrap();
        let split = out.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let code = String::from_utf8_lossy(&out[9..12]).parse().unwrap();
        (code, out[split + 4..].to_vec())
    }

    #[test]
    fn serves_allowed_files_in_pieces() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.mp4");
        std::fs::write(&file, b"0123456789").unwrap();
        let only = file.clone();
        let server = start(move |p| (p == only).then(|| p.to_path_buf())).unwrap();
        let path: String = file
            .to_string_lossy()
            .chars()
            .map(|c| match c {
                '/' => "%2F".to_string(),
                '\\' => "%5C".to_string(),
                ':' => "%3A".to_string(),
                c => c.to_string(),
            })
            .collect();
        let get = |extra: &str| {
            ask(
                &server,
                &format!("GET /{{token}}/{path} HTTP/1.1\r\nHost: {{host}}\r\n{extra}\r\n"),
            )
        };
        assert_eq!(get(""), (200, b"0123456789".to_vec()));
        assert_eq!(get("Range: bytes=2-4\r\n"), (206, b"234".to_vec()));
        assert_eq!(get("Range: bytes=20-\r\n").0, 416);
        let other = "GET /{token}/%2Fetc%2Fhosts HTTP/1.1\r\nHost: {host}\r\n\r\n";
        assert_eq!(ask(&server, other).0, 403);
        let bad = "GET /{token}/bad%zz HTTP/1.1\r\nHost: {host}\r\n\r\n";
        assert_eq!(ask(&server, bad).0, 404);
    }

    #[test]
    fn refuses_a_wrong_token_host_or_method() {
        let server = start(|p| Some(p.to_path_buf())).unwrap();
        let wrong_token = "GET /nope/%2Fetc%2Fhosts HTTP/1.1\r\nHost: {host}\r\n\r\n";
        assert_eq!(ask(&server, wrong_token).0, 404);
        let wrong_host = "GET /{token}/%2Fetc%2Fhosts HTTP/1.1\r\nHost: evil.example\r\n\r\n";
        assert_eq!(ask(&server, wrong_host).0, 403);
        let post = "POST /{token}/%2Fetc%2Fhosts HTTP/1.1\r\nHost: {host}\r\n\r\n";
        assert_eq!(ask(&server, post).0, 405);
    }
}
