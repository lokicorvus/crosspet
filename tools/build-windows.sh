#!/bin/sh
# 打 Windows 包（在 macOS 上就能打，不需要 Windows）：
#   tools/build-windows.sh            → build/CrossPet-Windows.zip
# 需要 .NET 8 SDK（装法：https://dot.net/v1/dotnet-install.sh --channel 8.0），默认找 ~/.dotnet/dotnet；也可以用 DOTNET=... 指定。
# 一个包同时支持 x64 和 ARM64：程序是 AnyCPU，WebView2 加载器三种架构都带；钩子用的 Python 是 x64 版，ARM64 上走系统的 x64 兼容层。
set -e
cd "$(dirname "$0")/.."
DOTNET="${DOTNET:-$HOME/.dotnet/dotnet}"
OUT=build/windows/CrossPet
PY_VERSION=3.13.13
PY_SHA256=8766a8775746235e23cf5aee5027ab1060bb981d93110577adcf3508aa0cbd55
PY_ZIP="build/downloads/python-$PY_VERSION-embed-amd64.zip"

"$DOTNET" build app/windows/CrossPet.csproj -c Release -nologo -v quiet
BIN=app/windows/bin/Release/net48

rm -rf "$OUT"
mkdir -p "$OUT/tools"
cp "$BIN"/CrossPet.exe "$BIN"/CrossPet.exe.config "$BIN"/Microsoft.Web.WebView2.*.dll "$OUT/"
cp -R "$BIN/runtimes" "$OUT/runtimes"
cp -R app/web "$OUT/web"
rsync -a --exclude raw --exclude .DS_Store characters/ "$OUT/characters/"
rsync -a --exclude .DS_Store integrations/ "$OUT/integrations/"
cp tools/integrate.py "$OUT/tools/"
cp VERSION LICENSE app/windows/apps.json app/windows/install.cmd app/windows/install.ps1 app/windows/uninstall.cmd app/windows/uninstall.ps1 "$OUT/"
cp app/icon/AppIcon.ico "$OUT/"
# Windows 自带的 PowerShell 5.1 读不带 BOM 的脚本时按系统编码（中文系统是 GBK）解析，中文会乱码：转成带 BOM 的 UTF-8
for f in "$OUT"/*.ps1; do python3 -c "import sys; p=sys.argv[1]; t=open(p,encoding='utf-8-sig').read(); open(p,'w',encoding='utf-8-sig',newline='\r\n').write(t)" "$f"; done
cp docs/windows.md "$OUT/使用说明.md"

# 随包 Python：只给钩子脚本和接入工具用，官方精简版，核对校验值
mkdir -p build/downloads
[ -f "$PY_ZIP" ] || curl -sSLf "https://www.python.org/ftp/python/$PY_VERSION/python-$PY_VERSION-embed-amd64.zip" -o "$PY_ZIP"
echo "$PY_SHA256  $PY_ZIP" | shasum -a 256 -c - >/dev/null || { echo "Python 安装包校验失败：$PY_ZIP"; exit 1; }
mkdir -p "$OUT/python"
unzip -q -o "$PY_ZIP" -d "$OUT/python"

rm -f build/CrossPet-Windows.zip
python3 - <<'EOF'
import os, zipfile
src = 'build/windows/CrossPet'
with zipfile.ZipFile('build/CrossPet-Windows.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, _, files in os.walk(src):
        for f in files:
            if f == '.DS_Store':
                continue
            p = os.path.join(root, f)
            z.write(p, os.path.join('CrossPet', os.path.relpath(p, src)))
EOF
echo "Windows 包：build/CrossPet-Windows.zip（$(du -h build/CrossPet-Windows.zip | cut -f1)）"
