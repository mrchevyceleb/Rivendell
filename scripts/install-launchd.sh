#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_SRC="$ROOT_DIR/scripts/com.matt.rivendell.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.matt.rivendell.plist"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.rivendell"

sed "s#__ROOT_DIR__#$ROOT_DIR#g" "$PLIST_SRC" > "$PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"
launchctl start com.matt.rivendell

echo "Rivendell launchd service installed: $PLIST_DEST"
echo "Logs: $HOME/.rivendell/rivendell.out.log and $HOME/.rivendell/rivendell.err.log"
