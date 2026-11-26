#!/usr/bin/env bash
# CrossPet Linux 卸载脚本
set -euo pipefail

cd "$(dirname "$0")/../.."

if command -v crosspet >/dev/null 2>&1; then
  crosspet --quit >/dev/null 2>&1 || true
fi
pkill -f "app\.linux\.main" 2>/dev/null || true

for t in claude-hooks claude-mod codex deepseek gemini antigravity workbuddy zcode hermes qwen kimi cursor grok opencode trae ccgui; do
  python3 tools/integrate.py uninstall "$t" || true
done

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/crosspet"
rm -f "$HOME/.local/bin/crosspet"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/crosspet.desktop"
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/crosspet.desktop"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps/crosspet.png"
rm -f "$DATA_DIR/launcher"

printf "要删除你的角色和设置吗（%s，包括自己加的角色）？[y/N] " "$DATA_DIR"
read -r a
if [ "$a" = "y" ] || [ "$a" = "Y" ]; then
  rm -rf "$DATA_DIR"
fi
rm -rf "${CROSSPET_STATE_DIR:-/tmp/crosspet}"
echo "已卸载 CrossPet。"
