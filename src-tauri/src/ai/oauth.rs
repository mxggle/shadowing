//! Pieces shared by browser sign-ins: PKCE values and a one-shot loopback
//! listener that catches the redirect back from the provider.

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Set by `ai_sign_in_cancel`; checked while waiting for the browser.
pub static CANCEL: AtomicBool = AtomicBool::new(false);
pub const CANCELLED: &str = "已取消登录";
/// How long to wait for the user to finish in the browser.
const WAIT: Duration = Duration::from_secs(300);

pub fn base64url(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
        for i in 0..=chunk.len() {
            out.push(ABC[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

/// Decodes base64url (padding optional); also accepts standard base64.
pub fn base64url_decode(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(u32::from(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            _ => return None,
        }))
    };
    let s = s.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    for chunk in s.chunks(4) {
        let n = chunk
            .iter()
            .enumerate()
            .try_fold(0u32, |n, (i, &c)| Some(n | val(c)? << (18 - 6 * i)))?;
        for i in 0..chunk.len().saturating_sub(1) {
            out.push((n >> (16 - 8 * i)) as u8);
        }
    }
    Some(out)
}

/// Random URL-safe string from `n` bytes of the system's secure randomness.
pub fn random(n: usize) -> Result<String, String> {
    let mut bytes = vec![0; n];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(|e| e.to_string())?;
    Ok(base64url(&bytes))
}

/// (verifier, S256 challenge)
pub fn pkce() -> Result<(String, String), String> {
    let verifier = random(32)?;
    let challenge = base64url(&Sha256::digest(verifier.as_bytes()));
    Ok((verifier, challenge))
}

pub fn open_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(drop)
        .map_err(|e| tr!("无法打开浏览器：{e}", "Couldn't open the browser: {e}"))
}

/// Listens on 127.0.0.1 (random port) for the provider's redirect.
pub struct Loopback {
    listener: TcpListener,
    pub port: u16,
}

impl Loopback {
    pub fn bind() -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        CANCEL.store(false, Ordering::Relaxed);
        Ok(Self { listener, port })
    }

    /// Waits for `GET {path}?…&state={state}`, answers with a small page and returns the query.
    /// Other requests (favicon…) get a 404, and a callback with another `state` (not from
    /// this sign-in, e.g. another program on this Mac) gets a 400; waiting continues.
    pub fn wait(
        &self,
        path: &str,
        state: &str,
        service: &str,
    ) -> Result<HashMap<String, String>, String> {
        let deadline = Instant::now() + WAIT;
        loop {
            if CANCEL.load(Ordering::Relaxed) {
                return Err(crate::i18n::pick(CANCELLED, "Cancelled").into());
            }
            if Instant::now() > deadline {
                return Err(crate::i18n::pick(
                    "等待登录超时，请重试",
                    "Timed out waiting for the sign-in. Try again.",
                )
                .into());
            }
            let (mut stream, _) = match self.listener.accept() {
                Ok(conn) => conn,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100));
                    continue;
                }
                Err(e) => return Err(e.to_string()),
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]);
            let target = head
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or("");
            let Ok(url) = tauri::Url::parse(&format!("http://127.0.0.1{target}")) else {
                continue;
            };
            if url.path() != path {
                let _ = stream.write_all(
                    b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                );
                continue;
            }
            let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
            if query.get("state").map(String::as_str) != Some(state) {
                let _ = stream.write_all(
                    b"HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                );
                continue;
            }
            let ok = query.contains_key("code");
            let page = format!(
                "<!doctype html><meta charset=utf-8><title>Shadowing</title>\
                 <body style=\"font:16px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;color:#333\">\
                 <p>{}</p>",
                if ok {
                    tr!(
                        "已连接 {service}，可以回到 Shadowing 了。",
                        "Connected to {service}. You can go back to Shadowing now."
                    )
                } else {
                    crate::i18n::pick(
                        "没有完成授权，可以回到 Shadowing 重试。",
                        "Authorization wasn't completed. Go back to Shadowing to try again.",
                    )
                    .to_string()
                }
            );
            let _ = stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{page}",
                    page.len()
                )
                .as_bytes(),
            );
            return Ok(query);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_rfc_4648_vectors() {
        for (raw, enc) in [
            ("", ""),
            ("f", "Zg"),
            ("fo", "Zm8"),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg"),
            ("fooba", "Zm9vYmE"),
        ] {
            assert_eq!(base64url(raw.as_bytes()), enc);
            assert_eq!(base64url_decode(enc).unwrap(), raw.as_bytes());
        }
        assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
    }

    #[test]
    fn pkce_challenge_is_the_s256_of_the_verifier() {
        // RFC 7636 appendix B
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            base64url(&Sha256::digest(verifier.as_bytes())),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let (v, c) = pkce().unwrap();
        assert_eq!(v.len(), 43);
        assert_eq!(c, base64url(&Sha256::digest(v.as_bytes())));
    }

    #[test]
    fn loopback_returns_the_callback_query() {
        let lb = Loopback::bind().unwrap();
        let port = lb.port;
        std::thread::spawn(move || {
            let get = |path: &str| {
                let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
                s.write_all(format!("GET {path} HTTP/1.1\r\nhost: x\r\n\r\n").as_bytes())
                    .unwrap();
                let mut reply = String::new();
                let _ = s.read_to_string(&mut reply);
                reply
            };
            assert!(get("/favicon.ico").starts_with("HTTP/1.1 404"));
            // Someone else's callback doesn't end this sign-in.
            assert!(get("/callback?code=evil&state=other").starts_with("HTTP/1.1 400"));
            assert!(get("/callback?code=evil").starts_with("HTTP/1.1 400"));
            assert!(get("/callback?code=abc%2B1&state=xyz").contains("已连接 Test"));
        });
        let q = lb.wait("/callback", "xyz", "Test").unwrap();
        assert_eq!((q["code"].as_str(), q["state"].as_str()), ("abc+1", "xyz"));
    }
}
