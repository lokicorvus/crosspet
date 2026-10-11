#!/bin/sh
# macOS + Command Line Tools. A real WKWebView window is required.
# Optional first argument: another web directory (e.g. an unchanged baseline).
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)
WEB=${1:-"$ROOT/app/web"}
OUT=${2:-"$ROOT/build/webkit-animation-test"}
mkdir -p "$OUT"
swiftc -module-cache-path "$OUT/module-cache" tests/webkit_animation_test.swift \
  -framework Cocoa -framework WebKit -o "$OUT/runner"
"$OUT/runner" "$WEB/index.html" "$ROOT/tests/webkit_animation_test.js" "$OUT"
