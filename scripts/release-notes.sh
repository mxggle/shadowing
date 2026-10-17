#!/usr/bin/env bash
# Release notes for one version: its CHANGELOG.md section, then the install steps.
# Usage: scripts/release-notes.sh <X.Y.Z> [sha256 of the dmg]
#        scripts/release-notes.sh --changes <X.Y.Z>   — only the CHANGELOG section (shown by the in-app updater)
set -euo pipefail
cd "$(dirname "$0")/.."
changes_only=0
if [ "${1:-}" = --changes ]; then
  changes_only=1
  shift
fi
version="${1:?usage: scripts/release-notes.sh [--changes] <X.Y.Z> [sha256]}"
sha="${2:-}"
repo="${GITHUB_REPOSITORY:-mxggle/shadowing}"

# Everything under "## [X.Y.Z] - date" up to the next version heading or the link list at the end.
section=$(awk -v v="$version" '
  index($0, "## [" v "]") == 1 { on = 1; next }
  on && (/^## \[/ || /^\[[^]]+\]: /) { exit }
  on { print }
' CHANGELOG.md | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')

if [ -z "$(printf '%s' "$section" | tr -d '[:space:]')" ]; then
  echo "CHANGELOG.md has no section for $version" >&2
  exit 1
fi
if [ $changes_only = 1 ]; then
  printf '%s\n' "$section"
  exit 0
fi

cat <<EOF
$section

完整记录见 [CHANGELOG.md](https://github.com/$repo/blob/v$version/CHANGELOG.md)。

## 安装
1. 下载 \`Shadowing-$version-macos-arm64.dmg\`，双击打开，把 Shadowing 拖到旁边的“应用程序”文件夹。
2. 这个版本**没有 Apple 公证**，浏览器下载的会被系统拦下，有时提示“已损坏”。在终端运行这一行，它会重新下载、装进“应用程序”并打开：

   \`\`\`
   curl -fsSL https://shadowing.nihongo.day/install.sh | bash
   \`\`\`

   已经拖进去的也可以只运行 \`xattr -dr com.apple.quarantine /Applications/Shadowing.app\`。

装好以后有新版本时，应用打开时会提示，点“更新并重新打开”即可（也可以在菜单 Shadowing → 检查更新…），不用重新下载。
已经装了 0.4.0 或更新版本的，直接在应用里更新。也有 zip 版：\`Shadowing-$version-macos-arm64.zip\`。

只有 Apple Silicon 版；Intel Mac 和 Windows 没有构建。
EOF
if [ -n "$sha" ]; then
  printf '\nSHA-256：`%s`\n' "$sha"
fi
