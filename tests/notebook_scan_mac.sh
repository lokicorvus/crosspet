#!/bin/bash
# 小本子 Mac：从 Claude Code / Codex 记录里抽精简事件，和 expected.json 比
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp tests/notebook_scan_main.swift "$TMP/main.swift"   # 顶层代码要在叫 main.swift 的文件里
swiftc -O app/mac/NotebookScan.swift "$TMP/main.swift" -o "$TMP/scan"
"$TMP/scan" tests/fixtures/notebook/home | python3 -I tests/notebook_scan_check.py
