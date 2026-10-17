#!/bin/bash
# Shadowing 一键安装：下载最新版，装进“应用程序”，然后打开。
# 在“终端”里粘贴这一行，按回车：
#
#   curl -fsSL https://shadowing.nihongo.day/install.sh | bash
#
# 为什么要这样装：应用还没有 Apple 公证，浏览器下载的安装包会被打上“隔离”标记，macOS 打开时就可能说“已损坏”。
# curl 下载的文件没有这个标记，所以这样装好就能直接打开。脚本不改任何系统设置，再运行一次就是重新安装最新版。
# 测试用：SHADOWING_INSTALL_DIR=<文件夹> 装到别处；SHADOWING_NO_LAUNCH=1 不关掉正在运行的应用、装完也不打开。
#
# 整个脚本放在 main 里、最后一行才调用：下载到一半断了的话什么都不会执行。
# shellcheck disable=SC1111  # 中文引号是文案的一部分
set -eEuo pipefail

URL="https://github.com/mxggle/shadowing/releases/latest/download/Shadowing-macos-arm64.dmg"
# 只装用 Shadowing 自己的证书签名的应用（scripts/release-assets.sh 用的“Shadowing Code Signing”，有效期到 2036 年；
# H"…" 是它的 SHA-1）。安装包万一被换掉，这里会拒绝，而不是绕过系统检查把它装上打开。换签名证书时这里要一起改。
REQ='identifier "dev.shadowing.app" and certificate leaf = H"07bf6eb3d5708fe1a8501e95f0e576ff9c0eb848"'

if [ -t 1 ]; then B=$'\033[1m' R=$'\033[31m' G=$'\033[32m' N=$'\033[0m'; else B="" R="" G="" N=""; fi
step() { printf '%s==>%s %s\n' "$B" "$N" "$*"; }
fail() {
  printf '\n%s安装没有完成：%s%s\n' "$R" "$N" "$*" >&2
  printf '可以把这个窗口截图发给开发者。\n' >&2
  exit 1
}

tmp="" mnt="" elevated=""
trap 'fail "出了意外的错误（第 $LINENO 行）。"' ERR
cleanup() {
  if [ -n "$mnt" ]; then hdiutil detach -quiet "$mnt" 2>/dev/null || hdiutil detach -quiet -force "$mnt" 2>/dev/null || true; fi
  if [ -n "$tmp" ]; then
    rm -rf "$tmp" 2>/dev/null || true
    # 用 sudo 挪进来的旧版本普通权限删不掉；sudo 刚输过密码，-n 不会再问。
    if [ -n "$elevated" ] && [ -e "$tmp" ]; then sudo -n rm -rf "$tmp" 2>/dev/null || true; fi
  fi
}

# 挪动整个 .app（同一个磁盘上只是改名，要么成功要么原样不动）。没有权限时才用 sudo，第一次会要密码。
move() {
  mv "$1" "$2" 2>/dev/null && return 0
  if [ -z "$elevated" ]; then
    step "装进这个文件夹需要这台 Mac 的登录密码（输入时屏幕上不显示，输完按回车）："
    elevated=1
  fi
  sudo mv "$1" "$2"
}

# curl 不看“系统设置”里的代理。平时开着代理上 GitHub 的，照着系统代理来（已经设了 https_proxy 等就不动）。
proxy_field() { printf '%s\n' "$1" | awk -v k="$2" '$1 == k { print $3; exit }'; }
system_proxy=""
use_system_proxy() {
  if [ -n "${https_proxy:-}${HTTPS_PROXY:-}${all_proxy:-}${ALL_PROXY:-}" ]; then return 0; fi
  local p
  p=$(scutil --proxy 2>/dev/null) || return 0
  if [ "$(proxy_field "$p" HTTPSEnable)" = 1 ] && [ -n "$(proxy_field "$p" HTTPSProxy)" ] && [ -n "$(proxy_field "$p" HTTPSPort)" ]; then
    system_proxy="http://$(proxy_field "$p" HTTPSProxy):$(proxy_field "$p" HTTPSPort)"
    export https_proxy="$system_proxy"
  elif [ "$(proxy_field "$p" SOCKSEnable)" = 1 ] && [ -n "$(proxy_field "$p" SOCKSProxy)" ] && [ -n "$(proxy_field "$p" SOCKSPort)" ]; then
    system_proxy="socks5h://$(proxy_field "$p" SOCKSProxy):$(proxy_field "$p" SOCKSPort)"
    export all_proxy="$system_proxy"
  fi
  return 0
}

download() { curl -fL --progress-bar --retry 2 --connect-timeout 20 -o "$tmp/Shadowing.dmg" "$URL" </dev/null; }

# 正在运行的 Shadowing（不管从哪里打开的）先关掉，不然替换后打开的还是旧的那个。按进程名找（应用里的可执行文件叫 shadowing），
# 不按命令行找：命令行里提到这个路径的别的进程（比如终端里的命令）不能误杀。
running() { pgrep -x shadowing 2>/dev/null || true; }
quit_running() {
  local pids
  pids=$(running)
  [ -n "$pids" ] || return 0
  step "先关掉正在运行的 Shadowing…"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -n "$(running)" ] || return 0
    sleep 0.5
  done
  pkill -9 -x shadowing 2>/dev/null || true
  sleep 0.5
}

main() {
  [ "$(uname -s)" = Darwin ] || fail "这个命令只能在 Mac 上运行。"
  # 用 sysctl 而不是 uname -m：终端在 Rosetta 下运行时 uname -m 也会说 x86_64。
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ] ||
    fail "这台 Mac 是 Intel 芯片。Shadowing 目前只支持 Apple 芯片（M1 及以后）的 Mac。"

  local dest="${SHADOWING_INSTALL_DIR:-/Applications}"
  if [ -z "${SHADOWING_INSTALL_DIR:-}" ] && [ ! -w /Applications ]; then
    dest="$HOME/Applications"
    mkdir -p "$dest" || fail "没法创建 $dest。"
    step "这个账户不能往“应用程序”里装东西，改装到个人的“应用程序”（$dest）。"
  fi
  [ -d "$dest" ] || fail "找不到要安装到的文件夹：$dest"
  local app="$dest/Shadowing.app"

  trap cleanup EXIT
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/shadowing-install.XXXXXX")

  use_system_proxy
  step "正在下载最新版 Shadowing（大约 11 MB）…${system_proxy:+（使用系统代理 $system_proxy）}"
  if ! download; then
    if [ -n "$system_proxy" ]; then
      step "通过代理下载失败，改为直接连接再试一次…"
      unset https_proxy all_proxy
      download || fail "下载失败。请检查网络，然后再运行一次这行命令。"
    else
      fail "下载失败。请检查网络；如果平时打开 GitHub 需要开代理，先打开代理，再运行一次这行命令。"
    fi
  fi

  step "正在检查安装包…"
  mkdir "$tmp/mnt"
  mnt="$tmp/mnt"
  hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$tmp/Shadowing.dmg" </dev/null ||
    fail "安装包打不开，可能没下载完整。请再运行一次这行命令。"
  [ -d "$mnt/Shadowing.app" ] || fail "安装包里没有找到 Shadowing.app。"
  local version
  version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$mnt/Shadowing.app/Contents/Info.plist" 2>/dev/null || true)
  # 新版本先复制到临时文件夹并校验，通过了才去动旧版本：中途出错时旧版本还在。
  ditto "$mnt/Shadowing.app" "$tmp/new/Shadowing.app" </dev/null || fail "复制安装包失败，可能是磁盘空间不够。"
  codesign --verify --deep --strict -R "=$REQ" "$tmp/new/Shadowing.app" 2>/dev/null ||
    fail "安装包里的应用没有通过签名校验（可能没下载完整），所以没有安装。请再运行一次这行命令。"

  if [ -z "${SHADOWING_NO_LAUNCH:-}" ]; then quit_running; fi

  step "正在安装 Shadowing ${version:+$version }到 $dest …"
  # 旧版本只挪开、不删（结束时随临时文件夹删掉），新版本放不进去时再挪回来。
  if [ -e "$app" ]; then move "$app" "$tmp/old.app" || fail "没能挪开旧版本：$app"; fi
  if ! move "$tmp/new/Shadowing.app" "$app"; then
    if [ -e "$tmp/old.app" ] && [ ! -e "$app" ]; then move "$tmp/old.app" "$app" || true; fi
    fail "没能装进 $dest。"
  fi
  # 保险：curl 下载的本来就没有隔离标记，这里再清一次。
  xattr -dr com.apple.quarantine "$app" 2>/dev/null || true

  if [ -n "${SHADOWING_NO_LAUNCH:-}" ]; then
    printf '\n%s装好了：%s%s\n' "$G" "$N" "$app"
    return 0
  fi
  open "$app" || fail "已经装好了，但没能自动打开。请到“应用程序”里双击 Shadowing。"
  printf '\n%s装好了！%sShadowing %s 已经打开。\n' "$G" "$N" "$version"
  printf '以后在“启动台”或“应用程序”里点开就能用。有新版本时应用里会提示，点一下就能更新，不用再运行这行命令。\n'
}

main "$@"
