//! The tools this plugin runs, kept in its data folder:
//! - yt-dlp: the folder build (`yt-dlp_macos.zip`). The one-file build starts in
//!   6 s every time (it unpacks itself and macOS checks it again); the folder
//!   build only the first time, then in 0.17 s. Checked for a newer version at
//!   most once a day, since YouTube changes often.
//! - a JavaScript runtime for YouTube's challenges: Deno or Node when installed,
//!   else QuickJS-ng (1 MB, pinned). Often not needed at all; kept as a backup.
//!
//! Every download is checked against its SHA-256 before it is used.

use crate::run::run;
use crate::{progress, Ctx};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const LATEST: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const ASSET: &str = "yt-dlp_macos.zip";
const DAY: u64 = 24 * 3600;

const QJS_URL: &str = "https://github.com/quickjs-ng/quickjs/releases/download/v0.17.0";
const QJS_ARM64: &str = "8be3ddfe3397d2e692e4e1e8972ee9d032a0a580505d2f8b4ea528cf1b651c11";
const QJS_X86_64: &str = "9e5e101b4fd13cda3204222ca9f8be35412c41dcdef3745829633b7a67245412";

pub struct Tools {
    pub ytdlp: PathBuf,
    /// `--js-runtimes` value, e.g. `deno:/opt/homebrew/bin/deno`.
    pub js: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Stamp {
    version: String,
    /// When GitHub was last asked for a newer version (Unix seconds).
    checked: u64,
}

#[derive(Debug, PartialEq)]
struct Release {
    tag: String,
    url: String,
    size: u64,
    sha256: String,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn stamp_path(ctx: &Ctx) -> PathBuf {
    ctx.data.join("yt-dlp.json")
}

fn read_stamp(ctx: &Ctx) -> Stamp {
    fs::read(stamp_path(ctx))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_stamp(ctx: &Ctx, stamp: &Stamp) {
    if let Ok(bytes) = serde_json::to_vec(stamp) {
        let _ = fs::write(stamp_path(ctx), bytes);
    }
}

/// After a failure that looks like YouTube changed: look for a newer yt-dlp next time.
pub fn check_again(ctx: &Ctx) {
    let mut stamp = read_stamp(ctx);
    stamp.checked = 0;
    write_stamp(ctx, &stamp);
}

pub fn ensure(ctx: &Ctx) -> Result<Tools, String> {
    let ytdlp = ensure_ytdlp(ctx)?;
    Ok(Tools {
        ytdlp,
        js: js_runtime(ctx),
    })
}

fn ensure_ytdlp(ctx: &Ctx) -> Result<PathBuf, String> {
    let exe = ctx.data.join("yt-dlp").join("yt-dlp_macos");
    let mut stamp = read_stamp(ctx);
    let installed = exe.is_file();
    if installed && now().saturating_sub(stamp.checked) < DAY {
        return Ok(exe);
    }
    progress(
        if installed {
            "检查 yt-dlp 的新版本"
        } else {
            "准备 yt-dlp"
        },
        0,
        0,
    );
    match latest(ctx) {
        Ok(release) if installed && release.tag == stamp.version => {
            stamp.checked = now();
            write_stamp(ctx, &stamp);
            Ok(exe)
        }
        Ok(release) => match install(ctx, &release) {
            Ok(()) => Ok(exe),
            // An update that didn't come through: the version we have still works.
            Err(e) if installed && e != crate::CANCELLED => {
                eprintln!("yt-dlp update failed: {e}");
                Ok(exe)
            }
            Err(e) => Err(e),
        },
        Err(e) if installed => {
            eprintln!("yt-dlp update check failed: {e}");
            Ok(exe)
        }
        Err(e) => Err(format!("下载 yt-dlp 失败，请检查网络：{e}")),
    }
}

fn curl() -> Command {
    let mut c = Command::new("/usr/bin/curl");
    c.args(["-fsSL", "--retry", "2", "--connect-timeout", "20"]);
    c.args([
        "-A",
        concat!("shadowing-youtube/", env!("CARGO_PKG_VERSION")),
    ]);
    c
}

fn last_line(stderr: &[String]) -> String {
    stderr.last().cloned().unwrap_or_else(|| "没有回应".into())
}

fn latest(ctx: &Ctx) -> Result<Release, String> {
    let mut command = curl();
    command.args([
        "--max-time",
        "30",
        "-H",
        "Accept: application/vnd.github+json",
        LATEST,
    ]);
    let mut body = String::new();
    let out = run(ctx, command, &mut |l| body.push_str(l), &mut || {})?;
    if !out.ok {
        return Err(last_line(&out.stderr));
    }
    parse_release(&body)
}

fn parse_release(body: &str) -> Result<Release, String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    let asset = v["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|a| a["name"] == ASSET))
        .ok_or("最新版本里没有 macOS 的 yt-dlp")?;
    let sha256 = asset["digest"]
        .as_str()
        .and_then(|d| d.strip_prefix("sha256:"))
        .ok_or("最新版本没有校验值")?;
    Ok(Release {
        tag: v["tag_name"].as_str().unwrap_or_default().to_string(),
        url: asset["browser_download_url"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        size: asset["size"].as_u64().unwrap_or(0),
        sha256: sha256.to_ascii_lowercase(),
    })
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// Downloads `url` to `dest` with progress, then checks its SHA-256.
fn fetch(
    ctx: &Ctx,
    url: &str,
    dest: &Path,
    size: u64,
    sha256: &str,
    message: &str,
) -> Result<(), String> {
    let part = dest.with_extension("part");
    let _ = fs::remove_file(&part);
    let mut command = curl();
    command.arg("-o").arg(&part).arg(url);
    let mut tick = || {
        progress(
            message,
            fs::metadata(&part).map(|m| m.len()).unwrap_or(0),
            size,
        )
    };
    let out = run(ctx, command, &mut |_| {}, &mut tick)?;
    if !out.ok {
        let _ = fs::remove_file(&part);
        return Err(last_line(&out.stderr));
    }
    if sha256_file(&part)? != sha256 {
        let _ = fs::remove_file(&part);
        return Err("下载的文件校验不对，已删除，请重试".into());
    }
    fs::rename(&part, dest).map_err(|e| e.to_string())
}

fn install(ctx: &Ctx, release: &Release) -> Result<(), String> {
    let zip = ctx.data.join(ASSET);
    let message = format!("下载 yt-dlp {}（只需一次）", release.tag);
    fetch(
        ctx,
        &release.url,
        &zip,
        release.size,
        &release.sha256,
        &message,
    )?;
    let fresh = ctx.data.join("yt-dlp.new");
    let _ = fs::remove_dir_all(&fresh);
    progress("解压 yt-dlp", 0, 0);
    let mut ditto = Command::new("/usr/bin/ditto");
    ditto.arg("-x").arg("-k").arg(&zip).arg(&fresh);
    let out = run(ctx, ditto, &mut |_| {}, &mut || {})?;
    let _ = fs::remove_file(&zip);
    let exe = fresh.join("yt-dlp_macos");
    if !out.ok || !exe.is_file() {
        let _ = fs::remove_dir_all(&fresh);
        return Err(format!("解压 yt-dlp 失败：{}", last_line(&out.stderr)));
    }
    let dir = ctx.data.join("yt-dlp");
    let _ = fs::remove_dir_all(&dir);
    fs::rename(&fresh, &dir).map_err(|e| e.to_string())?;
    write_stamp(
        ctx,
        &Stamp {
            version: release.tag.clone(),
            checked: now(),
        },
    );
    // macOS checks a new program on its first run; get that wait over with here.
    progress("第一次启动 yt-dlp（macOS 会先检查一遍）", 0, 0);
    let mut first = Command::new(dir.join("yt-dlp_macos"));
    first.arg("--version");
    run(ctx, first, &mut |_| {}, &mut || {})?;
    Ok(())
}

/// Node 22 or newer ("v22.23.1").
fn node_ok(version: &str) -> bool {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()
        .and_then(|major| major.parse::<u32>().ok())
        .is_some_and(|major| major >= 22)
}

fn js_runtime(ctx: &Ctx) -> Option<String> {
    let home_deno = format!(
        "{}/.deno/bin/deno",
        std::env::var("HOME").unwrap_or_default()
    );
    let deno = ["/opt/homebrew/bin/deno", "/usr/local/bin/deno", &home_deno]
        .into_iter()
        .find(|p| Path::new(p).is_file());
    if let Some(deno) = deno {
        return Some(format!("deno:{deno}"));
    }
    for node in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        let version = Command::new(node).arg("--version").output();
        if version.is_ok_and(|o| node_ok(&String::from_utf8_lossy(&o.stdout))) {
            return Some(format!("node:{node}"));
        }
    }
    match quickjs(ctx) {
        Ok(qjs) => Some(format!("quickjs:{}", qjs.display())),
        Err(e) => {
            // Usually not needed: yt-dlp's default way in does without one.
            eprintln!("no JavaScript runtime: {e}");
            None
        }
    }
}

fn quickjs(ctx: &Ctx) -> Result<PathBuf, String> {
    let (name, sha256) = if cfg!(target_arch = "aarch64") {
        ("qjs-darwin-arm64", QJS_ARM64)
    } else {
        ("qjs-darwin-x86_64", QJS_X86_64)
    };
    let qjs = ctx.data.join("qjs");
    if qjs.is_file() && sha256_file(&qjs).is_ok_and(|s| s == sha256) {
        return Ok(qjs);
    }
    fetch(
        ctx,
        &format!("{QJS_URL}/{name}"),
        &qjs,
        0,
        sha256,
        "下载 QuickJS（约 1 MB）",
    )?;
    fs::set_permissions(&qjs, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    Ok(qjs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_latest_release() {
        let body = r#"{"tag_name":"2026.08.19","assets":[
            {"name":"yt-dlp_macos","size":1,"digest":"sha256:aa","browser_download_url":"x"},
            {"name":"yt-dlp_macos.zip","size":53923637,
             "digest":"sha256:07E54B0865303C864006925913BCE2604F8EE8CC6F18699BAC9C309F9328A6D8",
             "browser_download_url":"https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_macos.zip"}]}"#;
        let r = parse_release(body).unwrap();
        assert_eq!(r.tag, "2026.08.19");
        assert_eq!(r.size, 53923637);
        assert_eq!(
            r.sha256,
            "07e54b0865303c864006925913bce2604f8ee8cc6f18699bac9c309f9328a6d8"
        );
        assert!(r.url.ends_with("/yt-dlp_macos.zip"));

        assert!(parse_release(r#"{"tag_name":"x","assets":[]}"#).is_err());
        let no_digest = r#"{"tag_name":"x","assets":[{"name":"yt-dlp_macos.zip","size":1}]}"#;
        assert!(parse_release(no_digest).is_err());
    }

    #[test]
    fn node_needs_22() {
        assert!(node_ok("v22.23.1\n"));
        assert!(node_ok("v24.0.0"));
        assert!(!node_ok("v20.11.0"));
        assert!(!node_ok(""));
    }

    #[test]
    fn hashes_files() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("f");
        fs::write(&file, "abc").unwrap();
        assert_eq!(
            sha256_file(&file).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
