#!/usr/bin/env bash
# After a release is published: the landing page's parts that need the published files (the download size and
# site/plugins.json's plugin zips with their SHA-256, scripts/site-sync.mjs) are updated on main, committed and
# pushed, so the site (Vercel deploys main) shows the new version as soon as it can be downloaded. Before publishing
# they would point at files that don't exist yet. The version number and the 更新 list went in with the release PR
# (scripts/bump-version.sh).
# Works in a throwaway worktree of origin/main, so the checkout it runs from (often a tag) is left alone.
# Run by scripts/release-local.sh after it publishes; after publishing an Actions draft, run it yourself.
# Usage: scripts/site-after-release.sh vX.Y.Z
set -euo pipefail
cd "$(dirname "$0")/.."
tag="${1:?usage: scripts/site-after-release.sh vX.Y.Z}"
repo="${GITHUB_REPOSITORY:-mxggle/shadowing}"

work=$(mktemp -d)
assets="$work/assets.json"
gh release view "$tag" -R "$repo" --json tagName,assets,isDraft > "$assets"
[ "$(node -p "require('$assets').isDraft")" = false ] || { echo "$tag is still a draft: publish it first" >&2; exit 1; }

git fetch -q origin main
git worktree add -q --detach "$work/main" origin/main
cleanup() { git worktree remove --force "$work/main" > /dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
(
  cd "$work/main"
  node scripts/site-sync.mjs release "$assets"
  node scripts/check-plugin-list.mjs
  if git diff --quiet -- site; then
    echo "site: nothing to update for $tag"
    exit 0
  fi
  git add site
  git commit -q -m "docs(site): $tag downloads and plugins on the landing page"
  git push -q origin HEAD:main
  echo "site: pushed $(git rev-parse --short HEAD) to main (Vercel deploys it)"
)
