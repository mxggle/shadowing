#!/usr/bin/env bash
# The Windows files of a release, from a Windows build (npx tauri build --bundles nsis), in <out dir>:
#   Shadowing-X.Y.Z-windows-x64-setup.exe: the NSIS installer (for the current user, no admin), which is also what
#     the in-app updater downloads and runs;
#   its .sig: the update's signature. tauri build makes it because tauri.windows.conf.json has createUpdaterArtifacts,
#     with the updater key in TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD); a build with --no-sign has none;
#   Shadowing-YouTube-plugin-<its version>-windows-x86_64.zip: the YouTube plugin's folder (manifest.json + bin/).
# The installer has no code signature (no certificate yet), so SmartScreen warns: "More info" → "Run anyway".
# Runs in Git Bash on the Windows runner (.github/workflows/release-windows.yml). scripts/release-assets.sh then adds
# these files to the Mac ones, with the fixed-name copy and latest.json's windows-x86_64 entry.
# Usage: scripts/release-assets-windows.sh <X.Y.Z> <tauri bundle dir, e.g. src-tauri/target/release/bundle> <out dir>
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?usage: scripts/release-assets-windows.sh <X.Y.Z> <bundle dir> <out dir>}"
bundle="${2:?missing bundle dir}"
out="${3:?missing out dir}"
mkdir -p "$out"

built="$bundle/nsis/Shadowing_${version}_x64-setup.exe"
if [ ! -f "$built" ]; then
  echo "no $built; the build has:" >&2
  ls "$bundle/nsis" >&2 || true
  exit 1
fi
setup="Shadowing-$version-windows-x64-setup.exe"
cp "$built" "$out/$setup"
if [ -f "$built.sig" ]; then
  cp "$built.sig" "$out/$setup.sig"
else
  echo "::warning::no $built.sig (built without the updater key): this installer can't be an in-app update."
fi

scripts/build-plugin.sh youtube x86_64-pc-windows-msvc > /dev/null
plugin_version=$(node -p 'require("./plugins/youtube/manifest.json").version')
# Windows' own tar (bsdtar) writes zips; Git Bash's GNU tar comes first on PATH and can't.
zip_tar=tar
if command -v cygpath > /dev/null; then zip_tar="$(cygpath -u "$SYSTEMROOT")/System32/tar.exe"; fi
"$zip_tar" -a -c -f "$out/Shadowing-YouTube-plugin-$plugin_version-windows-x86_64.zip" \
  -C plugins/youtube/dist/windows-x86_64 youtube
ls -l "$out"
