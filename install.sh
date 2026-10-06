#!/bin/sh
# CrossPet 一键安装：编译 → 装进「应用程序」→ 逐个询问要接入哪些 AI
set -e
cd "$(dirname "$0")"

say() { printf "\n\033[1m%s\033[0m\n" "$1"; }
ask() { printf "%s [y/N] " "$1"; read -r a; [ "$a" = "y" ] || [ "$a" = "Y" ]; }

say "1/3 检查编译环境"
if ! xcode-select -p >/dev/null 2>&1 || ! command -v swiftc >/dev/null 2>&1; then
  echo "需要苹果的命令行工具。请运行下面这条命令，装好后再运行本脚本："
  echo "  xcode-select --install"
  exit 1
fi
echo "OK"

say "2/3 编译并安装 CrossPet.app"
app/build.sh
mkdir -p "$HOME/Applications"
pkill -x CrossPet 2>/dev/null || true
rm -rf "$HOME/Applications/CrossPet.app"
cp -R build/CrossPet.app "$HOME/Applications/CrossPet.app"
echo "已安装到 ~/Applications/CrossPet.app"

say "3/3 接入 AI（可以以后再运行本脚本补接，或用 python3 tools/integrate.py）"
if ask "接入 Claude Code（标准钩子，所有版本可用）？"; then
  python3 tools/integrate.py install claude-hooks
elif ask "  或者接入 Claude Code 增强版 mod（多显示额度，需要 Claude Code 2.1.28x+）？"; then
  python3 tools/integrate.py install claude-mod
fi
ask "接入 Codex（写入 ~/.codex/hooks.json）？" && python3 tools/integrate.py install codex
ask "接入 DeepSeek Harness 桌面版（安装插件，显示余额）？" && python3 tools/integrate.py install deepseek
ask "接入 Antigravity（写入 ~/.gemini/config/hooks.json，Gemini 角色跟着 Antigravity 干活）？" && python3 tools/integrate.py install antigravity
ask "接入 Gemini CLI（写入 ~/.gemini/settings.json；Gemini 桌面 App 无法接入）？" && python3 tools/integrate.py install gemini
ask "接入 WorkBuddy（腾讯，写入 ~/.workbuddy-ai 或 ~/.workbuddy 的 settings.json，按当前模型换角色）？" && python3 tools/integrate.py install workbuddy
ask "接入 ZCode（智谱，写入 ~/.zcode/cli/config.json）？" && python3 tools/integrate.py install zcode

open "$HOME/Applications/CrossPet.app"
say "装好了！桌宠已经出现在屏幕右下角。"
echo "· 单击摸摸头，拖动换位置，右键打开菜单（改名、换角色、开机自启……）"
echo "· 接入状态随时可查：python3 tools/integrate.py status"
echo "· 卸载：./uninstall.sh"
