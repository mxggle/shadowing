#!/usr/bin/env bash
# Checks that the five places holding the app version agree, and (given a tag) that the tag matches.
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
[ $ok = 1 ] || exit 1
echo "$version"
