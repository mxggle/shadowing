#!/usr/bin/env bash
# latest.json for the in-app updater: version, notes (the CHANGELOG section), and per platform the signed update
# and its signature: darwin-aarch64 (the .app.tar.gz) and, when the release has Windows, windows-x86_64 (the
# setup .exe). The app reads it from the newest published release
# (https://github.com/<repo>/releases/latest/download/latest.json), so a draft changes nothing. Every app parses
# every entry (one bad URL breaks the check on both systems), so this refuses anything but https URLs and signatures.
# Usage: scripts/update-manifest.sh <X.Y.Z> <platform> <its .sig file> <its download URL> [<platform> <sig> <url>]...
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?usage: scripts/update-manifest.sh <X.Y.Z> <platform> <sig file> <url> [...]}"
shift
[ $# -gt 0 ] && [ $(($# % 3)) = 0 ] || { echo "update-manifest: give <platform> <sig file> <url> for each platform" >&2; exit 1; }
entries=()
while [ $# -gt 0 ]; do
  entries+=("$1" "$(cat "$2")" "$3")
  shift 3
done

NOTES="$(scripts/release-notes.sh --changes "$version")" VERSION="$version" node -e '
  const { VERSION, NOTES } = process.env;
  const known = ["darwin-aarch64", "windows-x86_64"];
  const platforms = {};
  const args = process.argv.slice(1);
  for (let i = 0; i < args.length; i += 3) {
    const [platform, signature, url] = args.slice(i, i + 3);
    const fail = (why) => { console.error(`update-manifest: ${platform}: ${why}`); process.exit(1); };
    if (!known.includes(platform)) fail(`not one of ${known.join(", ")}`);
    if (platforms[platform]) fail("given twice");
    if (!signature.trim()) fail("empty signature");
    try { if (new URL(url).protocol !== "https:") fail(`not https: ${url}`); } catch { fail(`not a URL: ${url}`); }
    platforms[platform] = { signature, url };
  }
  const manifest = {
    version: VERSION,
    notes: NOTES,
    pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    platforms,
  };
  console.log(JSON.stringify(manifest, null, 2));
' "${entries[@]}"
