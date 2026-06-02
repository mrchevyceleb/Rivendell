# Rivendell

Rivendell is the local always-on office app for Bag End. It serves the Hall chat, dashboard, task board, inbox, messages, family ops, P&L, cron view, employee queue, past sessions, and live worker activity log from the DGX Spark "Moria" on port `8091`.

Elrond is pinned to `~/ASSISTANT-HUB` (a Syncthing-managed local folder, override with `ELROND_WORKSPACE_PATH`). The Library room reads that folder as a file tree, and heavy folders such as `node_modules` and `.git` are loaded on demand.

## Local Development

```bash
npm install
npm run dev
```

The Vite app runs on `:5173` and proxies API/WebSocket traffic to the server on `:8091`.

## Production on Moria (DGX Spark, Ubuntu)

Rivendell runs as an enabled `systemd --user` service that auto-starts on boot and restarts on crash, serving the built frontend and API from:

```text
http://localhost:8091
```

The service (`~/.config/systemd/user/rivendell.service`) runs `~/bin/start-rivendell-moria`, which loads the shared Doppler env (`~/.config/moria-services/doppler.env` → project `assistant-mcp`, config `prd`), wraps everything in `doppler run`, and calls `./scripts/start.sh` (`npm start`, serving the prebuilt `dist/`). Rebuild with `npm run build` then restart the service to pick up changes — the service does not build on its own.

Useful commands:

```bash
systemctl --user status rivendell
systemctl --user restart rivendell      # after a rebuild
journalctl --user -u rivendell -f        # live logs (replaces ~/.rivendell/*.out.log)
curl http://localhost:8091/api/health
```

> The `scripts/install-launchd.sh` + `com.matt.rivendell.plist` files are the legacy macOS (`launchd`) path, kept for reference only. Moria uses systemd.

## Tailscale

Once the service is healthy, expose it inside the tailnet:

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
