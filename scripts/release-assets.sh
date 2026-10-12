#!/usr/bin/env bash
# Turns a release build into the files a GitHub Release carries, in <out dir>:
#   Shadowing-X.Y.Z-macos-arm64.dmg / .zip, the same under fixed names (Shadowing-macos-arm64.dmg / .zip, for
#   releases/latest/download/... links), and, when the build made the signed update, Shadowing-X.Y.Z-macos-arm64.app.tar.gz,
#   its .sig and latest.json. Also notes.md (release notes with the DMG's SHA-256), which is not uploaded as a file.
# Used by .github/workflows/release.yml and scripts/release-local.sh.
# Usage: scripts/release-assets.sh <X.Y.Z> <tauri bundle dir, e.g. src-tauri/target/release/bundle> <out dir>
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?usage: scripts/release-assets.sh <X.Y.Z> <bundle dir> <out dir>}"
bundle="${2:?missing bundle dir}"
out="${3:?missing out dir}"
repo="${GITHUB_REPOSITORY:-mxggle/shadowing}"
mkdir -p "$out"

app="$bundle/macos/Shadowing.app"
built=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Contents/Info.plist")
[ "$built" = "$version" ] || { echo "the built app is $built, not $version" >&2; exit 1; }
lipo -archs "$app/Contents/MacOS/shadowing"

base="Shadowing-$version-macos-arm64"
ditto -c -k --keepParent "$app" "$out/$base.zip"
cp "$out/$base.zip" "$out/Shadowing-macos-arm64.zip"

dmgs=("$bundle"/dmg/Shadowing_"$version"_*.dmg)
[ ${#dmgs[@]} = 1 ] && [ -f "${dmgs[0]}" ] || { echo "expected one DMG for $version in $bundle/dmg" >&2; exit 1; }
cp "${dmgs[0]}" "$out/$base.dmg"
hdiutil verify "$out/$base.dmg"
cp "$out/$base.dmg" "$out/Shadowing-macos-arm64.dmg"

if [ -f "$bundle/macos/Shadowing.app.tar.gz" ]; then
  cp "$bundle/macos/Shadowing.app.tar.gz" "$out/$base.app.tar.gz"
  cp "$bundle/macos/Shadowing.app.tar.gz.sig" "$out/$base.app.tar.gz.sig"
  scripts/update-manifest.sh "$version" "$out/$base.app.tar.gz.sig" \
    "https://github.com/$repo/releases/download/v$version/$base.app.tar.gz" > "$out/latest.json"
fi

scripts/release-notes.sh "$version" "$(shasum -a 256 "$out/$base.dmg" | cut -d' ' -f1)" > "$out/notes.md"
ls -l "$out"
