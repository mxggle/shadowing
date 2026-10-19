//! Downloading with the system's curl: progress while it runs, then the file is
//! checked against its SHA-256 before it is used.

use crate::platform;
use crate::run::{run, Output};
use crate::{progress, Ctx};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::Command;

fn curl(no_revoke: bool) -> Command {
    let mut c = platform::curl();
    c.args(["-fsSL", "--retry", "2", "--connect-timeout", "20"]);
    c.args([
        "-A",
        concat!("shadowing-youtube/", env!("CARGO_PKG_VERSION")),
    ]);
    if no_revoke {
        c.arg("--ssl-no-revoke");
    }
    c
}

/// Runs curl with `args`. When Windows couldn't check whether GitHub's certificate
/// was revoked (behind some proxies and antivirus programs), once more without that
/// check: the certificate itself is still checked, and every download against its SHA-256.
pub fn curl_run(
    ctx: &Ctx,
    args: &dyn Fn(&mut Command),
    line: &mut dyn FnMut(&str),
    tick: &mut dyn FnMut(),
) -> Result<Output, String> {
    let mut command = curl(false);
    args(&mut command);
    let out = run(ctx, command, line, tick)?;
    if out.ok || !platform::revocation_unknown(&out.stderr) {
        return Ok(out);
    }
    let mut command = curl(true);
    args(&mut command);
    run(ctx, command, line, tick)
}

pub fn last_line(stderr: &[String]) -> String {
    stderr.last().cloned().unwrap_or_else(|| "没有回应".into())
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
pub fn fetch(
    ctx: &Ctx,
    url: &str,
    dest: &Path,
    size: u64,
    sha256: &str,
    message: &str,
) -> Result<(), String> {
    let part = dest.with_extension("part");
    let _ = fs::remove_file(&part);
    // Written next to `dest` by its plain name (Windows' curl may not read every character in a path).
    let (dir, name) = (
        part.parent().unwrap_or(&ctx.data),
        part.file_name().unwrap_or_default(),
    );
    let args = |c: &mut Command| {
        c.current_dir(dir).arg("-o").arg(name).arg(url);
    };
    let mut tick = || {
        progress(
            message,
            fs::metadata(&part).map(|m| m.len()).unwrap_or(0),
            size,
        )
    };
    let out = curl_run(ctx, &args, &mut |_| {}, &mut tick)?;
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

#[cfg(test)]
mod tests {
    use super::*;
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
