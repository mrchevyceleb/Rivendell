# Rivendell

Local always-on office app for Bag End. Runs on the DGX Spark "Moria" (Ubuntu) at `http://localhost:8091` as a `systemd --user` service (`rivendell.service`) and is exposed inside the tailnet via `tailscale serve`.

## Stack

- **Frontend**: React 19 + Vite 8 + TypeScript, Tailwind v4, TanStack Query, react-markdown. Dev server on `:5173` proxies API + WebSocket traffic to the API on `:8091`.
- **Server**: Express 5 + `ws` over a single Node HTTP server, run via `tsx`. Workspace at `server/`.
- **Persistence**: Supabase (`@supabase/supabase-js`, service role) for the durable job queue and Scribe events. Local JSON stores under `~/.rivendell/` for pins, tasks, room state.
- **Auth**: None at the app layer. Tailscale ACLs are the auth boundary.

## Commands (bash / Linux)

```bash
npm install
npm run dev           # concurrently: server (tsx watch) + vite
npm run build         # tsc -b && vite build && server tsc build
npm run typecheck
npm start             # production server (serves dist/ from STATIC_DIR)
```

Production on Moria (systemd `--user`, enabled + auto-restart):

```bash
systemctl --user status rivendell
systemctl --user restart rivendell    # after a rebuild
journalctl --user -u rivendell -f     # live logs
./scripts/tailscale-serve.sh          # exposes :8091 on the tailnet
```

The unit (`~/.config/systemd/user/rivendell.service`) runs `~/bin/start-rivendell-moria`, which sources the shared Doppler env (`~/.config/moria-services/doppler.env` → project `assistant-mcp`, config `prd`) and launches `./scripts/start.sh` under `doppler run`. The in-repo `scripts/install-launchd.sh` + `com.matt.rivendell.plist` are the legacy macOS path, kept for reference only.

## Layout

```
src/                    React app
  App.tsx               shell switch: GrokApp (default) or Studio (/studio)
  grok/                 Grok-style shell (GrokApp, GrokSidebar, GrokChat,
                        GrokConversation, GrokLogo, history.ts, grok.css)
  rooms/                one component per room (hosted in the Grok sidebar)
  shell/Studio.tsx      classic IDE shell: tabs + file tree (legacy, intact)
  shell/studio/         FileTree, FileTab, ChatTab, types, studio.css
  chat/                 chat client pieces (components, hooks, data, utils)
  data/                 api.ts, mock.ts, types.ts (RoomKey lives here)
  hooks/                useRoomData, useScribeSocket
  theme/, components/   primitives + ornaments
server/src/
  index.ts              express app, mounts /api/*, registers chat + scribe ws, starts worker queue
  config.ts             env resolution (PORT, STATE_DIR, SUPABASE_*, WORKER_*, MCP_*)
  routes/               one router per /api/* surface (tasks, calendar, email, family,
                        docs, pl, pins, cron, messages, weavings, scribe, summary)
  chat/                 chat server: register, runner, sessions, codex-runner, chronicle,
                        history (GET /api/chat/history = sidebar index over event logs)
  worker/               durable job queue (queue, runner, dispatchers, scribe, store)
  lib/                  supabase, doppler, MCP bridge, JSON stores, room/task/pin stores,
                        assistantAdmin/Data, workspace
supabase/migrations/    SQL migrations (queue/events tables)
scripts/                start.sh + tailscale-serve + legacy launchd plist/install (macOS)
```

Shells: `/` is the Grok Bot-style teammates app (left rail: personas = real companion lanes with home threads + history from `/api/chat/history` (titles + previews), Plugins → rooms; center: bubble chat with Thoughts pods + Jarvis mic composer; right pane: artifact desk + Routines + Session meter). Persona scopes: each teammate carries `~/.rivendell/personas/<name>.md` (who they are / what they do — editable, hot-reloaded via mtime cache, seeded from `server/src/chat/personaPrompts.ts` defaults). The scope injects into every engine (claude-family `--append-system-prompt`, codex/banana per-turn preamble), follows the FACE across rebrains, and survives compaction rotations. Forever-threads: every 100 user turns, `server/src/chat/compaction.ts` auto-compacts the model context (juicy 3000–5000-word durable summary via Grok, saved to the savemem RAG vault via assistant-mcp `memory.save_memory`, session rotated with the summary as primer) — the visible event log is never wiped; the client renders a `Memory compacted` divider. `src/grok/grok.css` carries the extracted sand tokens and remaps --r-*. `/studio` is the classic Rivendell IDE, fully intact.

## Environment

See `.env.example`. Notable knobs:

- `PORT` (default `8091`), `HOST` (default `0.0.0.0`).
- `ELROND_WORKSPACE_PATH` — defaults to `~/ASSISTANT-HUB` (Syncthing-managed; moved off OneDrive). Library/Studio reads this as a Notion-simple space tree (`inbox/`, `projects/`, `areas/`, `resources/`, `scratch/`, `Shares/`, `archive/`, `legacy/`). Hub write policy lives in `server/src/lib/hubPaths.ts` + hub `AGENTS.md`. Agents must not create top-level hub files.
- `RIVENDELL_WORKER_ENABLED` (default `true`), `RIVENDELL_WORKER_RUNNER` (`dry-run` | `claude`), `RIVENDELL_WORKER_POLL_MS`. Keep `dry-run` unless you want jobs to spawn a real headless Claude Code process.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — required for the durable queue and Scribe events.
- `RAILWAY_MCP_URL`, `ASSISTANT_MCP_TOKEN` — Railway MCP bridge. Routes fall back to local mock data when unset.
- `ASSISTANT_ADMIN_BASE_URL`, `ASSISTANT_ADMIN_TOKEN`, `ASSISTANT_MCP_ENV_PATH` — assistant-mcp admin backend. `MCP_AUTH_TOKEN` is read from the assistant-mcp `.env` automatically; only override if URL/token changes.

Secrets live in Doppler (per global rules). Never use the literal word `supabase` in a Doppler secret name — use `SB_` prefix.

## Conventions

- TypeScript everywhere. ESM (`"type": "module"`). Server imports use explicit `.ts` extensions (e.g. `./routes/tasks.ts`) — keep that style when adding routes.
- API surface is `/api/<noun>`; WebSocket surface is `/ws/...`. The SPA fallback in `server/src/index.ts` skips both prefixes.
- New room → add `src/rooms/<Name>.tsx`, register it in `src/grok/GrokApp.tsx` `ROOMS` + `src/grok/GrokSidebar.tsx` `ROOM_ENTRIES`.
- New API surface → add `server/src/routes/<name>.ts` exporting a `Router`, mount it in `server/src/index.ts`. Mirror the call from `src/data/api.ts`.
- New worker job type → add a dispatcher in `server/src/worker/dispatchers.ts`; queue persists through Supabase (`supabase/migrations/202605010001_rivendell_jobs.sql`).
- Workers must stay draft/review-first for any external side effect — that's an explicit design constraint of this app.
- JSON stores under `~/.rivendell/` are the source of truth for non-queue state; use `lib/jsonStore.ts` helpers, not ad-hoc `fs` calls.
- Frontend follows the global "every UI feels like a toy" rule (favicon, click easter eggs, floating animations, tactile hovers, etc.). Don't ship a flat room.

## Deploy / verify

- Migrations: deploy via the Supabase MCP — don't wait to be asked.
- After local changes, rebuild and restart: `npm run build && systemctl --user restart rivendell` (the service runs `npm start`, which serves the prebuilt `dist/` — it does not rebuild on its own).
- Health check: `curl http://localhost:8091/api/health`.
