#!/bin/bash
# CrossPet 一条命令安装 / 更新 / 卸载（不用 git、不用编译、第一次打开也不用去「隐私与安全性」里放行）
#
#   安装或更新：curl -fsSL https://raw.githubusercontent.com/lokicorvus/crosspet/main/get.sh | bash
#   卸载：      curl -fsSL https://raw.githubusercontent.com/lokicorvus/crosspet/main/get.sh | bash -s -- uninstall
#
# 做的事：从 GitHub Releases 下载最新的 CrossPet.zip → 装进「应用程序」→ 打开 → 逐个问你要接入哪些 AI。
# 为什么不用放行：macOS 只拦带「从网上下载」标记的文件，浏览器下载的会带，curl 下载的不会。
# 接入 AI 用的是同一版本的源码里的 tools/integrate.py（下载到临时文件夹，用完就删），只添加 CrossPet 自己的条目，改动前都会备份。
#
# 可选环境变量（一般用不到）：
#   CROSSPET_CONNECT="codex,claude-mod"   不逐个问，直接接入这些（all = 全部，none = 都不接）
#   CROSSPET_APP_DIR=/path                 装到别的文件夹（这时不会关掉正在运行的 CrossPet，也不动别处的旧版）
#   CROSSPET_NO_OPEN=1                     装完不自动打开
set -euo pipefail

REPO_SLUG="lokicorvus/crosspet"
ACTION="${1:-install}"
TARGETS="claude-mod claude-hooks codex deepseek antigravity gemini"

bold() { printf "\n\033[1m%s\033[0m\n" "$1"; }
die() { printf "\n\033[31m%s\033[0m\n" "$1" >&2; exit 1; }

# 通过 curl | bash 运行时，标准输入是脚本本身，提问要从终端读
ask() {
  local a=""
  if [ -r /dev/tty ]; then printf "%s [y/N] " "$1" > /dev/tty; read -r a < /dev/tty || a=""; fi
  [ "$a" = "y" ] || [ "$a" = "Y" ]
}

[ "$(uname)" = "Darwin" ] || die "CrossPet 只支持 macOS。"
major=$(sw_vers -productVersion | cut -d. -f1)
[ "$major" -ge 13 ] || die "CrossPet 需要 macOS 13 或以上（你的是 $(sw_vers -productVersion)）。"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 最新版本号：releases/latest 会跳转到 .../releases/tag/vX.Y.Z
latest_tag() {
  curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO_SLUG/releases/latest" | sed 's#.*/tag/##'
}

# 下载同一版本的源码，里面有接入工具
fetch_source() {
  local tag="$1"
  curl -fsSL "https://github.com/$REPO_SLUG/archive/refs/tags/$tag.tar.gz" | tar -xz -C "$TMP"
  SRC=$(find "$TMP" -maxdepth 1 -type d -name 'crosspet-*' | head -1)
  [ -n "$SRC" ] || die "下载源码失败。"
}

have_python() { command -v python3 >/dev/null 2>&1 && python3 -c 'import sys' >/dev/null 2>&1; }

if [ "$ACTION" = "uninstall" ]; then
  bold "卸载 CrossPet"
  [ -n "${CROSSPET_APP_DIR:-}" ] || pkill -x CrossPet 2>/dev/null || true
  if have_python; then
    fetch_source "$(latest_tag)"
    for t in $TARGETS; do python3 "$SRC/tools/integrate.py" uninstall "$t"; done
  else
    echo "没有 python3，跳过撤销 AI 接入（各 AI 的配置里 CrossPet 的条目需要手动删）。"
  fi
  if [ -n "${CROSSPET_APP_DIR:-}" ]; then rm -rf "$CROSSPET_APP_DIR/CrossPet.app"
  else rm -rf "/Applications/CrossPet.app" "$HOME/Applications/CrossPet.app"; fi
  if ask "要删除你的角色和设置吗（~/Library/Application Support/CrossPet，包括自己加的角色）？"; then
    rm -rf "$HOME/Library/Application Support/CrossPet"
    defaults delete io.github.crosspet 2>/dev/null || true
  fi
  rm -rf /tmp/crosspet
  bold "已卸载 CrossPet。"
  exit 0
fi

[ "$ACTION" = "install" ] || die "不认识的参数：$ACTION（可以用 install 或 uninstall）"

bold "1/3 下载最新版"
TAG=$(latest_tag)
[ -n "$TAG" ] || die "查不到最新版本，检查一下网络。"
echo "最新版本：$TAG"
curl -fL --progress-bar -o "$TMP/CrossPet.zip" "https://github.com/$REPO_SLUG/releases/download/$TAG/CrossPet.zip"
ditto -x -k "$TMP/CrossPet.zip" "$TMP/app"
[ -d "$TMP/app/CrossPet.app" ] || die "下载的安装包不完整，再试一次。"

bold "2/3 安装"
if [ -n "${CROSSPET_APP_DIR:-}" ]; then DEST="$CROSSPET_APP_DIR"
elif [ -w /Applications ]; then DEST="/Applications"
else DEST="$HOME/Applications"; fi
mkdir -p "$DEST"
if [ -z "${CROSSPET_APP_DIR:-}" ]; then   # 装在默认位置：先关掉正在运行的旧版
  pkill -x CrossPet 2>/dev/null || true
  sleep 0.5
fi
rm -rf "$DEST/CrossPet.app"
ditto "$TMP/app/CrossPet.app" "$DEST/CrossPet.app"
xattr -dr com.apple.quarantine "$DEST/CrossPet.app" 2>/dev/null || true
# 装在默认位置时，另一个默认位置留着的旧版删掉，免得打开错（指定了 CROSSPET_APP_DIR 时不动别处）
if [ -z "${CROSSPET_APP_DIR:-}" ]; then
  for other in /Applications "$HOME/Applications"; do
    if [ "$other" != "$DEST" ] && [ -d "$other/CrossPet.app" ]; then rm -rf "$other/CrossPet.app"; echo "已删除旧位置的 $other/CrossPet.app"; fi
  done
fi
echo "已安装到 $DEST/CrossPet.app"
[ -n "${CROSSPET_NO_OPEN:-}" ] || open "$DEST/CrossPet.app"

bold "3/3 接入 AI"
if ! have_python; then
  echo "接入 AI 需要 python3。没有的话先运行 xcode-select --install 装上苹果命令行工具，再重新运行这条命令。"
  echo "不接也能用：切到各个 AI 的 App 时照样会换角色。"
  exit 0
fi
fetch_source "$TAG"
INTEGRATE="$SRC/tools/integrate.py"
already=$(cd "$SRC/tools" && python3 -c 'import integrate; print(" ".join(integrate.installed()))')
if [ -n "$already" ]; then
  echo "已经接入：$already（按新版刷新一遍）"
  python3 "$INTEGRATE" refresh >/dev/null
fi
want() {  # 要不要接入 $1（问题是 $2）
  case " $already " in *" $1 "*) return 1 ;; esac
  if [ -n "${CROSSPET_CONNECT:-}" ]; then
    [ "$CROSSPET_CONNECT" = "all" ] && return 0
    case ",$CROSSPET_CONNECT," in *",$1,"*) return 0 ;; *) return 1 ;; esac
  fi
  ask "$2"
}
case " $already " in
  *" claude-mod "*|*" claude-hooks "*) ;;
  *)
    if want claude-mod "接入 Claude Code 增强版 mod（能显示额度，需要 Claude Code 2.1.28x 以上）？"; then
      python3 "$INTEGRATE" install claude-mod
    elif want claude-hooks "  或者接入 Claude Code 标准钩子（所有版本可用，不显示额度）？"; then
      python3 "$INTEGRATE" install claude-hooks
    fi ;;
esac
want codex "接入 Codex（之后要在 Codex 里用 /hooks 信任一次）？" && python3 "$INTEGRATE" install codex || true
want deepseek "接入 DeepSeek Harness 桌面版（装插件，能显示余额）？" && python3 "$INTEGRATE" install deepseek || true
want antigravity "接入 Antigravity（Gemini 角色跟着它干活）？" && python3 "$INTEGRATE" install antigravity || true
want gemini "接入 Gemini CLI？" && python3 "$INTEGRATE" install gemini || true

bold "装好了！桌宠在屏幕右下角。"
echo "· 单击摸摸头，拖动换位置，右键打开菜单（改名、换角色、开机自启……）"
echo "· 以后更新：再运行一次同样的命令"
echo "· 卸载：curl -fsSL https://raw.githubusercontent.com/$REPO_SLUG/main/get.sh | bash -s -- uninstall"
