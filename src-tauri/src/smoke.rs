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

/// A fake 从链接导入 plugin (a shell script) that “downloads” one of the smoke
/// folder's files, so the whole import path runs in the real app without the network.
pub fn install_plugin(data: &Path, folder: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::remove_dir_all(folder.join(IMPORTS));
    let dir = data.join("plugins").join("smoke-import");
    std::fs::create_dir_all(dir.join("bin"))?;
    let platform = crate::plugins::manifest::platform();
    std::fs::write(
        dir.join("manifest.json"),
        format!(
            r#"{{"id":"smoke-import","name":"Smoke","version":"0.0.1","protocol":1,
            "main":{{"{platform}":"bin/run"}},
            "contributes":{{"importers":[{{"id":"fake","title":"Smoke","match":["https://smoke.example/*"]}}]}}}}"#
        ),
    )?;
    let source = folder.join("02 English VBR.mp3");
    let script = r#"#!/bin/sh
while read -r line; do
  id=$(printf '%s' "$line" | sed -E 's/.*"id":([0-9]+).*/\1/')
  case "$line" in
    *'"method":"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"name":"smoke"}}\n' "$id" ;;
    *'"method":"import/resolve"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"title":"Smoke import","duration":7,"subtitles":[{"lang":"en","name":"English"}]}}\n' "$id" ;;
    *'"method":"import/run"'*)
      out=$(printf '%s' "$line" | sed -E 's/.*"outDir":"([^"]*)".*/\1/')
      printf '{"jsonrpc":"2.0","method":"progress","params":{"message":"copying","done":1,"total":2}}\n'
      cp "$SOURCE" "$out/audio.mp3"
      printf 'WEBVTT\n\n00:00:00.000 --> 00:00:02.600\nThe quick brown fox.\n\n00:00:02.900 --> 00:00:07.500\nShadowing means repeating.\n' > "$out/audio.en.vtt"
      printf '{"jsonrpc":"2.0","id":%s,"result":{"files":[{"path":"audio.mp3","kind":"audio"},{"path":"audio.en.vtt","kind":"subtitle","lang":"en"}]}}\n' "$id" ;;
  esac
done
"#;
    let script = script.replace("\"$SOURCE\"", &format!("'{}'", source.to_string_lossy()));
    let program = dir.join("bin/run");
    std::fs::write(&program, script)?;
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755))
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
