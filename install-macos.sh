#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/build.noindex/Little Companion.app"
APPLICATIONS="$HOME/Applications"
DEST="$APPLICATIONS/Little Companion.app"

if [[ ! -d "$APP" ]]; then
  "$ROOT/build-macos.sh"
fi

mkdir -p "$APPLICATIONS"
if [[ -e "$DEST" ]]; then
  EXISTING_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DEST/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$EXISTING_ID" != "com.localcompanion.pet" ]]; then
    print -u2 "An unrelated app already exists at: $DEST"
    exit 1
  fi
fi

WORK="$(mktemp -d "$APPLICATIONS/.little-companion-install.XXXXXX")"
STAGING="$WORK/Little Companion.app"
BACKUP="$WORK/Previous.app"
installed=false
cleanup() {
  if [[ "$installed" != true && -e "$BACKUP" ]]; then
    if [[ -e "$DEST" ]]; then
      print -u2 "Previous app retained at $BACKUP"
      return
    fi
    mv "$BACKUP" "$DEST" || { print -u2 "Previous app retained at $BACKUP"; return; }
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

ditto "$APP" "$STAGING"
codesign --verify --deep --strict "$STAGING"
if [[ -e "$DEST" ]]; then mv "$DEST" "$BACKUP"; fi
mv "$STAGING" "$DEST"
installed=true
if [[ "${1:-}" != "--no-launch" ]]; then open "$DEST"; fi
print "Installed: $DEST"
