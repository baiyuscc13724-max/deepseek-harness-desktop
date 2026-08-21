#!/bin/bash
# Harness Desktop one-click installer (macOS)
# Double-click this file: it copies the app into /Applications,
# clears the quarantine attribute (fixes "app is damaged"), and launches it.
# This is a user-authorized local convenience step, NOT a substitute for
# Developer ID signing, Apple notarization or Gatekeeper acceptance.
set -u

cd "$(dirname "$0")"
APP="Harness Desktop.app"

if [ ! -d "$APP" ]; then
  echo "Error: cannot find $APP next to this file."
  echo "Please run this file from inside the DMG or the unzipped folder."
  read -r -p "Press Enter to exit..."
  exit 1
fi

echo "Installing Harness Desktop ..."

if [ -w /Applications ]; then
  DEST="/Applications/$APP"
else
  DEST="$HOME/Applications/$APP"
  mkdir -p "$HOME/Applications"
fi

rm -rf "$DEST" 2>/dev/null || true
ditto "$APP" "$DEST" || { echo "Copy failed. Please try again or install manually."; read -r -p "Press Enter to exit..."; exit 1; }

# Clear the quarantine attribute so Gatekeeper does not report the app as damaged.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "Installed: $DEST"
open "$DEST"
exit 0
