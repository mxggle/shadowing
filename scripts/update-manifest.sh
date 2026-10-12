#!/usr/bin/env bash
# latest.json for the in-app updater: version, notes (the CHANGELOG section), and the signed
# .app.tar.gz for Apple Silicon. The app reads it from the newest published release
# (https://github.com/<repo>/releases/latest/download/latest.json), so a draft changes nothing.
# Usage: scripts/update-manifest.sh <X.Y.Z> <the .app.tar.gz's .sig file> <its download URL>
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?usage: scripts/update-manifest.sh <X.Y.Z> <sig file> <url>}"
sig_file="${2:?missing .sig file}"
url="${3:?missing download URL}"

NOTES="$(scripts/release-notes.sh --changes "$version")" \
SIGNATURE="$(cat "$sig_file")" \
VERSION="$version" URL="$url" \
node -e '
  const { VERSION, NOTES, SIGNATURE, URL } = process.env;
  const manifest = {
    version: VERSION,
    notes: NOTES,
    pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    platforms: { "darwin-aarch64": { signature: SIGNATURE, url: URL } },
  };
  console.log(JSON.stringify(manifest, null, 2));
'
