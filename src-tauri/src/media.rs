//! `media://` protocol: streams audio files from the approved folder with
//! HTTP Range support, which WKWebView needs for seeking.

use crate::library::{is_audio, resolve_inside};
use crate::AppState;
use percent_encoding::percent_decode_str;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

/// Upper bound per response; the player requests the next range itself.
const MAX_CHUNK: u64 = 2 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum RangePlan {
    Full,
    Partial { start: u64, end: u64 },
    Unsatisfiable,
}

/// Parses a single `bytes=` range and caps it to `MAX_CHUNK`. `end` is inclusive.
pub fn plan_range(header: Option<&str>, size: u64) -> RangePlan {
    let Some(spec) = header.and_then(|h| h.trim().strip_prefix("bytes=")) else {
        return RangePlan::Full;
    };
    let Some((start, end)) = spec.split_once('-').filter(|_| !spec.contains(',')) else {
        return RangePlan::Unsatisfiable;
    };
    if size == 0 {
        return RangePlan::Unsatisfiable;
    }
    let (start, end) = match (start.trim(), end.trim()) {
        ("", suffix) => match suffix.parse::<u64>() {
            Ok(n) if n > 0 => (size.saturating_sub(n), size - 1),
            _ => return RangePlan::Unsatisfiable,
        },
        (s, e) => {
            let Ok(s) = s.parse::<u64>() else {
                return RangePlan::Unsatisfiable;
            };
            let e = if e.is_empty() {
                size - 1
            } else {
                match e.parse::<u64>() {
                    Ok(e) => e.min(size - 1),
                    Err(_) => return RangePlan::Unsatisfiable,
                }
            };
            (s, e)
        }
    };
    if start > end || start >= size {
        return RangePlan::Unsatisfiable;
    }
    RangePlan::Partial {
        start,
        end: end.min(start + MAX_CHUNK - 1),
    }
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp3") => "audio/mpeg",
        Some("m4a" | "m4b") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("wav") => "audio/wav",
        Some("flac") => "audio/flac",
        Some("aif" | "aiff") => "audio/aiff",
        Some("caf") => "audio/x-caf",
        _ => "application/octet-stream",
    }
}

/// Accepts `media://localhost/<encoded>` (macOS) and `http://media.localhost/<encoded>` (Windows).
fn decode_path(uri_path: &str) -> PathBuf {
    let decoded = percent_decode_str(uri_path.trim_start_matches('/')).decode_utf8_lossy();
    PathBuf::from(decoded.into_owned())
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(code).body(Vec::new()).unwrap()
}

pub fn handle(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let requested = decode_path(request.uri().path());
    let root = app.state::<AppState>().root();
    let Some(path) = root
        .and_then(|root| resolve_inside(&root, &requested))
        .filter(|p| is_audio(p))
    else {
        return status(StatusCode::FORBIDDEN);
    };
    serve(&path, request).unwrap_or_else(|err| {
        eprintln!("media: {}: {err}", path.display());
        status(StatusCode::INTERNAL_SERVER_ERROR)
    })
}

fn serve(path: &Path, request: &Request<Vec<u8>>) -> std::io::Result<Response<Vec<u8>>> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());
    let head_only = request.method() == tauri::http::Method::HEAD;
    let builder = Response::builder()
        .header(header::CONTENT_TYPE, mime_for(path))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    let (builder, start, len) = match plan_range(range, size) {
        RangePlan::Unsatisfiable => {
            return Ok(builder
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Vec::new())
                .unwrap());
        }
        RangePlan::Full => (builder.status(StatusCode::OK), 0, size),
        RangePlan::Partial { start, end } => (
            builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}")),
            start,
            end - start + 1,
        ),
    };
    let mut body = Vec::new();
    if !head_only {
        file.seek(SeekFrom::Start(start))?;
        body.reserve(len as usize);
        file.take(len).read_to_end(&mut body)?;
    }
    Ok(builder
        .header(header::CONTENT_LENGTH, len)
        .body(body)
        .unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        use RangePlan::*;
        assert_eq!(plan_range(None, 100), Full);
        assert_eq!(
            plan_range(Some("bytes=0-1"), 100),
            Partial { start: 0, end: 1 }
        );
        assert_eq!(
            plan_range(Some("bytes=10-"), 100),
            Partial { start: 10, end: 99 }
        );
        assert_eq!(
            plan_range(Some("bytes=-10"), 100),
            Partial { start: 90, end: 99 }
        );
        assert_eq!(
            plan_range(Some("bytes=50-500"), 100),
            Partial { start: 50, end: 99 }
        );
        assert_eq!(plan_range(Some("bytes=100-"), 100), Unsatisfiable);
        assert_eq!(plan_range(Some("bytes=0-1,5-6"), 100), Unsatisfiable);
        let big = 10 * MAX_CHUNK;
        assert_eq!(
            plan_range(Some("bytes=0-"), big),
            Partial {
                start: 0,
                end: MAX_CHUNK - 1
            }
        );
    }

    #[test]
    fn decodes_converted_paths() {
        assert_eq!(
            decode_path("/%2FUsers%2Fme%2Fa%20b.mp3"),
            PathBuf::from("/Users/me/a b.mp3")
        );
    }
}
