#!/usr/bin/env bash
# Builds a plugin from plugins/<name> into a folder the app installs from
# (设置 → 插件 → 从文件夹安装…): plugins/<name>/dist/<id>/ with manifest.json and bin/.
# Usage: scripts/build-plugin.sh youtube
set -euo pipefail
name="${1:?usage: scripts/build-plugin.sh <plugin folder name, e.g. youtube>}"
cd "$(dirname "$0")/../plugins/$name"
cargo build --release --quiet
target=$(cargo metadata --format-version 1 --no-deps \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).target_directory))')
id=$(node -p 'require("./manifest.json").id')
bin=$(node -p 'Object.values(require("./manifest.json").main)[0]')
out="dist/$id"
rm -rf "$out"
mkdir -p "$out/$(dirname "$bin")"
cp manifest.json "$out/"
cp "$target/release/shadowing-$name" "$out/$bin"
echo "$(pwd)/$out"
