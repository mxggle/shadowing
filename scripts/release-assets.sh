#!/usr/bin/env bash
# Signs a release build and turns it into the files a GitHub Release carries, in <out dir>:
#   Shadowing-X.Y.Z-macos-arm64.dmg / .zip, the same under fixed names (Shadowing-macos-arm64.dmg / .zip, for
#   releases/latest/download/... links), the in-app update Shadowing-X.Y.Z-macos-arm64.app.tar.gz + .sig and
#   latest.json, and notes.md (release notes with the DMG's SHA-256; not uploaded as a file).
#
# Code signing: the app is signed with our own certificate ("Shadowing Code Signing", self-signed, no Apple account).
# It doesn't stop Gatekeeper's first-launch warning, but every version then has the same signature identity, so
# macOS keeps trusting it with the API keys in the Keychain after an update (ad-hoc signed builds are a new app to
# the Keychain each time, and it asks for the login password). The certificate is a base64 .p12 in
# SHADOWING_CODESIGN_P12 with its password in SHADOWING_CODESIGN_PASSWORD; it goes into a throwaway keychain.
# The update is signed with the updater key: TAURI_SIGNING_PRIVATE_KEY (the key itself) and _PASSWORD.
# SHADOWING_UNSIGNED=1 skips both (test builds without the secrets: ad-hoc signature, no update files).
#
# Used by .github/workflows/release.yml and scripts/release-local.sh.
# Usage: scripts/release-assets.sh <X.Y.Z> <tauri bundle dir, e.g. src-tauri/target/release/bundle> <out dir>
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?usage: scripts/release-assets.sh <X.Y.Z> <bundle dir> <out dir>}"
bundle="${2:?missing bundle dir}"
out="${3:?missing out dir}"
repo="${GITHUB_REPOSITORY:-mxggle/shadowing}"
identity="Shadowing Code Signing"
mkdir -p "$out"
work=$(mktemp -d)
keychains=$(security list-keychains -d user | xargs)
cleanup() {
  # shellcheck disable=SC2086 # the saved list of keychain paths
  security list-keychains -d user -s $keychains
  if [ -f "$work/signing.keychain-db" ]; then security delete-keychain "$work/signing.keychain-db"; fi
  rm -rf "$work"
}
trap cleanup EXIT

built=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$bundle/macos/Shadowing.app/Contents/Info.plist")
[ "$built" = "$version" ] || { echo "the built app is $built, not $version" >&2; exit 1; }
ditto "$bundle/macos/Shadowing.app" "$work/Shadowing.app"
app="$work/Shadowing.app"
lipo -archs "$app/Contents/MacOS/shadowing"

if [ "${SHADOWING_UNSIGNED:-}" = 1 ]; then
  echo "::warning::SHADOWING_UNSIGNED=1: ad-hoc signature, no in-app update files."
else
  : "${SHADOWING_CODESIGN_P12:?set SHADOWING_CODESIGN_P12 and SHADOWING_CODESIGN_PASSWORD (or SHADOWING_UNSIGNED=1)}"
  : "${TAURI_SIGNING_PRIVATE_KEY:?set TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD}"
  kc="$work/signing.keychain-db"
  kc_password=$(openssl rand -hex 16)
  printf '%s' "$SHADOWING_CODESIGN_P12" | base64 --decode > "$work/cert.p12"
  security create-keychain -p "$kc_password" "$kc"
  security unlock-keychain -p "$kc_password" "$kc"
  security import "$work/cert.p12" -k "$kc" -P "$SHADOWING_CODESIGN_PASSWORD" -T /usr/bin/codesign > /dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$kc_password" "$kc" > /dev/null
  # shellcheck disable=SC2086 # the saved list of keychain paths
  security list-keychains -d user -s "$kc" $keychains
  # No hardened runtime: it is only for Apple notarization, which a self-signed certificate can't get.
  codesign --force --deep --sign "$identity" "$app"
  codesign --verify --strict "$app"
  requirement=$(codesign -d -r- "$app" 2>&1)
  echo "$requirement"
  case "$requirement" in
    *'identifier "dev.shadowing.app" and certificate leaf'*) ;;
    *) echo "unexpected designated requirement" >&2; exit 1 ;;
  esac
fi

base="Shadowing-$version-macos-arm64"
ditto -c -k --keepParent "$app" "$out/$base.zip"
cp "$out/$base.zip" "$out/Shadowing-macos-arm64.zip"

# The DMG: Shadowing.app beside a link to Applications, to drag it straight in.
mkdir "$work/dmg"
ditto "$app" "$work/dmg/Shadowing.app"
ln -s /Applications "$work/dmg/Applications"
rm -f "$out/$base.dmg"
hdiutil create -quiet -volname Shadowing -srcfolder "$work/dmg" -fs APFS -format ULFO "$out/$base.dmg"
hdiutil verify -quiet "$out/$base.dmg"
cp "$out/$base.dmg" "$out/Shadowing-macos-arm64.dmg"

if [ "${SHADOWING_UNSIGNED:-}" != 1 ]; then
  # The updater's archive: Shadowing.app at the top (the updater drops that first path component). Python's
  # tarfile, not tar: macOS tar stores file names decomposed (ご → こ + ゛), which breaks the code signature
  # of the bundled samples/ja files once the updater unpacks them.
  python3 -c 'import sys, tarfile
with tarfile.open(sys.argv[1], "w:gz") as t: t.add(sys.argv[2], arcname="Shadowing.app")' \
    "$out/$base.app.tar.gz" "$app"
  npx tauri signer sign -k "$TAURI_SIGNING_PRIVATE_KEY" -p "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" "$out/$base.app.tar.gz" > /dev/null
  scripts/update-manifest.sh "$version" "$out/$base.app.tar.gz.sig" \
    "https://github.com/$repo/releases/download/v$version/$base.app.tar.gz" > "$out/latest.json"
fi

scripts/release-notes.sh "$version" "$(shasum -a 256 "$out/$base.dmg" | cut -d' ' -f1)" > "$out/notes.md"
ls -l "$out"
