#!/bin/sh
# 改完 app/web/effects.js 后运行：检查所有特效（含会移动的路径）有没有压到人物身上。需要 node + python3（Pillow）。
set -e
cd "$(dirname "$0")/../.."
OUT=/tmp/crosspet-fxcheck
mkdir -p "$OUT"
node tools/fxcheck/snapshots.js "$(pwd)/app/web/effects.js" "$OUT"
(cd "$OUT" && qlmanage -t -s 580 -o . ./*.svg >/dev/null 2>&1)
python3 tools/fxcheck/check.py "$OUT" ${1:-}
