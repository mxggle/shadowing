#!/usr/bin/env bash
# Sets the app version everywhere it is written (checked by scripts/check-version.sh): package.json,
# package-lock.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock and the version shown
# on the landing page (site/index.html), and the landing page's 更新 list from CHANGELOG.md (scripts/site-sync.mjs;
# rename CHANGELOG's 「未发布」 to the version first).
# Usage: scripts/bump-version.sh <X.Y.Z>
set -euo pipefail
cd "$(dirname "$0")/.."
new="${1:?usage: scripts/bump-version.sh <X.Y.Z>}"
[[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a version: $new" >&2; exit 1; }
old=$(node -p "require('./package.json').version")

NEW="$new" node -e '
  const fs = require("fs");
  const edit = (file, f) => fs.writeFileSync(file, f(fs.readFileSync(file, "utf8")));
  const json = (file, f) => edit(file, (s) => JSON.stringify(f(JSON.parse(s)), null, 2) + "\n");
  const v = process.env.NEW;
  json("package.json", (p) => ({ ...p, version: v }));
  json("package-lock.json", (p) => { p.version = v; p.packages[""].version = v; return p; });
  edit("src-tauri/tauri.conf.json", (s) => s.replace(/"version": "[^"]*"/, `"version": "${v}"`));
  edit("src-tauri/Cargo.toml", (s) => s.replace(/^version = "[^"]*"/m, `version = "${v}"`));
  edit("src-tauri/Cargo.lock", (s) => s.replace(/(name = "shadowing"\nversion = )"[^"]*"/, `$1"${v}"`));
  for (const f of ["site/index.html", "site/en.html", "site/ja.html", "site/zh-tw.html"]) {
    if (fs.existsSync(f)) edit(f, (s) => s.replace(/(<span data-app-version>v)[0-9.]+/, `$1${v}`));
  }
'
node scripts/site-sync.mjs changelog
echo "$old → $(scripts/check-version.sh)"
