#!/usr/bin/env bash
# Builds a plugin from plugins/<name> into a folder the app installs from
# (设置 → 插件 → 从文件夹安装…): manifest.json and bin/, for one platform.
# Usage: scripts/build-plugin.sh youtube [rust target]
#   no target: this computer → plugins/<name>/dist/<id>/
#   a target (e.g. x86_64-pc-windows-msvc, or x86_64-pc-windows-gnu with mingw-w64 on a Mac)
#            → plugins/<name>/dist/<platform>/<id>/
# The manifest in the folder lists only the platform built, so the app says plainly that
# the plugin doesn't support another computer. Works on macOS and in Git Bash on Windows.
set -euo pipefail
name="${1:?usage: scripts/build-plugin.sh <plugin folder name, e.g. youtube> [rust target]}"
target="${2:-}"
cd "$(dirname "$0")/../plugins/$name"
triple="${target:-$(rustc -vV | sed -n 's/^host: //p')}"
case "$triple" in
  aarch64-apple-darwin) platform=darwin-arm64 ;;
  x86_64-apple-darwin) platform=darwin-x86_64 ;;
  x86_64-pc-windows-*) platform=windows-x86_64 ;;
  aarch64-pc-windows-*) platform=windows-arm64 ;;
  *) echo "no plugin platform for $triple" >&2; exit 1 ;;
esac
case "$platform" in windows-*) exe=.exe ;; *) exe= ;; esac

if [ -n "$target" ]; then
  cargo build --release --quiet --target "$target"
  release=$target/release
  out="dist/$platform"
else
  cargo build --release --quiet
  release=release
  out=dist
fi
target_dir=$(cargo metadata --format-version 1 --no-deps \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).target_directory))')
if command -v cygpath > /dev/null; then target_dir=$(cygpath -u "$target_dir"); fi
id=$(node -p 'require("./manifest.json").id')
bin=$(node -p "require('./manifest.json').main['$platform'] || ''")
if [ -z "$bin" ]; then
  echo "manifest.json has no program for $platform (main.$platform)" >&2
  exit 1
fi
out="$out/$id"
rm -rf "$out"
mkdir -p "$out/$(dirname "$bin")"
node -e '
  const [from, to, platform] = process.argv.slice(1);
  const m = JSON.parse(require("fs").readFileSync(from, "utf8"));
  m.main = { [platform]: m.main[platform] };
  require("fs").writeFileSync(to, JSON.stringify(m, null, 2) + "\n");
' manifest.json "$out/manifest.json" "$platform"
cp "$target_dir/$release/shadowing-$name$exe" "$out/$bin"
# A Windows path in Git Bash, to paste into the app's folder picker.
echo "$(pwd -W 2> /dev/null || pwd)/$out"
