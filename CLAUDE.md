# Rivendell

Local always-on office app for Bag End. Runs on this Mac at `http://localhost:8091` as a `launchd` service (`com.matt.rivendell`) and is exposed inside the tailnet via `tailscale serve`.

## Stack

- **Frontend**: React 19 + Vite 8 + TypeScript, Tailwind v4, TanStack Query, react-markdown. Dev server on `:5173` proxies API + WebSocket traffic to the API on `:8091`.
- **Server**: Express 5 + `ws` over a single Node HTTP server, run via `tsx`. Workspace at `server/`.
- **Persistence**: Supabase (`@supabase/supabase-js`, service role) for the durable job queue and Scribe events. Local JSON stores under `~/.rivendell/` for pins, tasks, room state.
- **Auth**: None at the app layer. Tailscale ACLs are the auth boundary.

## Commands (zsh / macOS)

```bash
npm install
npm run dev           # concurrently: server (tsx watch) + vite
npm run build         # tsc -b && vite build && server tsc build
npm run typecheck
npm start             # production server (serves dist/ from STATIC_DIR)
```

Production install on this Mac:

```bash
./scripts/install-launchd.sh        # installs com.matt.rivendell with KeepAlive
./scripts/tailscale-serve.sh        # exposes :8091 on the tailnet
launchctl list | grep rivendell
tail -f ~/.rivendell/rivendell.out.log
./scripts/uninstall-launchd.sh
```

## Layout

```
src/                    React app
  App.tsx               path-based router over RoomKey ('/', '/council', ...)
  rooms/                one component per room (Hall, Council, Dashboard, ...)
  shell/Layout.tsx      app chrome
  chat/                 chat client pieces (components, hooks, data, utils)
  data/                 api.ts, mock.ts, types.ts (RoomKey lives here)
  hooks/                useRoomData, useScribeSocket
  theme/, components/   primitives + ornaments
server/src/
  index.ts              express app, mounts /api/*, registers chat + scribe ws, starts worker queue
  config.ts             env resolution (PORT, STATE_DIR, SUPABASE_*, WORKER_*, MCP_*)
  routes/               one router per /api/* surface (tasks, calendar, email, family,
                        docs, pl, pins, cron, messages, weavings, scribe, summary)
  chat/                 chat server: register, runner, sessions, codex-runner, chronicle
  worker/               durable job queue (queue, runner, dispatchers, scribe, store)
  lib/                  supabase, doppler, MCP bridge, JSON stores, room/task/pin stores,
                        assistantAdmin/Data, workspace
supabase/migrations/    SQL migrations (queue/events tables)
scripts/                launchd plist + install/uninstall + tailscale-serve + start.sh
```

Rooms map: `/` Hall, `/council` Council, `/dashboard` Dashboard, `/tidings` Tidings, `/hearth` Hearth, `/library` Library (file tree of `ELROND_WORKSPACE_PATH`), `/pins` Pins, `/reckoning` Reckoning (P&L), `/forge` Forge, `/weavings` Weavings, `/annals` Annals, `/scribe` Scribe (live worker activity log).

## Environment

See `.env.example`. Notable knobs:

- `PORT` (default `8091`), `HOST` (default `0.0.0.0`).
- `ELROND_WORKSPACE_PATH` — defaults to `~/ASSISTANT-HUB` (Syncthing-managed; moved off OneDrive). Library room reads this as a file tree; heavy folders (`node_modules`, `.git`) load on demand.
- `RIVENDELL_WORKER_ENABLED` (default `true`), `RIVENDELL_WORKER_RUNNER` (`dry-run` | `claude`), `RIVENDELL_WORKER_POLL_MS`. Keep `dry-run` unless you want jobs to spawn a real headless Claude Code process.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — required for the durable queue and Scribe events.
- `RAILWAY_MCP_URL`, `ASSISTANT_MCP_TOKEN` — Railway MCP bridge. Routes fall back to local mock data when unset.
- `ASSISTANT_ADMIN_BASE_URL`, `ASSISTANT_ADMIN_TOKEN`, `ASSISTANT_MCP_ENV_PATH` — assistant-mcp admin backend. `MCP_AUTH_TOKEN` is read from the assistant-mcp `.env` automatically; only override if URL/token changes.

Secrets live in Doppler (per global rules). Never use the literal word `supabase` in a Doppler secret name — use `SB_` prefix.

## Conventions

- TypeScript everywhere. ESM (`"type": "module"`). Server imports use explicit `.ts` extensions (e.g. `./routes/tasks.ts`) — keep that style when adding routes.
- API surface is `/api/<noun>`; WebSocket surface is `/ws/...`. The SPA fallback in `server/src/index.ts` skips both prefixes.
- New room → add `src/rooms/<Name>.tsx`, register in `App.tsx` `RoomSwitch`, and add the `RoomKey` to `src/data/types.ts` + `src/data/mock.ts` `rooms`.
- New API surface → add `server/src/routes/<name>.ts` exporting a `Router`, mount it in `server/src/index.ts`. Mirror the call from `src/data/api.ts`.
- New worker job type → add a dispatcher in `server/src/worker/dispatchers.ts`; queue persists through Supabase (`supabase/migrations/202605010001_rivendell_jobs.sql`).
- Workers must stay draft/review-first for any external side effect — that's an explicit design constraint of this app.
- JSON stores under `~/.rivendell/` are the source of truth for non-queue state; use `lib/jsonStore.ts` helpers, not ad-hoc `fs` calls.
- Frontend follows the global "every UI feels like a toy" rule (favicon, click easter eggs, floating animations, tactile hovers, etc.). Don't ship a flat room.

## Deploy / verify

- Migrations: deploy via the Supabase MCP — don't wait to be asked.
- After local changes, rebuild and the launchd service picks up automatically (`KeepAlive`). For a forced reload: `launchctl kickstart -k gui/$(id -u)/com.matt.rivendell`.
- Health check: `curl http://localhost:8091/api/health`.
