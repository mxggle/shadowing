#!/usr/bin/env bash
# Builds a debug app bundle and runs the in-app playback self-test against a folder.
# Usage: npm run smoke -- <audio folder>
set -euo pipefail
folder="${1:?usage: npm run smoke -- <audio folder>}"
cd "$(dirname "$0")/.."
npx tauri build --debug --bundles app >/dev/null
target=$(cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --no-deps \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).target_directory))')
SHADOWING_SMOKE="$folder" "$target/debug/bundle/macos/Shadowing.app/Contents/MacOS/shadowing" | grep --line-buffered '^\[web\]'
