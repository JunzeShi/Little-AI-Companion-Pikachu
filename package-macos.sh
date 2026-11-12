#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build.noindex"
APP="$BUILD/Little Companion.app"

"$ROOT/build-macos.sh" "$@"
ARCH="$(xcrun lipo -archs "$APP/Contents/MacOS/LittleCompanion")"
if [[ "$ARCH" == *' '* ]]; then ARCH=universal; fi
NAME="Little-AI-Companion-Pikachu-macOS-$ARCH.zip"

WORK="$(mktemp -d "$BUILD/.package.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
ditto -c -k --norsrc --keepParent "$APP" "$WORK/$NAME"
ditto -x -k "$WORK/$NAME" "$WORK/unpacked"
codesign --verify --deep --strict "$WORK/unpacked/Little Companion.app"
mv -f "$WORK/$NAME" "$BUILD/$NAME"
print "Transfer: $BUILD/$NAME"
