#!/usr/bin/env bash
# CrossPet Linux 安装脚本：检查依赖 → 安装命令与桌面入口 → 接入 AI → 启动桌宠（对齐 macOS 版）
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

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
try:
    import cairo  # noqa: F401
except Exception as e:
    missing.append(f"cairo ({e})")
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
    sudo pacman -S python-gobject python-cairo gtk3 webkit2gtk-4.1 gtk-layer-shell libayatana-appindicator
  Ubuntu / Debian:
    sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.1 gir1.2-gtklayershell-0.1 gir1.2-ayatanaappindicator3-0.1
  Fedora:
    sudo dnf install python3-gobject python3-cairo gtk3 webkit2gtk4.1 gtk-layer-shell libayatana-appindicator-gtk3
HINT
  exit 1
fi

say "2/3 安装启动命令与桌面入口"
chmod +x "$ROOT/app/linux/crosspet" "$ROOT/app/linux/install.sh" "$ROOT/app/linux/uninstall.sh"

BIN_DIR="$HOME/.local/bin"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/crosspet"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps"

if command -v crosspet >/dev/null 2>&1; then
  crosspet --quit >/dev/null 2>&1 || true
fi
pkill -f "app\.linux\.main" 2>/dev/null || true
sleep 0.3

mkdir -p "$BIN_DIR" "$DATA_DIR" "$APPS_DIR" "$ICON_DIR"
ln -sf "$ROOT/app/linux/crosspet" "$BIN_DIR/crosspet"
ln -sf "$ROOT/app/linux/crosspet" "$DATA_DIR/launcher"
cp "$ROOT/app/icon/AppIcon.png" "$ICON_DIR/crosspet.png"

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

echo "已安装命令：$BIN_DIR/crosspet"
echo "已安装桌面入口：$APPS_DIR/crosspet.desktop"

say "3/3 接入 AI（已接入的会自动刷新；也可以跳过，以后在桌宠右键「设置… → 接入 AI」里接）"
INTEGRATE="$ROOT/tools/integrate.py"
already=$(cd "$ROOT/tools" && python3 -c 'import integrate; print(" ".join(integrate.installed()))')
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
echo "· 单击摸摸头，拖动换位置，右键打开菜单（换角色、设置、接入 AI……）"
echo "· 接入状态随时可查：python3 tools/integrate.py status"
echo "· 平铺式窗口管理器（Hyprland / Sway）说明见 docs/linux.md："
echo "    exec-once = crosspet"
echo "    bind = CTRL ALT, P, exec, crosspet --toggle"
echo "· 卸载：./uninstall.sh"
