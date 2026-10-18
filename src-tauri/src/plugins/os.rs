//! What differs between macOS and Windows around a plugin's program: the
//! environment it runs with, its console window, ending it together with what
//! it started, and the "downloaded from the internet" mark on installed files.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

/// Passed through so a plugin can reach the network the way the app does
/// (Windows reads these names in any case, so the upper-case ones are enough there).
const PROXIES: &[&str] = &[
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
];

/// What a Windows program needs to start and find its folders: without
/// `SystemRoot` a Python program like yt-dlp can't even open a socket.
const WINDOWS: &[&str] = &[
    "windir",
    "SystemDrive",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "ProgramData",
    "ProgramFiles",
    "PATHEXT",
    "ComSpec",
    "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS",
];

/// The whole environment of a plugin (everything else is cleared): only system
/// folders on `PATH`, where home and temporary files are, and the proxies.
/// `get` reads the app's own environment.
pub fn environment(
    windows: bool,
    get: impl Fn(&str) -> Option<OsString>,
) -> Vec<(String, OsString)> {
    let mut env: Vec<(String, OsString)> = Vec::new();
    let pass = |env: &mut Vec<(String, OsString)>, key: &str| {
        if let Some(value) = get(key) {
            env.push((key.to_string(), value));
        }
    };
    if windows {
        let root = get("SystemRoot")
            .or_else(|| get("windir"))
            .unwrap_or_else(|| r"C:\Windows".into());
        let mut path = OsString::new();
        for (i, sub) in ["\\System32", "", "\\System32\\Wbem"].iter().enumerate() {
            if i > 0 {
                path.push(";");
            }
            path.push(&root);
            path.push(sub);
        }
        env.push(("SystemRoot".into(), root));
        env.push(("PATH".into(), path));
        for key in WINDOWS.iter().chain(&PROXIES[4..]) {
            pass(&mut env, key);
        }
    } else {
        env.push(("PATH".into(), "/usr/bin:/bin:/usr/sbin:/sbin".into()));
        env.push(("LANG".into(), "en_US.UTF-8".into()));
        for key in ["HOME", "TMPDIR"].iter().chain(PROXIES) {
            pass(&mut env, key);
        }
    }
    env
}

/// A program in Windows' System32 folder, by full path (a `tar` or `curl` earlier
/// on someone's PATH, e.g. Git's, behaves differently).
#[cfg(windows)]
pub fn system32(program: &str) -> PathBuf {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    PathBuf::from(root).join("System32").join(program)
}

/// Starts a console program without opening a console window (the app has none).
pub fn hide(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Ends a plugin that didn't stop when asked. On Windows what it started (a
/// download) ends with it: `taskkill /T` finds those by their parent, so it runs
/// while the plugin is still there. On macOS they stop by themselves: their
/// output goes to the plugin, and writing to it fails once the plugin is gone.
pub fn end(child: &mut Child) {
    #[cfg(windows)]
    {
        use std::process::Stdio;
        let _ = hide(&mut Command::new(system32("taskkill.exe")))
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

/// Installing is the learner's go-ahead. A plugin downloaded as a zip in a browser
/// carries the download mark onto every file it unpacks (and a copy keeps it):
/// macOS kills a quarantined program the moment the app starts it, and Windows
/// may block or warn about a program marked as coming from the internet.
pub fn clear_download_mark(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt;
        let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
            return;
        };
        // SAFETY: both are NUL-terminated C strings that live through the call.
        unsafe {
            libc::removexattr(
                path.as_ptr(),
                c"com.apple.quarantine".as_ptr(),
                libc::XATTR_NOFOLLOW,
            );
        }
    }
    #[cfg(windows)]
    {
        // The Mark of the Web is a hidden stream beside the file's contents.
        let _ = std::fs::remove_file(zone_identifier(path));
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = path;
}

/// `file:Zone.Identifier`, where Windows keeps where a file was downloaded from.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn zone_identifier(path: &Path) -> PathBuf {
    let mut stream = path.as_os_str().to_owned();
    stream.push(":Zone.Identifier");
    PathBuf::from(stream)
}

/// Lets the program run (Windows runs any `.exe`; nothing to set there).
pub fn make_executable(program: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut mode = std::fs::metadata(program)?.permissions();
        mode.set_mode(mode.mode() | 0o755);
        std::fs::set_permissions(program, mode)?;
    }
    #[cfg(not(unix))]
    std::fs::metadata(program)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn from(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let map: HashMap<String, OsString> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), OsString::from(v)))
            .collect();
        move |k| map.get(k).cloned()
    }

    fn keys(env: &[(String, OsString)]) -> Vec<&str> {
        env.iter().map(|(k, _)| k.as_str()).collect()
    }

    fn value<'a>(env: &'a [(String, OsString)], key: &str) -> Option<&'a str> {
        env.iter()
            .find(|(k, _)| k == key)
            .and_then(|(_, v)| v.to_str())
    }

    #[test]
    fn a_mac_plugin_gets_system_folders_home_and_proxies() {
        let env = environment(
            false,
            from(&[
                ("HOME", "/Users/a"),
                ("TMPDIR", "/var/folders/x"),
                ("https_proxy", "http://127.0.0.1:7890"),
                ("CARGO_PKG_NAME", "secret"),
                ("SystemRoot", "C:\\Windows"),
            ]),
        );
        assert_eq!(
            keys(&env),
            ["PATH", "LANG", "HOME", "TMPDIR", "https_proxy"]
        );
        assert_eq!(value(&env, "PATH"), Some("/usr/bin:/bin:/usr/sbin:/sbin"));
        assert_eq!(value(&env, "HOME"), Some("/Users/a"));
    }

    #[test]
    fn a_windows_plugin_gets_what_windows_programs_need() {
        let env = environment(
            true,
            from(&[
                ("SystemRoot", "D:\\Win"),
                ("windir", "D:\\Win"),
                ("TEMP", "C:\\Users\\a\\AppData\\Local\\Temp"),
                ("TMP", "C:\\Users\\a\\AppData\\Local\\Temp"),
                ("USERPROFILE", "C:\\Users\\a"),
                ("LOCALAPPDATA", "C:\\Users\\a\\AppData\\Local"),
                ("APPDATA", "C:\\Users\\a\\AppData\\Roaming"),
                ("PATHEXT", ".COM;.EXE;.BAT;.CMD"),
                ("ComSpec", "D:\\Win\\system32\\cmd.exe"),
                ("HTTPS_PROXY", "http://127.0.0.1:7890"),
                ("Path", "C:\\Program Files\\Git\\usr\\bin;D:\\Win\\System32"),
                ("HOME", "C:\\Users\\a"),
                ("CARGO_PKG_NAME", "secret"),
            ]),
        );
        assert_eq!(
            value(&env, "PATH"),
            Some("D:\\Win\\System32;D:\\Win;D:\\Win\\System32\\Wbem")
        );
        for key in [
            "SystemRoot",
            "windir",
            "TEMP",
            "TMP",
            "USERPROFILE",
            "LOCALAPPDATA",
            "APPDATA",
            "PATHEXT",
            "ComSpec",
            "HTTPS_PROXY",
        ] {
            assert!(value(&env, key).is_some(), "{key}");
        }
        // Not the user's own PATH, nothing Unix-only, nothing else of the app's.
        for key in [
            "Path",
            "HOME",
            "LANG",
            "TMPDIR",
            "https_proxy",
            "CARGO_PKG_NAME",
        ] {
            assert!(!keys(&env).contains(&key), "{key}");
        }
        let names: Vec<String> = keys(&env).iter().map(|k| k.to_uppercase()).collect();
        let mut unique = names.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(names.len(), unique.len(), "{names:?}");
    }

    #[test]
    fn windows_without_system_root_still_gets_one() {
        let env = environment(true, from(&[]));
        assert_eq!(value(&env, "SystemRoot"), Some("C:\\Windows"));
        assert!(value(&env, "PATH")
            .unwrap()
            .starts_with("C:\\Windows\\System32;"));
        assert_eq!(keys(&env), ["SystemRoot", "PATH"]);
    }

    #[test]
    fn the_download_mark_is_a_stream_of_the_file() {
        let path = Path::new("plugins").join("run.exe");
        let stream = zone_identifier(&path);
        assert_eq!(
            stream.file_name().unwrap().to_string_lossy(),
            "run.exe:Zone.Identifier"
        );
    }
}
