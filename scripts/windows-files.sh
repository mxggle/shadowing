#!/usr/bin/env bash
# Waits for the Windows build of <ref> (.github/workflows/release-windows.yml, on Actions: 15–25 minutes) and
# downloads its files into <dir>: Shadowing-X.Y.Z-windows-x64-setup.exe, its .sig and the YouTube plugin zip.
# <ref> is the release's tag, or a feat/windows* branch for a dry run; the run must be of the commit checked out
# here. scripts/release-assets.sh then adds the files to the Mac ones.
# Used by scripts/release-local.sh and .github/workflows/release.yml (needs gh, logged in or with GH_TOKEN).
# Usage: scripts/windows-files.sh <tag or branch> <dir>
set -euo pipefail
cd "$(dirname "$0")/.."
ref="${1:?usage: scripts/windows-files.sh <tag or branch> <dir>}"
dir="${2:?missing dir}"
repo="${GITHUB_REPOSITORY:-mxggle/shadowing}"
version=$(scripts/check-version.sh)
sha=$(git rev-parse HEAD)
fail() { echo "windows-files: $*" >&2; exit 1; }

# A tag's run shows up a few seconds after the push.
run=""
for _ in $(seq 30); do
  run=$(gh run list -R "$repo" -w release-windows.yml --branch "$ref" --commit "$sha" -L 1 \
    --json databaseId --jq '.[0].databaseId // empty')
  [ -n "$run" ] && break
  sleep 10
done
[ -n "$run" ] || fail "no Windows build of $ref at ${sha:0:7}: is the tag pushed?"

url="https://github.com/$repo/actions/runs/$run"
echo "waiting for the Windows build: $url"
while [ "$(gh run view "$run" -R "$repo" --json status --jq .status)" != completed ]; do sleep 30; done
case "$(gh run view "$run" -R "$repo" --json conclusion --jq .conclusion)" in
  success) ;;
  skipped) fail "the Windows build was skipped: the WINDOWS_RELEASE variable isn't \"true\"" ;;
  *) fail "the Windows build failed: $url (rerun it with gh run rerun $run --failed, then run this again)" ;;
esac
# A run whose job was skipped (WINDOWS_RELEASE not set when the tag was pushed) can still say success.
[ "$(gh run view "$run" -R "$repo" --json jobs --jq '[.jobs[] | select(.conclusion == "success")] | length')" -gt 0 ] ||
  fail "the Windows build was skipped: the WINDOWS_RELEASE variable wasn't \"true\" when $ref was pushed"

mkdir -p "$dir"
gh run download "$run" -R "$repo" -n "Shadowing-$version-windows-x64" -D "$dir"
ls -l "$dir"
