#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8091}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale CLI not found" >&2
  exit 1
fi

tailscale serve --bg "http://127.0.0.1:${PORT}"
tailscale serve status
