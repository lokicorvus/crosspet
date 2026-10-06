#!/bin/sh
# 编译 CrossPet.app（Apple 芯片 + Intel 通用版）到 build/CrossPet.app
# 用法：app/build.sh           只编译
#       app/build.sh --zip     编译后再打一个发布用的 build/CrossPet-macOS.zip
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
APP="$ROOT/build/CrossPet.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

VERSION=$(cat VERSION 2>/dev/null || echo 1.0.0)
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>CrossPet</string>
  <key>CFBundleDisplayName</key><string>CrossPet</string>
  <key>CFBundleIdentifier</key><string>io.github.crosspet</string>
  <key>CFBundleExecutable</key><string>CrossPet</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
PLIST

# 两种芯片各编一份，再合成一个通用二进制
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13.0" app/CrossPet.swift -o "build/CrossPet-$arch" \
    -framework Cocoa -framework WebKit -framework ServiceManagement
done
lipo -create build/CrossPet-arm64 build/CrossPet-x86_64 -output "$APP/Contents/MacOS/CrossPet"
rm build/CrossPet-arm64 build/CrossPet-x86_64

# 图标：从 app/icon/AppIcon.png（1024，已带圆角）生成全套尺寸
ICONSET=build/AppIcon.iconset
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s app/icon/AppIcon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) app/icon/AppIcon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

cp -R app/web "$APP/Contents/Resources/web"
cp -R characters "$APP/Contents/Resources/characters"
cp integrations/crosspet-hook.py "$APP/Contents/Resources/crosspet-hook.py"
# 接入部分也打进包里：App 启动时会把已经装过的 Claude mod / DeepSeek 插件更新到新版
mkdir -p "$APP/Contents/Resources/integrations/claude-code" "$APP/Contents/Resources/integrations/deepseek"
cp -R integrations/claude-code/mod "$APP/Contents/Resources/integrations/claude-code/mod"
cp -R integrations/deepseek/dsh-plugin-crosspet "$APP/Contents/Resources/integrations/deepseek/dsh-plugin-crosspet"
find "$APP/Contents/Resources/characters" -name raw -type d -prune -exec rm -rf {} +

codesign --force --deep -s - "$APP"
echo "已编译：$APP"

if [ "$1" = "--zip" ]; then
  (cd build && rm -f CrossPet-macOS.zip && ditto -c -k --keepParent CrossPet.app CrossPet-macOS.zip)
  echo "发布包：$ROOT/build/CrossPet-macOS.zip"
fi
