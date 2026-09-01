#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p "$HOME/.rivendell"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

export PORT="${PORT:-8091}"
export HOST="${HOST:-0.0.0.0}"
export RIVENDELL_BANANA_REMOTE_MCP="${RIVENDELL_BANANA_REMOTE_MCP:-1}"
# Rivendell is an always-on headless daemon. Claude/Codex authentication must
# fail visibly in chat/logs rather than launching OAuth tabs on Moria's dormant
# desktop session. Override with RIVENDELL_CLI_BROWSER only for intentional,
# attended maintenance.
export BROWSER="${RIVENDELL_CLI_BROWSER:-/bin/false}"

npm start
