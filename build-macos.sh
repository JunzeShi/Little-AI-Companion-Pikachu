#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build.noindex"
APP="$BUILD/Little Companion.app"
MINIMUM_OS="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$ROOT/Info.plist")"
SDK="${COMPANION_MACOS_SDK:-$(xcrun --sdk macosx --show-sdk-path)}"
ARCHITECTURES=("$(uname -m)")

if [[ "${1:-}" == "--universal" && "$#" == 1 ]]; then
  ARCHITECTURES=(arm64 x86_64)
  if ! /usr/bin/grep -q 'x86_64-macos' "$SDK/usr/lib/libSystem.tbd"; then
    print -u2 'A universal build needs a macOS SDK that supports Intel. Set COMPANION_MACOS_SDK to the path of an installed SDK that supports both architectures, such as the macOS 26 SDK.'
    exit 1
  fi
elif (( $# )); then
  print -u2 'Usage: ./build-macos.sh [--universal]'
  exit 2
fi

mkdir -p "$BUILD"
WORK="$(mktemp -d "$BUILD/.build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
STAGING="$WORK/Little Companion.app"
CONTENTS="$STAGING/Contents"
RESOURCES="$CONTENTS/Resources"

mkdir -p "$CONTENTS/MacOS" "$RESOURCES/assets" "$RESOURCES/vendor"
ICON_PNG="$WORK/PikachuAppIcon.png"
MODULE_CACHE="$BUILD/ModuleCache"
SLICES=()

for ARCH in "${ARCHITECTURES[@]}"; do
  SLICE="$WORK/LittleCompanion-$ARCH"
  mkdir -p "$MODULE_CACHE/$ARCH"
  xcrun swiftc -sdk "$SDK" -target "$ARCH-apple-macosx$MINIMUM_OS" \
    -module-cache-path "$MODULE_CACHE/$ARCH" -file-prefix-map "$ROOT=." \
    -swift-version 5 -parse-as-library -O \
    -framework AppKit \
    -framework AVFoundation \
    -framework CoreGraphics \
    -framework Foundation \
    -framework ImageIO \
    -framework PDFKit \
    -framework ScreenCaptureKit \
    -framework Security \
    -framework Speech \
    -framework UserNotifications \
    -framework Vision \
    -framework WebKit \
    "$ROOT/Sources/main.swift" "$ROOT/Sources/WebSearch.swift" "$ROOT/Sources/LocalTools.swift" "$ROOT/Sources/PowerPointReader.swift" \
    -o "$SLICE"
  SLICES+=("$SLICE")
done
xcrun lipo -create "${SLICES[@]}" -output "$CONTENTS/MacOS/LittleCompanion"

cp -X "$ROOT/Info.plist" "$CONTENTS/Info.plist"
cp -X "$ROOT/index.html" "$ROOT/renderer.js" "$ROOT/styles.css" "$RESOURCES/"
for POSE in still hello thinking thinking-blink; do
  cp -X "$ROOT/assets/pikachu-$POSE.png" "$RESOURCES/assets/"
done
chmod 644 "$RESOURCES/assets/"*.png
cp -RX "$ROOT/vendor/katex" "$RESOURCES/vendor/"
mkdir -p "$MODULE_CACHE/icon"
xcrun swift -module-cache-path "$MODULE_CACHE/icon" "$ROOT/Tools/prepare-app-icon.swift" "$ROOT/assets/pikachu-still.png" "$ICON_PNG"
sips -s format icns "$ICON_PNG" --out "$RESOURCES/AppIcon.icns" >/dev/null

codesign --force --sign - "$STAGING"
codesign --verify --deep --strict "$STAGING"
rm -rf "$APP"
mv "$STAGING" "$APP"
echo "Built: $APP"
