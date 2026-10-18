#!/usr/bin/env bash
# Checks the files scripts/release-assets.sh made in <out dir> before they're uploaded, so a release needs no one to
# download and look at it afterwards:
#   - every file is there, and the fixed-name DMG / zip are the same as the versioned ones;
#   - latest.json has this version, the update's download URL and the .sig's signature;
#   - the DMG's app is this version and passes site/install.sh's check (our identifier and certificate);
#   - the zip has no ._ or __MACOSX entries and its app's signature holds whether Archive Utility (ditto) or unzip
#     unpacks it (other unzipping apps leave ._ files inside, and macOS then calls the app damaged);
#   - the update's app keeps its signature once unpacked the way the updater does (decomposed file names break it).
# Used by scripts/release-local.sh.
# Usage: scripts/verify-release.sh <X.Y.Z> <out dir>
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?usage: scripts/verify-release.sh <X.Y.Z> <out dir>}"
out="${2:?missing out dir}"
repo="${GITHUB_REPOSITORY:-mxggle/shadowing}"
base="Shadowing-$version-macos-arm64"
req=$(sed -n "s/^REQ='\(.*\)'$/\1/p" site/install.sh)
[ -n "$req" ] || { echo "no REQ in site/install.sh" >&2; exit 1; }

work=$(mktemp -d)
mounted=""
cleanup() {
  if [ -n "$mounted" ]; then hdiutil detach -quiet "$mounted" || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "verify-release: $*" >&2; exit 1; }

for f in "$base.dmg" "$base.zip" Shadowing-macos-arm64.dmg Shadowing-macos-arm64.zip \
  "$base.app.tar.gz" "$base.app.tar.gz.sig" latest.json; do
  [ -s "$out/$f" ] || fail "missing $f"
done
compgen -G "$out/Shadowing-YouTube-plugin-*-macos-arm64.zip" > /dev/null || fail "missing the YouTube plugin zip"
cmp -s "$out/$base.dmg" "$out/Shadowing-macos-arm64.dmg" || fail "Shadowing-macos-arm64.dmg differs from $base.dmg"
cmp -s "$out/$base.zip" "$out/Shadowing-macos-arm64.zip" || fail "Shadowing-macos-arm64.zip differs from $base.zip"

node -e '
const [file, version, url, sig] = process.argv.slice(1);
const m = JSON.parse(require("fs").readFileSync(file, "utf8"));
const p = (m.platforms || {})["darwin-aarch64"] || {};
const bad = [];
if (m.version !== version) bad.push(`version ${m.version}`);
if (p.url !== url) bad.push(`url ${p.url}`);
if (p.signature !== sig) bad.push("signature is not the .sig");
if (bad.length) { console.error(`verify-release: latest.json: ${bad.join(", ")}`); process.exit(1); }
' "$out/latest.json" "$version" "https://github.com/$repo/releases/download/v$version/$base.app.tar.gz" \
  "$(cat "$out/$base.app.tar.gz.sig")"

check_app() { # <app> <what>
  codesign --verify --deep --strict -R "=$req" "$1" || fail "$2: signature check failed"
  local built
  built=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$1/Contents/Info.plist")
  [ "$built" = "$version" ] || fail "$2: the app is $built, not $version"
}

mkdir "$work/mnt"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$work/mnt" "$out/$base.dmg"
mounted="$work/mnt"
check_app "$work/mnt/Shadowing.app" DMG
hdiutil detach -quiet "$work/mnt"
mounted=""

if unzip -Z1 "$out/$base.zip" | grep -E '(^|/)(\._|__MACOSX)'; then fail "the zip has ._ or __MACOSX entries"; fi
mkdir "$work/ditto" "$work/unzip" "$work/update"
ditto -x -k "$out/$base.zip" "$work/ditto"
check_app "$work/ditto/Shadowing.app" "zip (ditto)"
unzip -q "$out/$base.zip" -d "$work/unzip"
check_app "$work/unzip/Shadowing.app" "zip (unzip)"

python3 -I -c 'import sys, tarfile
with tarfile.open(sys.argv[1]) as t: t.extractall(sys.argv[2])' "$out/$base.app.tar.gz" "$work/update"
check_app "$work/update/Shadowing.app" "update"

echo "verify-release: $version OK"
