#!/usr/bin/env bash
# 打 Linux 独立发布包：
#   tools/build-linux.sh  →  build/CrossPet-Linux.tar.gz
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="$ROOT/build/linux/CrossPet"
ARCHIVE="$ROOT/build/CrossPet-Linux.tar.gz"

rm -rf "$OUT"
mkdir -p "$OUT/app/icon" "$OUT/tools"

cp -R "$ROOT/app/linux" "$OUT/app/linux"
rm -f "$OUT/app/linux/install.sh" "$OUT/app/linux/uninstall.sh"
find "$OUT/app/linux" -name '__pycache__' -type d -prune -exec rm -rf {} +

cp -R "$ROOT/app/web" "$OUT/app/web"
cp "$ROOT/app/icon/AppIcon.png" "$OUT/app/icon/AppIcon.png"

cp -R "$ROOT/characters" "$OUT/characters"
find "$OUT/characters" \( -name 'raw' -type d -o -name '.DS_Store' -type f \) -prune -exec rm -rf {} +

cp -R "$ROOT/integrations" "$OUT/integrations"
find "$OUT/integrations" \( -name '__pycache__' -type d -o -name '.DS_Store' -type f \) -prune -exec rm -rf {} +

cp "$ROOT/tools/integrate.py" "$OUT/tools/integrate.py"
cp "$ROOT/VERSION" "$ROOT/LICENSE" "$OUT/"
cp "$ROOT/docs/linux.md" "$OUT/使用说明.md"

cat > "$OUT/crosspet" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  TARGET="$(readlink "$SOURCE")"
  case "$TARGET" in
    /*) SOURCE="$TARGET" ;;
    *) SOURCE="$DIR/$TARGET" ;;
  esac
done
BUNDLE_ROOT="$(cd -P "$(dirname "$SOURCE")" && pwd)"

export PYTHONPATH="$BUNDLE_ROOT${PYTHONPATH:+:$PYTHONPATH}"
export CROSSPET_REPO_ROOT="${CROSSPET_REPO_ROOT:-$BUNDLE_ROOT}"
export PYTHONSAFEPATH=1

exec python3 -m app.linux.main "$@"
WRAPPER
chmod +x "$OUT/crosspet" "$OUT/app/linux/crosspet"

cat > "$OUT/install.sh" <<'INSTALLER'
#!/usr/bin/env bash
# CrossPet Linux 安装脚本：检查依赖 → 复制到数据目录 → 创建命令与桌面入口 → 接入 AI → 启动桌宠（对齐 macOS 版）
set -euo pipefail

cd "$(dirname "$0")"
SRC="$(pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$1"; }
ask() {
  local a=""
  printf "%s [y/N] " "$1"
  read -r a || a=""
  [ "$a" = "y" ] || [ "$a" = "Y" ]
}

say "1/3 检查运行环境（Python / GTK3 / WebKit2GTK / gtk-layer-shell / AppIndicator）"
if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3，请先安装 Python 3.10+"
  exit 1
fi

if ! python3 - <<'PY'
import sys
import gi

missing = []
for ns, ver in (("Gtk", "3.0"), ("Gdk", "3.0"), ("WebKit2", "4.1"), ("GtkLayerShell", "0.1")):
    try:
        gi.require_version(ns, ver)
        __import__(f"gi.repository.{ns}")
    except Exception as e:
        missing.append(f"{ns} {ver} ({e})")

tray_ok = False
for ns in ("AyatanaAppIndicator3", "AppIndicator3"):
    try:
        gi.require_version(ns, "0.1")
        __import__(f"gi.repository.{ns}")
        tray_ok = True
        break
    except Exception:
        pass
if not tray_ok:
    missing.append("AyatanaAppIndicator3 0.1 或 AppIndicator3 0.1")

if missing:
    print("缺少以下运行时依赖：")
    for m in missing:
        print("  -", m)
    sys.exit(1)
print("OK")
PY
then
  cat <<'HINT'

请先安装对应发行版的依赖包后再运行本脚本：
  Arch Linux:
    sudo pacman -S python-gobject gtk3 webkit2gtk-4.1 gtk-layer-shell libayatana-appindicator
  Ubuntu / Debian:
    sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 gir1.2-gtklayershell-0.1 gir1.2-ayatanaappindicator3-0.1
  Fedora:
    sudo dnf install python3-gobject gtk3 webkit2gtk4.1 gtk-layer-shell libayatana-appindicator-gtk3
HINT
  exit 1
fi

say "2/3 安装程序文件、命令与桌面入口"
BIN_DIR="$HOME/.local/bin"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/crosspet"
BUNDLE_DIR="$DATA_DIR/bundle"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps"

if command -v crosspet >/dev/null 2>&1; then
  crosspet --quit >/dev/null 2>&1 || true
fi
pkill -f "app\.linux\.main" 2>/dev/null || true

mkdir -p "$BIN_DIR" "$DATA_DIR" "$APPS_DIR" "$ICON_DIR"
rm -rf "$BUNDLE_DIR"
cp -R "$SRC" "$BUNDLE_DIR"
chmod +x "$BUNDLE_DIR/crosspet" "$BUNDLE_DIR/app/linux/crosspet" "$BUNDLE_DIR/uninstall.sh"

ln -sf "$BUNDLE_DIR/crosspet" "$BIN_DIR/crosspet"
ln -sf "$BUNDLE_DIR/crosspet" "$DATA_DIR/launcher"
cp "$BUNDLE_DIR/app/icon/AppIcon.png" "$ICON_DIR/crosspet.png"

cat > "$APPS_DIR/crosspet.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=CrossPet
Comment=Cross-AI Desktop Pet
Exec=$BIN_DIR/crosspet
Icon=crosspet
Terminal=false
Categories=Utility;
StartupNotify=false
DESKTOP

echo "已安装程序到：$BUNDLE_DIR"
echo "已安装命令：$BIN_DIR/crosspet"
echo "已安装桌面入口：$APPS_DIR/crosspet.desktop"

say "3/3 接入 AI（已接入的会自动刷新；也可以跳过，以后在桌宠右键「设置… → 接入 AI」里接）"
INTEGRATE="$BUNDLE_DIR/tools/integrate.py"
already=$(cd "$BUNDLE_DIR/tools" && python3 -c 'import integrate; print(" ".join(integrate.installed()))')
if [ -n "$already" ]; then
  echo "已经接入：${already}（按新版刷新一遍）"
  python3 "$INTEGRATE" refresh >/dev/null || true
fi
want() {
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
    if want claude-hooks "接入 Claude Code（标准钩子，所有版本可用）？"; then
      python3 "$INTEGRATE" install claude-hooks
    elif want claude-mod "  或者接入 Claude Code 增强版 mod（多显示额度，需要 Claude Code 2.1.287+）？"; then
      python3 "$INTEGRATE" install claude-mod
    fi ;;
esac
want codex "接入 Codex（写入 ~/.codex/hooks.json）？" && python3 "$INTEGRATE" install codex || true
want deepseek "接入 DeepSeek Harness 桌面版（安装插件，显示余额）？" && python3 "$INTEGRATE" install deepseek || true
want antigravity "接入 Antigravity（写入 ~/.gemini/config/hooks.json）？" && python3 "$INTEGRATE" install antigravity || true
want gemini "接入 Gemini CLI（写入 ~/.gemini/settings.json）？" && python3 "$INTEGRATE" install gemini || true
want workbuddy "接入 WorkBuddy（腾讯，按当前模型换角色）？" && python3 "$INTEGRATE" install workbuddy || true
want zcode "接入 ZCode（智谱，写入 ~/.zcode/cli/config.json）？" && python3 "$INTEGRATE" install zcode || true
want hermes "接入 Hermes Agent（装插件到 ~/.hermes/plugins/crosspet）？" && python3 "$INTEGRATE" install hermes || true
want qwen "接入 Qwen Code（阿里，写入 ~/.qwen/settings.json）？" && python3 "$INTEGRATE" install qwen || true
want kimi "接入 Kimi Code（月之暗面，写入 ~/.kimi-code/config.toml）？" && python3 "$INTEGRATE" install kimi || true
want grok "接入 Grok Build（xAI，写入 ~/.grok/hooks/crosspet.json）？" && python3 "$INTEGRATE" install grok || true
want opencode "接入 OpenCode（安装插件到 ~/.config/opencode/plugins）？" && python3 "$INTEGRATE" install opencode || true
want trae "接入 TRAE（字节，写入 ~/.trae-cn/hooks.json）？" && python3 "$INTEGRATE" install trae || true
want cursor "接入 Cursor（写入 ~/.cursor/hooks.json）？" && python3 "$INTEGRATE" install cursor || true
want ccgui "接入 CC GUI（一次接入所有 CLI）？" && python3 "$INTEGRATE" install ccgui || true

if [ -z "${CROSSPET_NO_OPEN:-}" ]; then
  nohup "$BIN_DIR/crosspet" >/dev/null 2>&1 &
fi

say "装好了！桌宠在屏幕右下角。"
echo "· 解压目录现在可以删除；单击摸摸头，拖动换位置，右键打开菜单（换角色、设置、接入 AI……）"
echo "· Hyprland 推荐配置（~/.config/hypr/hyprland.conf）："
echo "    exec-once = crosspet"
echo "    bind = CTRL ALT, P, exec, crosspet --toggle"
echo "· 卸载：bash $BUNDLE_DIR/uninstall.sh"
INSTALLER
chmod +x "$OUT/install.sh"

cat > "$OUT/uninstall.sh" <<'UNINSTALLER'
#!/usr/bin/env bash
# CrossPet Linux 卸载脚本
set -euo pipefail

cd "$(dirname "$0")"
BUNDLE_DIR="$(pwd)"

if command -v crosspet >/dev/null 2>&1; then
  crosspet --quit >/dev/null 2>&1 || true
fi
pkill -f "app\.linux\.main" 2>/dev/null || true

if [ -f "$BUNDLE_DIR/tools/integrate.py" ]; then
  for t in claude-hooks claude-mod codex deepseek gemini antigravity workbuddy zcode hermes qwen kimi cursor grok opencode trae ccgui; do
    python3 "$BUNDLE_DIR/tools/integrate.py" uninstall "$t" || true
  done
fi

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/crosspet"
rm -f "$HOME/.local/bin/crosspet"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/crosspet.desktop"
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/crosspet.desktop"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps/crosspet.png"
rm -f "$DATA_DIR/launcher"
rm -rf "$DATA_DIR/bundle"

printf "要删除你的角色和设置吗（%s，包括自己加的角色）？[y/N] " "$DATA_DIR"
read -r a
if [ "$a" = "y" ] || [ "$a" = "Y" ]; then
  rm -rf "$DATA_DIR"
fi
rm -rf "${CROSSPET_STATE_DIR:-/tmp/crosspet}"
echo "已卸载 CrossPet。"
UNINSTALLER
chmod +x "$OUT/uninstall.sh"

rm -f "$ARCHIVE"
tar -czf "$ARCHIVE" -C "$ROOT/build/linux" CrossPet
echo "Linux 发布包：$ARCHIVE（$(du -h "$ARCHIVE" | cut -f1)）"
