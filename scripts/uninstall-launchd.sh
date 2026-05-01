#!/usr/bin/env bash
set -euo pipefail

PLIST_DEST="$HOME/Library/LaunchAgents/com.matt.rivendell.plist"

launchctl stop com.matt.rivendell 2>/dev/null || true
launchctl unload "$PLIST_DEST" 2>/dev/null || true
rm -f "$PLIST_DEST"

echo "Rivendell launchd service removed."
