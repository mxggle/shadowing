#!/usr/bin/env bash
# Builds and uploads a release from this Mac instead of GitHub Actions (faster: local caches, faster CPU).
# Run on the tagged commit after pushing the tag. It stops the tag's Actions build (so it can't replace these
# files later), builds with the updater key, and creates the release as a draft — or publishes it with --publish,
# which is what offers the update to installed apps.
# The updater key is read from ~/.tauri/shadowing-updater.key(.password) unless TAURI_SIGNING_PRIVATE_KEY is set.
# Usage: scripts/release-local.sh vX.Y.Z [--publish]
set -euo pipefail
cd "$(dirname "$0")/.."
tag="${1:?usage: scripts/release-local.sh vX.Y.Z [--publish]}"
publish="${2:-}"
repo="${GITHUB_REPOSITORY:-mxggle/shadowing}"

version=$(scripts/check-version.sh "$tag")
[ -z "$(git status --porcelain)" ] || { echo "commit or stash your changes first" >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse "$tag^{commit}")" ] || { echo "check out $tag first" >&2; exit 1; }
git ls-remote --exit-code --tags origin "refs/tags/$tag" > /dev/null || { echo "push $tag first: git push origin $tag" >&2; exit 1; }
if gh release view "$tag" -R "$repo" > /dev/null 2>&1; then
  echo "release $tag already exists" >&2
  exit 1
fi

for run in $(gh run list -R "$repo" -w Release --branch "$tag" --json databaseId,status \
  --jq '.[] | select(.status != "completed") | .databaseId'); do
  echo "stopping the Actions build $run for $tag"
  gh run cancel "$run" -R "$repo"
done

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/shadowing-updater.key)"
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/shadowing-updater.key.password)"
  export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi
npm ci
npm run tauri build -- --bundles app,dmg

target=$(cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --no-deps \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).target_directory))')
out=$(mktemp -d)
scripts/release-assets.sh "$version" "$target/release/bundle" "$out"
test -f "$out/latest.json" || { echo "no signed update was built" >&2; exit 1; }

files=("$out"/*.dmg "$out"/*.zip "$out"/*.app.tar.gz "$out"/*.sig "$out/latest.json")
if [ "$publish" = --publish ]; then
  gh release create "$tag" "${files[@]}" -R "$repo" --verify-tag --latest --title "Shadowing $version" --notes-file "$out/notes.md"
else
  gh release create "$tag" "${files[@]}" -R "$repo" --verify-tag --draft --title "Shadowing $version" --notes-file "$out/notes.md"
  echo "Draft created; publish it on GitHub (or rerun with --publish next time)."
fi
