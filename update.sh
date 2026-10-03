#!/bin/sh
# CrossPet 更新（从源码安装的用户用）：拉取最新代码 → 重新编译安装 → 把已经接入的 AI 按新版刷新一遍
set -e
cd "$(dirname "$0")"
git pull --ff-only
app/build.sh
pkill -x CrossPet 2>/dev/null || true
rm -rf "$HOME/Applications/CrossPet.app"
cp -R build/CrossPet.app "$HOME/Applications/CrossPet.app"
python3 tools/integrate.py refresh
open "$HOME/Applications/CrossPet.app"
echo "已更新到 $(cat VERSION)。"
