#!/usr/bin/env bash
# Checks the files scripts/release-assets.sh made in <out dir> before they're uploaded, so a release needs no one to
# download and look at it afterwards:
#   - every file is there, and the fixed-name DMG / zip / Windows installer are the same as the versioned ones;
#   - latest.json has this version, each update's download URL and its .sig's signature, and an entry for exactly
#     the systems the release has (every app parses every entry, so a broken Windows one would stop Macs updating);
#   - each update's .sig matches its file under the updater's public key, as the app checks it (scripts/update-sig.mjs);
#   - the DMG's app is this version and passes site/install.sh's check (our identifier and certificate);
#   - the zip has no ._ or __MACOSX entries and its app's signature holds whether Archive Utility (ditto) or unzip
#     unpacks it (other unzipping apps leave ._ files inside, and macOS then calls the app damaged);
#   - the update's app keeps its signature once unpacked the way the updater does (decomposed file names break it);
#   - every plugin in scripts/release-plugins.sh has its zip, holding its folder with this computer's program;
#   - with Windows: the installer is an NSIS installer of this version, and each Windows plugin zip holds the
#     plugin's folder with a Windows program and a manifest for windows-x86_64 only, of the plugin's version.
# The Windows files are all there or all missing (a Mac-only release).
# Used by scripts/release-local.sh.
# Usage: scripts/verify-release.sh <X.Y.Z> <out dir>
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/release-plugins.sh
version="${1:?usage: scripts/verify-release.sh <X.Y.Z> <out dir>}"
out="${2:?missing out dir}"
repo="${GITHUB_REPOSITORY:-mxggle/shadowing}"
base="Shadowing-$version-macos-arm64"
setup="Shadowing-$version-windows-x64-setup.exe"
download="https://github.com/$repo/releases/download/v$version"
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
# plugin_check <zip> <folder> <program inside it> <main key>: the plugin's folder, its program and a manifest for that
# platform only, of the plugin's version.
plugin_check() {
  local zip="$1" folder="$2" program="$3" platform="$4" id entries
  id=$(node -p "require('./plugins/$folder/manifest.json').id")
  entries=$(unzip -Z1 "$out/$zip")
  for f in "$id/manifest.json" "$id/$program"; do
    grep -qx "$f" <<< "$entries" || fail "$zip has no $f"
  done
  unzip -p "$out/$zip" "$id/manifest.json" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const [zip, platform, program, version] = process.argv.slice(1);
    const m = JSON.parse(s);
    const want = JSON.stringify({ [platform]: program });
    if (JSON.stringify(m.main) !== want) {
      console.error(`verify-release: ${zip}: the manifest has main ${JSON.stringify(m.main)}`);
      process.exit(1);
    }
    if (m.version !== version) {
      console.error(`verify-release: ${zip} is ${m.version}, not ${version}`);
      process.exit(1);
    }
  });' "$zip" "$platform" "$program" "$(node -p "require('./plugins/$folder/manifest.json').version")"
}
for entry in "${release_plugins[@]}"; do
  folder="${entry%%:*}"
  zip=$(plugin_zip "$folder" macos-arm64)
  [ -s "$out/$zip" ] || fail "missing $zip"
  plugin_check "$zip" "$folder" "bin/shadowing-$folder" darwin-arm64
done
cmp -s "$out/$base.dmg" "$out/Shadowing-macos-arm64.dmg" || fail "Shadowing-macos-arm64.dmg differs from $base.dmg"
cmp -s "$out/$base.zip" "$out/Shadowing-macos-arm64.zip" || fail "Shadowing-macos-arm64.zip differs from $base.zip"

win_files=("$setup" "$setup.sig" Shadowing-windows-x64-setup.exe)
for entry in "${release_plugins[@]}"; do win_files+=("$(plugin_zip "${entry%%:*}" windows-x86_64)"); done
windows=0
for f in "${win_files[@]}"; do
  if [ -e "$out/$f" ]; then windows=1; fi
done
if [ $windows = 1 ]; then
  for f in "${win_files[@]}"; do
    [ -s "$out/$f" ] || fail "missing $f (the other Windows files are there)"
  done
  cmp -s "$out/$setup" "$out/Shadowing-windows-x64-setup.exe" || fail "Shadowing-windows-x64-setup.exe differs from $setup"
fi

expected=(darwin-aarch64 "$download/$base.app.tar.gz" "$(cat "$out/$base.app.tar.gz.sig")")
if [ $windows = 1 ]; then expected+=(windows-x86_64 "$download/$setup" "$(cat "$out/$setup.sig")"); fi
node -e '
const [file, version, ...rest] = process.argv.slice(1);
const m = JSON.parse(require("fs").readFileSync(file, "utf8"));
const platforms = m.platforms || {};
const bad = [];
if (m.version !== version) bad.push(`version ${m.version}`);
const want = new Set();
for (let i = 0; i < rest.length; i += 3) {
  const [key, url, sig] = rest.slice(i, i + 3);
  want.add(key);
  const p = platforms[key];
  if (!p) { bad.push(`no ${key}`); continue; }
  if (p.url !== url) bad.push(`${key} url ${p.url}`);
  if (p.signature !== sig) bad.push(`${key} signature is not the .sig`);
}
for (const key of Object.keys(platforms)) if (!want.has(key)) bad.push(`${key} has no files in this release`);
if (bad.length) { console.error(`verify-release: latest.json: ${bad.join(", ")}`); process.exit(1); }
' "$out/latest.json" "$version" "${expected[@]}"

updates=("$out/$base.app.tar.gz" "$out/$base.app.tar.gz.sig")
if [ $windows = 1 ]; then updates+=("$out/$setup" "$out/$setup.sig"); fi
node scripts/update-sig.mjs "${updates[@]}" || fail "an update's signature doesn't match the updater's public key"

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

if [ $windows = 1 ]; then
  # The installer's version resource (VS_VERSIONINFO, UTF-16): ProductVersion is the app version.
  node -e '
  const [file, version] = process.argv.slice(1);
  const b = require("fs").readFileSync(file);
  const fail = (why) => { console.error(`verify-release: ${file}: ${why}`); process.exit(1); };
  if (b.toString("latin1", 0, 2) !== "MZ") fail("not a Windows program");
  if (!b.includes("Nullsoft")) fail("not an NSIS installer");
  const key = Buffer.from("ProductVersion\0", "utf16le");
  let at = b.indexOf(key);
  if (at < 0) fail("no ProductVersion");
  at += key.length;
  while (at + 1 < b.length && b.readUInt16LE(at) === 0) at += 2;
  let end = at;
  while (end + 1 < b.length && b.readUInt16LE(end) !== 0) end += 2;
  const built = b.toString("utf16le", at, end);
  if (built !== version) fail(`the installer is ${built}, not ${version}`);
  ' "$out/$setup" "$version"

  for entry in "${release_plugins[@]}"; do
    folder="${entry%%:*}"
    zip=$(plugin_zip "$folder" windows-x86_64)
    plugin_check "$zip" "$folder" "bin/shadowing-$folder.exe" windows-x86_64
    id=$(node -p "require('./plugins/$folder/manifest.json').id")
    [ "$(unzip -p "$out/$zip" "$id/bin/shadowing-$folder.exe" | head -c 2)" = MZ ] ||
      fail "$zip: shadowing-$folder.exe isn't a Windows program"
  done
fi

echo "verify-release: $version OK$([ $windows = 1 ] && echo " (macOS and Windows)")"
