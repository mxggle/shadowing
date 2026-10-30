#!/usr/bin/env bash
# Checks that the places holding the app version agree (scripts/bump-version.sh changes them all), that the landing
# pages (all four languages) list CHANGELOG's newest version, and (given a tag) that the tag matches.
# Usage: scripts/check-version.sh [vX.Y.Z]   — prints the version on success.
set -euo pipefail
cd "$(dirname "$0")/.."

json() { node -p "require('./$1')$2"; }
declare -a found=(
  "package.json=$(json package.json .version)"
  "package-lock.json=$(json package-lock.json .version)"
  "package-lock.json (root package)=$(json package-lock.json ".packages[''].version")"
  "src-tauri/tauri.conf.json=$(json src-tauri/tauri.conf.json .version)"
  "src-tauri/Cargo.toml=$(sed -n 's/^version = "\(.*\)"$/\1/p' src-tauri/Cargo.toml | head -1)"
  "src-tauri/Cargo.lock=$(awk '/^name = "shadowing"$/ { getline; gsub(/version = |"/, ""); print; exit }' src-tauri/Cargo.lock)"
)
for page in site/index.html site/en.html site/ja.html site/zh-tw.html; do
  found+=("$page=$(sed -n 's/.*<span data-app-version>v\([0-9.]*\) .*/\1/p' "$page")")
done

version="${found[0]#*=}"
ok=1
for entry in "${found[@]}"; do
  if [ "${entry#*=}" != "$version" ]; then
    echo "version mismatch: ${entry%%=*} has ${entry#*=}, package.json has $version" >&2
    ok=0
  fi
done
if [ $# -gt 0 ] && [ "$1" != "v$version" ]; then
  echo "tag $1 does not match the app version $version" >&2
  ok=0
fi
# The landing pages' badge, 更新 list and headline have CHANGELOG's newest version (scripts/site-sync.mjs, run by
# bump-version.sh; it says which page is behind, or which translation site/updates.json lacks).
node scripts/site-sync.mjs changelog --check || ok=0
[ $ok = 1 ] || exit 1
echo "$version"
