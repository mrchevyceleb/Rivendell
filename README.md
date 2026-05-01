# Rivendell

Rivendell is the local always-on office app for Bag End. It serves the Hall chat, dashboard, task board, inbox, messages, family ops, P&L, cron view, employee queue, past sessions, and live worker activity log from this Mac on port `8091`.

Elrond is pinned to `/Users/mjohnst/Library/CloudStorage/OneDrive-Personal/Documents/ASSISTANT-HUB`. The Library room reads that folder as a file tree, and heavy folders such as `node_modules` and `.git` are loaded on demand.

## Local Development

```bash
npm install
npm run dev
```

The Vite app runs on `:5173` and proxies API/WebSocket traffic to the server on `:8091`.

## Production On This Mac

```bash
npm run build
./scripts/install-launchd.sh
```

That installs `com.matt.rivendell` as a user `launchd` service with `KeepAlive`, serving the built frontend and API from:

```text
http://localhost:8091
```

Useful commands:

```bash
launchctl list | grep rivendell
tail -f ~/.rivendell/rivendell.out.log
./scripts/uninstall-launchd.sh
```

## Tailscale

Once the launchd service is healthy, expose it inside the tailnet:

```bash
./scripts/tailscale-serve.sh
```

That maps the local service to the tailnet using `tailscale serve`. Tailscale ACLs are the auth layer; Rivendell does not add a password layer.

## Worker

The worker queue runs alongside the HTTP server. By default it uses `RIVENDELL_WORKER_RUNNER=dry-run`, which updates queue state and streams Scribe events without spawning Claude.

To let jobs spawn a real headless Claude Code process:

```bash
RIVENDELL_WORKER_RUNNER=claude
```

External side effects stay draft/review-first by design.
