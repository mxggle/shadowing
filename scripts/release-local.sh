#!/usr/bin/env bash
# Builds, checks and publishes a release from this Mac instead of GitHub Actions (faster: local caches, faster CPU).
# Run on the tagged commit after pushing the tag. It stops the tag's Mac build on Actions (release.yml, so it can't
# replace these files later), builds with the updater key, checks the files (scripts/verify-release.sh) and publishes
# the release, which is what offers the update to installed apps. --draft creates a draft instead.
# Windows: when the repository variable WINDOWS_RELEASE is "true", the tag also starts the Windows build on Actions
# (release-windows.yml). This waits for it after the Mac build (scripts/windows-files.sh; 15–25 minutes from the tag
# push) and publishes both together, so latest.json has both systems from the start. --mac-only leaves Windows
# out (say its build failed and the Mac release can't wait): Windows apps then stay on their version.
# The keys come from ~/.tauri unless set in the environment: the updater key (shadowing-updater.key + .password)
# and the code-signing certificate (shadowing-codesign.p12 + .password). See scripts/release-assets.sh.
# Usage: scripts/release-local.sh vX.Y.Z [--draft] [--mac-only]
set -euo pipefail
cd "$(dirname "$0")/.."
usage="usage: scripts/release-local.sh vX.Y.Z [--draft] [--mac-only]"
tag="${1:?$usage}"
shift
draft=0
mac_only=0
for arg in "$@"; do
  case "$arg" in
    --publish) ;; # from before publishing was the default: the same as no flag
    --draft) draft=1 ;;
    --mac-only) mac_only=1 ;;
    *) echo "$usage" >&2; exit 1 ;;
  esac
done
repo="${GITHUB_REPOSITORY:-mxggle/shadowing}"

version=$(scripts/check-version.sh "$tag")
[ -z "$(git status --porcelain)" ] || { echo "commit or stash your changes first" >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse "$tag^{commit}")" ] || { echo "check out $tag first" >&2; exit 1; }
git ls-remote --exit-code --tags origin "refs/tags/$tag" > /dev/null || { echo "push $tag first: git push origin $tag" >&2; exit 1; }
if gh release view "$tag" -R "$repo" > /dev/null 2>&1; then
  echo "release $tag already exists" >&2
  exit 1
fi
windows=0
if [ $mac_only = 0 ] && [ "$(gh variable list -R "$repo" --json name,value \
  --jq '.[] | select(.name == "WINDOWS_RELEASE") | .value')" = true ]; then
  windows=1
fi

# Only the Mac build: the Windows one (release-windows.yml) is where the Windows files come from.
for run in $(gh run list -R "$repo" -w release.yml --branch "$tag" --json databaseId,status \
  --jq '.[] | select(.status != "completed") | .databaseId'); do
  echo "stopping the Actions build $run for $tag"
  gh run cancel "$run" -R "$repo"
done

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/shadowing-updater.key)"
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/shadowing-updater.key.password)"
  export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi
if [ -z "${SHADOWING_CODESIGN_P12:-}" ]; then
  SHADOWING_CODESIGN_P12="$(base64 -i ~/.tauri/shadowing-codesign.p12)"
  SHADOWING_CODESIGN_PASSWORD="$(cat ~/.tauri/shadowing-codesign.p12.password)"
  export SHADOWING_CODESIGN_P12 SHADOWING_CODESIGN_PASSWORD
fi
npm ci
npm run tauri build -- --bundles app

target=$(cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --no-deps \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).target_directory))')
out=$(mktemp -d)
windows_dir=""
if [ $windows = 1 ]; then
  windows_dir="$out/windows"
  scripts/windows-files.sh "$tag" "$windows_dir"
fi
scripts/release-assets.sh "$version" "$target/release/bundle" "$out" ${windows_dir:+"$windows_dir"}
test -f "$out/latest.json" || { echo "no signed update was built" >&2; exit 1; }
scripts/verify-release.sh "$version" "$out"

files=("$out"/*.dmg "$out"/*.zip "$out"/*.app.tar.gz "$out"/*.sig "$out/latest.json")
if [ $windows = 1 ]; then files+=("$out"/*.exe); fi
if [ $draft = 1 ]; then
  gh release create "$tag" "${files[@]}" -R "$repo" --verify-tag --draft --title "Shadowing $version" --notes-file "$out/notes.md"
  echo "Draft created; publish it on GitHub."
else
  gh release create "$tag" "${files[@]}" -R "$repo" --verify-tag --latest --title "Shadowing $version" --notes-file "$out/notes.md"
  # The landing page's download size and plugin list, now that the files are there.
  scripts/site-after-release.sh "$tag"
fi
