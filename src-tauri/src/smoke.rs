//! Debug-only self-test: `SHADOWING_SMOKE=<audio folder> npm run smoke`.
//! The webview runs a scripted playback scenario (src/dev/smoke.ts), prints
//! results to stdout and exits. Uses a throwaway data folder (state.json, transcripts), cleared on start.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn folder() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var_os("SHADOWING_SMOKE").and_then(|p| PathBuf::from(p).canonicalize().ok())
}

pub fn state_path() -> PathBuf {
    std::env::temp_dir()
        .join("shadowing-smoke")
        .join("state.json")
}

/// Subfolder of the smoke folder that 从链接导入 writes into; removed before and after a run.
const IMPORTS: &str = "smoke-import";

/// A fake 从链接导入 plugin that “downloads” one of the smoke folder's files, so the
/// whole import path runs in the real app without the network: a shell script on
/// macOS, a PowerShell script (started by a .cmd) on Windows.
pub fn install_plugin(data: &Path, folder: &Path) -> std::io::Result<()> {
    let _ = std::fs::remove_dir_all(folder.join(IMPORTS));
    let dir = data.join("plugins").join("smoke-import");
    std::fs::create_dir_all(dir.join("bin"))?;
    let platform = crate::plugins::manifest::platform();
    let program = if cfg!(windows) {
        "bin/run.cmd"
    } else {
        "bin/run"
    };
    std::fs::write(
        dir.join("manifest.json"),
        format!(
            r#"{{"id":"smoke-import","name":"Smoke","version":"0.0.1","protocol":1,
            "main":{{"{platform}":"{program}"}},
            "contributes":{{"importers":[{{"id":"fake","title":"Smoke","match":["https://smoke.example/*"]}}]}}}}"#
        ),
    )?;
    let source = folder.join("02 English VBR.mp3");
    write_program(&dir.join("bin"), &source.to_string_lossy())
}

/// The subtitles it “downloads”, written with `\n` (backslash, n) for each line break.
const VTT: &str = "WEBVTT\\n\\n00:00:00.000 --> 00:00:02.600\\nThe quick brown fox.\\n\\n00:00:02.900 --> 00:00:07.500\\nShadowing means repeating.\\n";
/// Its answers; `ID` stands for the request's id.
const INITIALIZED: &str = r#"{"jsonrpc":"2.0","id":ID,"result":{"name":"smoke"}}"#;
const RESOLVED: &str = r#"{"jsonrpc":"2.0","id":ID,"result":{"title":"Smoke import","duration":7,"subtitles":[{"lang":"en","name":"English"}]}}"#;
const PROGRESS: &str =
    r#"{"jsonrpc":"2.0","method":"progress","params":{"message":"copying","done":1,"total":2}}"#;
const RAN: &str = r#"{"jsonrpc":"2.0","id":ID,"result":{"files":[{"path":"audio.mp3","kind":"audio"},{"path":"audio.en.vtt","kind":"subtitle","lang":"en"}]}}"#;

#[cfg(unix)]
fn write_program(bin: &Path, source: &str) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let id = |json: &str| json.replace("ID", "%s");
    let script = format!(
        r#"#!/bin/sh
while read -r line; do
  id=$(printf '%s' "$line" | sed -E 's/.*"id":([0-9]+).*/\1/')
  case "$line" in
    *'"method":"initialize"'*) printf '{init}\n' "$id" ;;
    *'"method":"import/resolve"'*) printf '{resolved}\n' "$id" ;;
    *'"method":"import/run"'*)
      out=$(printf '%s' "$line" | sed -E 's/.*"outDir":"([^"]*)".*/\1/')
      printf '%s\n' '{PROGRESS}'
      cp '{source}' "$out/audio.mp3"
      printf '{vtt}' > "$out/audio.en.vtt"
      printf '{ran}\n' "$id" ;;
  esac
done
"#,
        init = id(INITIALIZED),
        resolved = id(RESOLVED),
        ran = id(RAN),
        vtt = VTT,
    );
    let program = bin.join("run");
    std::fs::write(&program, script)?;
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755))
}

/// Windows: the .cmd hands over to the PowerShell that comes with Windows (by full
/// path: the plugin's PATH has only System32). Plain .NET, no modules needed.
#[cfg(windows)]
fn write_program(bin: &Path, source: &str) -> std::io::Result<()> {
    let cmd = "@echo off\r\n\"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"%~dp0run.ps1\"\r\n";
    std::fs::write(bin.join("run.cmd"), cmd)?;
    let id = |json: &str| format!("'{}'", json.replace("ID", "' + $id + '"));
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8)
$writer = [System.IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
$writer.AutoFlush = $true
$writer.NewLine = "`n"
while ($null -ne ($line = $reader.ReadLine())) {{
  $id = [regex]::Match($line, '"id":(\d+)').Groups[1].Value
  if ($line.Contains('"method":"initialize"')) {{ $writer.WriteLine({init}) }}
  elseif ($line.Contains('"method":"import/resolve"')) {{ $writer.WriteLine({resolved}) }}
  elseif ($line.Contains('"method":"import/run"')) {{
    $out = [regex]::Unescape([regex]::Match($line, '"outDir":"((?:[^"\\]|\\.)*)"').Groups[1].Value)
    $writer.WriteLine('{PROGRESS}')
    [System.IO.File]::Copy('{source}', [System.IO.Path]::Combine($out, 'audio.mp3'), $true)
    [System.IO.File]::WriteAllText([System.IO.Path]::Combine($out, 'audio.en.vtt'), "{vtt}", $utf8)
    $writer.WriteLine({ran})
  }}
}}
"#,
        init = id(INITIALIZED),
        resolved = id(RESOLVED),
        ran = id(RAN),
        source = source.replace('\'', "''"),
        vtt = VTT.replace("\\n", "`n"),
    );
    std::fs::write(bin.join("run.ps1"), script)
}

#[tauri::command]
pub fn smoke_mode() -> bool {
    folder().is_some()
}

#[tauri::command]
pub fn smoke_window(app: AppHandle, minimized: bool) {
    if let (Some(_), Some(w)) = (folder(), app.get_webview_window("main")) {
        let _ = if minimized {
            w.minimize()
        } else {
            w.unminimize()
        };
    }
}

#[tauri::command]
pub fn smoke_finish(app: AppHandle, code: i32) {
    if let Some(folder) = folder() {
        let _ = std::fs::remove_dir_all(folder.join(IMPORTS));
        app.exit(code);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::{manifest::Manifest, rpc::Process};
    use serde_json::{json, Value};
    use std::sync::atomic::AtomicBool;

    /// The fake plugin answers like a real one (on Windows: its PowerShell version).
    #[test]
    fn the_fake_plugin_imports() {
        let tmp = tempfile::tempdir().unwrap();
        let (data, folder) = (tmp.path().join("data"), tmp.path().join("music"));
        let out = tmp.path().join("job 日本");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(&out).unwrap();
        std::fs::write(folder.join("02 English VBR.mp3"), "mp3").unwrap();
        install_plugin(&data, &folder).unwrap();

        let dir = data.join("plugins").join("smoke-import");
        let manifest = Manifest::read(&dir).unwrap();
        let program = dir.join(manifest.program_path().unwrap());
        let mut p = Process::spawn(&program, &dir).unwrap();
        let never = AtomicBool::new(false);
        let mut quiet = |_: &str, _: &Value| {};
        let hello = p.call("initialize", json!({ "protocol": 1 }), &never, &mut quiet);
        assert_eq!(hello.unwrap()["name"], "smoke");
        let url = "https://smoke.example/watch?v=1";
        let resolved = p.call("import/resolve", json!({ "url": url }), &never, &mut quiet);
        assert_eq!(resolved.unwrap()["title"], "Smoke import");

        let mut notes = Vec::new();
        let ran = p
            .call(
                "import/run",
                json!({ "url": url, "outDir": out }),
                &never,
                &mut |method: &str, _: &Value| notes.push(method.to_string()),
            )
            .unwrap();
        assert_eq!(ran["files"][1]["lang"], "en");
        assert_eq!(notes, ["progress"]);
        assert_eq!(
            std::fs::read_to_string(out.join("audio.mp3")).unwrap(),
            "mp3"
        );
        let vtt = std::fs::read_to_string(out.join("audio.en.vtt")).unwrap();
        assert!(
            vtt.starts_with("WEBVTT\n\n00:00:00.000 --> 00:00:02.600\n"),
            "{vtt}"
        );
        assert!(vtt.ends_with("Shadowing means repeating.\n"), "{vtt}");
    }
}
