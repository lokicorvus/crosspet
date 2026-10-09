#!/bin/sh
# CrossPet 卸载：撤销所有 AI 接入（只删 CrossPet 自己加的条目，改动前都会备份），删除 App 和运行目录
cd "$(dirname "$0")"
pkill -x CrossPet 2>/dev/null || true
for t in claude-hooks claude-mod codex deepseek gemini antigravity workbuddy zcode hermes; do python3 tools/integrate.py uninstall "$t"; done
rm -rf "$HOME/Applications/CrossPet.app" "/Applications/CrossPet.app"
printf "要删除你的角色和设置吗（~/Library/Application Support/CrossPet，包括自己加的角色）？[y/N] "
read -r a
if [ "$a" = "y" ] || [ "$a" = "Y" ]; then
  rm -rf "$HOME/Library/Application Support/CrossPet"
  defaults delete io.github.crosspet 2>/dev/null || true
fi
rm -rf /tmp/crosspet
echo "已卸载 CrossPet。"
