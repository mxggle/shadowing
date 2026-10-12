#!/usr/bin/env bash
# Builds a debug app bundle and runs the in-app playback self-test against a folder.
# Usage: npm run smoke -- <audio folder>
set -euo pipefail
folder="${1:?usage: npm run smoke -- <audio folder>}"
cd "$(dirname "$0")/.."
# No signed update for a test build (that needs the updater's private key).
npx tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}' >/dev/null
target=$(cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --no-deps \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).target_directory))')
# Fake transcription server for the end-to-end transcription check (port must match src/dev/smoke.ts).
python3 scripts/fake-whisper.py 18765 &
fake=$!
trap 'kill $fake 2>/dev/null' EXIT
# Local transcription uses already-downloaded models (debug builds only); skipped if none.
SHADOWING_MODELS_DIR="$HOME/Library/Application Support/dev.shadowing.app/models" \
SHADOWING_SMOKE="$folder" "$target/debug/bundle/macos/Shadowing.app/Contents/MacOS/shadowing" | grep --line-buffered '^\[web\]'
