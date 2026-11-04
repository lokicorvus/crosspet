#!/bin/sh
# 打试验 C 的小程序：tests/windows/HostSpike/build.sh → build/HostSpike.zip（解压后双击 HostSpike.exe）
set -e
cd "$(dirname "$0")/../../.."
DOTNET="${DOTNET:-$HOME/.dotnet/dotnet}"
"$DOTNET" build tests/windows/HostSpike/HostSpike.csproj -c Release -nologo -v quiet
BIN=tests/windows/HostSpike/bin/Release/net48
OUT=build/HostSpike
rm -rf "$OUT" && mkdir -p "$OUT"
cp "$BIN"/HostSpike.exe "$BIN"/HostSpike.exe.config "$BIN"/Microsoft.Web.WebView2.*.dll "$OUT/"
cp -R "$BIN/runtimes" "$OUT/runtimes"
cp tests/windows/HostSpike/spike.html "$OUT/"
cp characters/claude/idle.webp "$OUT/pet.webp"
rm -f build/HostSpike.zip
(cd build && zip -qr HostSpike.zip HostSpike)
echo "试验包：build/HostSpike.zip（$(du -h build/HostSpike.zip | cut -f1)）"
