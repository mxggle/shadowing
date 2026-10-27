#!/usr/bin/env bash
# Release notes for one version: its CHANGELOG.md section, then the install steps. With the Windows installer's
# SHA-256 the steps cover Windows too; without it they're the Mac-only ones, as before Windows was released.
# Usage: scripts/release-notes.sh <X.Y.Z> [sha256 of the dmg] [sha256 of the Windows setup .exe]
#        scripts/release-notes.sh --changes <X.Y.Z>   — only the CHANGELOG section (shown by the in-app updater)
set -euo pipefail
cd "$(dirname "$0")/.."
changes_only=0
if [ "${1:-}" = --changes ]; then
  changes_only=1
  shift
fi
version="${1:?usage: scripts/release-notes.sh [--changes] <X.Y.Z> [dmg sha256] [Windows setup sha256]}"
sha="${2:-}"
win_sha="${3:-}"
repo="${GITHUB_REPOSITORY:-mxggle/shadowing}"
plugin_version=$(node -p 'require("./plugins/youtube/manifest.json").version')
furigana_version=$(node -p 'require("./plugins/furigana/manifest.json").version')

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
EOF
if [ -n "$win_sha" ]; then printf '\n### macOS（Apple Silicon）\n'; fi
cat <<EOF
1. 下载 \`Shadowing-$version-macos-arm64.dmg\`，双击打开，把 Shadowing 拖到旁边的“应用程序”文件夹。
2. 这个版本**没有 Apple 公证**，浏览器下载的会被系统拦下，有时提示“已损坏”。在终端运行这一行，它会重新下载、装进“应用程序”并打开：

   \`\`\`
   curl -fsSL https://shadowing.nihongo.day/install.sh | bash
   \`\`\`

   已经拖进去的也可以只运行 \`xattr -dr com.apple.quarantine /Applications/Shadowing.app\`。

装好以后有新版本时，应用打开时会提示，点“更新并重新打开”即可（也可以在菜单 Shadowing → 检查更新…），不用重新下载。
已经装了 0.4.0 或更新版本的，直接在应用里更新。也有 zip 版：\`Shadowing-$version-macos-arm64.zip\`。

EOF
if [ -n "$win_sha" ]; then
  cat <<EOF
只有 Apple Silicon 版，Intel Mac 没有构建。

### Windows（x64）
1. 下载 \`Shadowing-$version-windows-x64-setup.exe\`，双击运行。装在当前用户下，不需要管理员权限。
2. 安装包**没有代码签名**，Windows 会提示“Windows 已保护你的电脑”：点“更多信息”，再点“仍要运行”。

装好以后有新版本时，应用打开时会提示，点“更新并重新打开”即可（也可以在 设置 里点“检查更新”）。
要 64 位的 Windows 10 或 11；转写只能用云端服务（本机转写只在 Mac 上）。

## YouTube 导入插件
粘贴 YouTube 链接，把音频（m4a，不转码）和人工字幕导入到打开的文件夹。
1. 下载插件：Mac 是 \`Shadowing-YouTube-plugin-$plugin_version-macos-arm64.zip\`，双击解压出 \`youtube\` 文件夹；
   Windows 是 \`Shadowing-YouTube-plugin-$plugin_version-windows-x86_64.zip\`，右键“全部解压”，里面是 \`youtube\` 文件夹。
2. 在 Shadowing 里打开 设置 → 插件 → 从文件夹安装…，选这个文件夹，看过它会做什么后点「安装」。
3. 复制一个 YouTube 链接，回到 Shadowing 按 ⌘V（Windows 上是 Ctrl+V；或者点左侧列表顶上的 ＋ →「从链接导入…」）。

第一次导入时，插件会从 GitHub 下载 yt-dlp（Mac 上约 51 MB，Windows 上约 18 MB）。插件是运行在你电脑上的程序，只安装你信任的插件；只下载你有权使用的内容。

## 日语注音插件
在日语字幕的汉字上方标出读音：平假名、片假名或罗马音（设置 → 插件 里选）。词典在插件里，不联网。
1. 下载插件：Mac 是 \`Shadowing-Furigana-plugin-$furigana_version-macos-arm64.zip\`，Windows 是 \`Shadowing-Furigana-plugin-$furigana_version-windows-x86_64.zip\`，解压出 \`furigana\` 文件夹。
2. 设置 → 插件 → 从文件夹安装…，选这个文件夹，点「安装」。打开一份日语字幕就能看到；播放设置里「插件标注」可以隐藏。
EOF
else
  cat <<EOF
只有 Apple Silicon 版；Intel Mac 和 Windows 没有构建。

## YouTube 导入插件
粘贴 YouTube 链接，把音频（m4a，不转码）和人工字幕导入到打开的文件夹。
1. 下载 \`Shadowing-YouTube-plugin-$plugin_version-macos-arm64.zip\`，双击解压出 \`youtube\` 文件夹。
2. 在 Shadowing 里打开 设置 → 插件 → 从文件夹安装…，选这个文件夹，看过它会做什么后点「安装」。
3. 复制一个 YouTube 链接，回到 Shadowing 按 ⌘V（或者点左侧列表顶上的 ＋ →「从链接导入…」）。

第一次导入时，插件会从 GitHub 下载 yt-dlp（约 51 MB）。插件是运行在你 Mac 上的程序，只安装你信任的插件；只下载你有权使用的内容。

## 日语注音插件
在日语字幕的汉字上方标出读音：平假名、片假名或罗马音（设置 → 插件 里选）。词典在插件里，不联网。
1. 下载 \`Shadowing-Furigana-plugin-$furigana_version-macos-arm64.zip\`，双击解压出 \`furigana\` 文件夹。
2. 设置 → 插件 → 从文件夹安装…，选这个文件夹，点「安装」。打开一份日语字幕就能看到；播放设置里「插件标注」可以隐藏。
EOF
fi
if [ -n "$win_sha" ]; then
  printf '\nSHA-256（dmg）：`%s`\nSHA-256（Windows 安装包）：`%s`\n' "$sha" "$win_sha"
elif [ -n "$sha" ]; then
  printf '\nSHA-256：`%s`\n' "$sha"
fi
