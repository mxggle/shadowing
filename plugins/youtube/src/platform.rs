//! What differs between macOS and Windows: which yt-dlp and QuickJS builds to
//! download, the curl and unzip that come with the system (by full path, so a
//! different `curl` or `tar` earlier on someone's PATH, e.g. Git's, isn't used),
//! and where Deno or Node usually are.

use std::path::{Path, PathBuf};
use std::process::Command;

pub const OS: &str = std::env::consts::OS;
pub const ARCH: &str = std::env::consts::ARCH;

/// How the system is called in messages.
pub const OS_NAME: &str = if cfg!(windows) { "Windows" } else { "macOS" };

/// yt-dlp's folder build (a zip with the program and its `_internal/` at the top).
#[derive(Debug, PartialEq)]
pub struct YtDlp {
    pub asset: &'static str,
    pub exe: &'static str,
}

pub fn ytdlp_build(os: &str, arch: &str) -> Option<YtDlp> {
    let (asset, exe) = match (os, arch) {
        // One build for Apple Silicon and Intel.
        ("macos", _) => ("yt-dlp_macos.zip", "yt-dlp_macos"),
        ("windows", "x86_64") => ("yt-dlp_win.zip", "yt-dlp.exe"),
        ("windows", "aarch64") => ("yt-dlp_win_arm64.zip", "yt-dlp_arm64.exe"),
        _ => return None,
    };
    Some(YtDlp { asset, exe })
}

/// A QuickJS-ng v0.17.0 program, pinned by its SHA-256, and its name in the data folder.
#[derive(Debug, PartialEq)]
pub struct QuickJs {
    pub asset: &'static str,
    pub sha256: &'static str,
    pub file: &'static str,
}

pub fn quickjs_build(os: &str, arch: &str) -> Option<QuickJs> {
    let (asset, sha256, file) = match (os, arch) {
        ("macos", "aarch64") => (
            "qjs-darwin-arm64",
            "8be3ddfe3397d2e692e4e1e8972ee9d032a0a580505d2f8b4ea528cf1b651c11",
            "qjs",
        ),
        ("macos", "x86_64") => (
            "qjs-darwin-x86_64",
            "9e5e101b4fd13cda3204222ca9f8be35412c41dcdef3745829633b7a67245412",
            "qjs",
        ),
        // There is no Windows on Arm build: Windows 11 runs the x64 one emulated.
        ("windows", "x86_64" | "aarch64") => (
            "qjs-windows-x86_64.exe",
            "2aeabf0092c3262d6b2609824418f7dd7ed1f1df939f73b2b15645230cac0d77",
            "qjs.exe",
        ),
        _ => return None,
    };
    Some(QuickJs {
        asset,
        sha256,
        file,
    })
}

/// Where Deno and Node usually are (`env` reads the environment), best first.
pub fn js_candidates(
    os: &str,
    env: impl Fn(&str) -> Option<String>,
) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let under = |var: &str, rest: &str| env(var).map(|dir| Path::new(&dir).join(rest));
    if os == "windows" {
        let deno = [
            under("USERPROFILE", r".deno\bin\deno.exe"),
            under("LOCALAPPDATA", r"Microsoft\WinGet\Links\deno.exe"),
        ];
        let node = [under("ProgramFiles", r"nodejs\node.exe")];
        (
            deno.into_iter().flatten().collect(),
            node.into_iter().flatten().collect(),
        )
    } else {
        let mut deno = vec![
            PathBuf::from("/opt/homebrew/bin/deno"),
            PathBuf::from("/usr/local/bin/deno"),
        ];
        deno.extend(under("HOME", ".deno/bin/deno"));
        let node = vec![
            PathBuf::from("/opt/homebrew/bin/node"),
            PathBuf::from("/usr/local/bin/node"),
        ];
        (deno, node)
    }
}

/// A program in Windows' System32 folder.
#[cfg(windows)]
fn system32(program: &str) -> PathBuf {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    PathBuf::from(root).join("System32").join(program)
}

/// Starts a console program without a console window (the app shows none).
pub fn hide(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub fn curl() -> Command {
    #[cfg(windows)]
    let curl = system32("curl.exe");
    #[cfg(not(windows))]
    let curl = PathBuf::from("/usr/bin/curl");
    let mut command = Command::new(curl);
    hide(&mut command);
    command
}

/// Unpacks `zip` into `dest` (a new folder), both names inside `dir`: plain
/// names, since Windows' tar may not read every character in a path.
pub fn unzip(dir: &Path, zip: &str, dest: &str) -> Command {
    #[cfg(windows)]
    let mut command = {
        let _ = std::fs::create_dir_all(dir.join(dest));
        let mut tar = Command::new(system32("tar.exe"));
        tar.args(["-xf", zip, "-C", dest]);
        tar
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut ditto = Command::new("/usr/bin/ditto");
        ditto.args(["-x", "-k", zip, dest]);
        ditto
    };
    command.current_dir(dir);
    hide(&mut command);
    command
}

/// Lets a downloaded program run (any `.exe` runs on Windows).
pub fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Windows' curl couldn't check whether a certificate was revoked (behind some
/// proxies and antivirus programs): CRYPT_E_NO_REVOCATION_CHECK, CRYPT_E_REVOCATION_OFFLINE.
pub fn revocation_unknown(stderr: &[String]) -> bool {
    stderr.iter().any(|l| {
        [
            "0x80092012",
            "0x80092013",
            "CRYPT_E_NO_REVOCATION",
            "CRYPT_E_REVOCATION_OFFLINE",
        ]
        .iter()
        .any(|code| l.contains(code))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_builds_for_each_computer() {
        assert_eq!(ytdlp_build("macos", "aarch64").unwrap().exe, "yt-dlp_macos");
        assert_eq!(
            ytdlp_build("macos", "x86_64").unwrap().asset,
            "yt-dlp_macos.zip"
        );
        let win = ytdlp_build("windows", "x86_64").unwrap();
        assert_eq!((win.asset, win.exe), ("yt-dlp_win.zip", "yt-dlp.exe"));
        let arm = ytdlp_build("windows", "aarch64").unwrap();
        assert_eq!(
            (arm.asset, arm.exe),
            ("yt-dlp_win_arm64.zip", "yt-dlp_arm64.exe")
        );
        assert!(ytdlp_build("linux", "x86_64").is_none());

        assert_eq!(
            quickjs_build("macos", "aarch64").unwrap().asset,
            "qjs-darwin-arm64"
        );
        let qjs = quickjs_build("windows", "x86_64").unwrap();
        assert_eq!((qjs.asset, qjs.file), ("qjs-windows-x86_64.exe", "qjs.exe"));
        assert_eq!(quickjs_build("windows", "aarch64"), Some(qjs));
        for (os, arch) in [
            ("macos", "aarch64"),
            ("macos", "x86_64"),
            ("windows", "x86_64"),
        ] {
            let sha = quickjs_build(os, arch).unwrap().sha256;
            assert!(sha.len() == 64 && sha.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }

    #[test]
    fn looks_for_deno_and_node_where_they_are_installed() {
        let env = |key: &str| match key {
            "USERPROFILE" => Some(r"C:\Users\a".to_string()),
            "ProgramFiles" => Some(r"C:\Program Files".to_string()),
            "HOME" => Some("/Users/a".to_string()),
            _ => None,
        };
        let (deno, node) = js_candidates("windows", env);
        assert_eq!(deno, [Path::new(r"C:\Users\a").join(r".deno\bin\deno.exe")]);
        assert_eq!(
            node,
            [Path::new(r"C:\Program Files").join(r"nodejs\node.exe")]
        );
        let (deno, node) = js_candidates("macos", env);
        assert_eq!(
            deno.last().unwrap(),
            &Path::new("/Users/a").join(".deno/bin/deno")
        );
        assert_eq!(node[0], Path::new("/opt/homebrew/bin/node"));
    }

    #[test]
    fn tells_a_revocation_check_that_could_not_run() {
        let line = |s: &str| vec![s.to_string()];
        assert!(revocation_unknown(&line(
            "curl: (35) schannel: next InitializeSecurityContext failed: Unknown error (0x80092012)"
        )));
        assert!(revocation_unknown(&line(
            "curl: (35) schannel: next InitializeSecurityContext failed: CRYPT_E_REVOCATION_OFFLINE (0x80092013)"
        )));
        assert!(!revocation_unknown(&line(
            "curl: (6) Could not resolve host: github.com"
        )));
    }
}
