# AGENTS.md

This file mirrors `CLAUDE.md` for any agent runtime that reads `AGENTS.md` (Codex, Cursor, etc.). Keep the two in sync.

## Project

Rivendell — local always-on office app for Bag End, served from the DGX Spark "Moria" (Ubuntu) on `:8091` and exposed inside the tailnet via `tailscale serve`. No app-layer auth; Tailscale ACLs are the auth boundary.

## Stack

- **Frontend**: React 19 + Vite 8 + TypeScript, Tailwind v4, TanStack Query, react-markdown. Vite dev on `:5173` proxies API + WS to `:8091`.
- **Server**: Express 5 + `ws` on one Node HTTP server, run via `tsx`. Workspace at `server/`.
- **Persistence**: Supabase (service role) for durable job queue + Scribe events. Local JSON stores under `~/.rivendell/`.

## Commands (bash / Linux)

```bash
npm install
npm run dev           # server (tsx watch) + vite, concurrently
npm run build         # tsc -b && vite build && server tsc build
npm run typecheck
npm start             # production server, serves dist/
```

Production on Moria (`systemd --user`, enabled + auto-restart):

```bash
systemctl --user status rivendell
npm run build && systemctl --user restart rivendell   # rebuild + reload
journalctl --user -u rivendell -f                     # live logs
./scripts/tailscale-serve.sh
```

Unit `~/.config/systemd/user/rivendell.service` runs `~/bin/start-rivendell-moria` (loads `~/.config/moria-services/doppler.env` → project `assistant-mcp`/`prd`, then `./scripts/start.sh` under `doppler run`). The in-repo `install-launchd.sh` + `com.matt.rivendell.plist` are the legacy macOS path.

Health: `curl http://localhost:8091/api/health`.

## Layout

```
src/
  App.tsx                  path-based router over RoomKey
  rooms/                   one component per room
  shell/Layout.tsx         app chrome
  chat/                    chat client (components, hooks, data, utils)
  data/                    api.ts, mock.ts, types.ts (RoomKey)
  hooks/, theme/, components/, utils/
server/src/
  index.ts                 express app + chat + scribe ws + worker queue
  config.ts                env resolution
  routes/                  /api/* routers (tasks, calendar, email, family,
                           docs, pl, pins, cron, messages, weavings,
                           scribe, summary)
  chat/                    register, runner, sessions, codex-runner, chronicle
  worker/                  queue, runner, dispatchers, scribe, store
  lib/                     supabase, doppler, mcp, jsonStore, room/task/pin
                           stores, assistantAdmin/Data, workspace
supabase/migrations/       queue/events SQL
scripts/                   start.sh + tailscale-serve + legacy launchd plist/install
```

Rooms: `/` Hall, `/council`, `/dashboard`, `/tidings`, `/hearth`, `/library`, `/pins`, `/reckoning` (P&L), `/forge`, `/weavings`, `/annals`, `/scribe`.

## Environment

See `.env.example`. Key vars:

- `PORT` (8091), `HOST` (0.0.0.0).
- `ELROND_WORKSPACE_PATH` — defaults to `~/ASSISTANT-HUB` (Syncthing-managed; moved off OneDrive). Library reads this as a file tree; `node_modules` and `.git` load on demand.
- `RIVENDELL_WORKER_ENABLED` (true), `RIVENDELL_WORKER_RUNNER` (`dry-run` | `claude`), `RIVENDELL_WORKER_POLL_MS`. Default to `dry-run` unless explicitly running real headless Claude Code.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — required for durable queue and Scribe events.
- `RAILWAY_MCP_URL`, `ASSISTANT_MCP_TOKEN` — Railway MCP bridge. Routes fall back to local mock data when unset.
- `ASSISTANT_ADMIN_BASE_URL`, `ASSISTANT_ADMIN_TOKEN`, `ASSISTANT_MCP_ENV_PATH` — assistant-mcp admin backend. `MCP_AUTH_TOKEN` auto-read from the assistant-mcp `.env`.

Secrets live in Doppler. Never put the literal word `supabase` in a Doppler secret name — use `SB_` prefix.

## Conventions

- TypeScript + ESM (`"type": "module"`).
- Server imports use explicit `.ts` extensions (`./routes/tasks.ts`). Match this when adding routes.
- API surface: `/api/<noun>`. WebSocket surface: `/ws/...`. SPA fallback in `server/src/index.ts` skips both.
- **New room** → add `src/rooms/<Name>.tsx`, register in `App.tsx` `RoomSwitch`, extend `RoomKey` in `src/data/types.ts` and `rooms` in `src/data/mock.ts`.
- **New API surface** → add `server/src/routes/<name>.ts` exporting a `Router`, mount in `server/src/index.ts`, mirror the call in `src/data/api.ts`.
- **New worker job** → add a dispatcher in `server/src/worker/dispatchers.ts`; the queue persists through Supabase (`supabase/migrations/202605010001_rivendell_jobs.sql`).
- Workers stay **draft/review-first** for any external side effect. Hard design constraint.
- Use `lib/jsonStore.ts` helpers for `~/.rivendell/` state, not ad-hoc `fs`.
- Frontend follows the "every UI feels like a toy" rule: favicon, click easter eggs, floating background animations, tactile hovers, scrolling tickers, playful micro-interactions. Not optional.

## Workflow expectations

- Run migrations and Edge Function deploys via Supabase MCP yourself; don't wait to be asked.
- Run typecheck before declaring work done. After a complete task, run `/codex-fix` once.
- Never commit as a co-author on this repo. Commits are Matt's.
