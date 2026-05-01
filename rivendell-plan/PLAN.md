# Rivendell — Build Plan

The local always-on web app that lives on the Mac Mini (Bag End), accessible
over Tailscale, and houses the AI employee.

> Samwise (the chat cockpit) stays separate. Rivendell is the office. They
> share Supabase, share the Mac Mini, and link to each other — but they are
> two apps, not one.

---

## 1. What Rivendell is and is not

**Is:**
- A web app served from the Mac Mini (Bag End) on a Tailscale port, always on.
- The "office" — task board, calendar, inbox, family ops, P&L, sessions, cron
  jobs, employee queue, live activity log.
- The home of the AI employee (headless worker process).
- A consumer of the existing Railway MCP server (no MCP migration).
- Visually: the Rivendell design system (LOTR / Imladris parchment + starlight,
  dark + light themes). Mockups in `design-mockups/`.

**Is not:**
- A chat app. Chat lives in Samwise (port `:8090`). Rivendell *links* to it.
- A replacement for Railway. The MCP server, RAG API, webhook receivers, and
  cron schedulers stay on Railway.
- An autofix bot. That's still `autofix-bot` (formerly Samwise-1) on Railway.

---

## 2. Vocabulary (locked)

| Name           | Thing                                                        |
| -------------- | ------------------------------------------------------------ |
| **Bag End**    | The Mac Mini. Always on, Tailscale.                          |
| **Samwise**    | Chat cockpit. Separate app. Lives at `bagend:8090`.          |
| **Rivendell**  | This app. Office + employee. Lives at `bagend:8091` (TBD).   |
| **Autofix-bot**| Specialist PR machine on Railway. Unchanged.                 |
| **The worker**| Headless process inside Rivendell that runs Claude Code jobs.|

The **rooms** of Rivendell (mockup names → role):

| Route        | Room        | Role                                                   |
| ------------ | ----------- | ------------------------------------------------------ |
| `/`          | The Hall    | Landing / overview. Today at a glance.                 |
| `/council`   | The Council | Task board. Replaces current Tasks page.               |
| `/tidings`   | Tidings     | Unified email inbox.                                   |
| `/ravens`    | Ravens      | Messages — Slack/Telegram/Twilio.                      |
| `/hearth`    | Hearth      | Family ops — todos, bills, debts, budget, meal plans.  |
| `/library`   | Library     | Mobile docs / references.                              |
| `/reckoning` | Reckoning   | P&L tracker.                                           |
| `/forge`     | Forge       | Cron jobs + build/deploy log.                          |
| `/weavings`  | Weavings    | The employee's Kanban — what's queued, running, done.  |
| `/annals`    | Annals      | Past sessions — Claude / Codex chronicle.              |
| `/scribe`    | Scribe      | Live activity log — every tool call, streaming.        |

Naming is locked to the Rivendell mockup. Don't rename to "Tasks", "Email", etc.

---

## 3. Source materials (already in this folder)

- `admin-ui-current/` — current admin-ui code, copied from
  `ASSISTANT-HUB/assistant-mcp/admin-ui`. Use as reference for what backend
  endpoints, hooks, and Supabase queries already exist. Not the build target.
- `design-mockups/` — Rivendell design system. Vanilla React + CSS.
  - `Rivendell.html`, `app.jsx`, `shell.jsx`, `hall.jsx`, `rooms.jsx`,
    `mobile.jsx`, `ornaments.jsx`, `ios-frame.jsx`, `tweaks-panel.jsx`
  - `rivendell.css` — full design system, dark + light themes, animations.
  - `screenshots/` — reference renders.
- `C:\PERSONAL-PROJECTS\samwise-2\` — chat code to **port directly** (don't
  rebuild). See section 6.

---

## 4. Stack

- **Frontend:** Vite + React 19 + TypeScript + Tailwind 4 + TanStack Query.
  Same family as samwise-2 and admin-ui — the chat code drops in cleanly.
- **Server:** Node + Express + ws (websocket).
  Same shape as samwise-2's server.
- **Auth:** Tailscale-only. No password layer initially. Tailscale ACLs are
  the gate. Optional bearer token later if you ever expose publicly (don't).
- **State:** Supabase (existing project `iycloielqcjnjqddeuet`). Same tables
  the PWA already uses. No new schema unless a feature demands it.
- **Process manager:** launchd plist (mirror samwise-2's `com.matt.samwise-2.plist`).
- **Port:** `:8091` (claim it; samwise-2 owns `:8090`).
- **Domain on tailnet:** `rivendell.<tailnet>` via Tailscale serve, optional.

---

## 5. Repo layout

```
C:\PERSONAL-PROJECTS\rivendell\           ← new build target on Mac
├── README.md
├── package.json                          ← workspace root
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig*.json
├── index.html
├── public/
├── src/                                  ← frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── tokens.css                        ← from design-mockups/rivendell.css
│   ├── index.css
│   ├── theme/                            ← dark/light tokens, ornaments
│   ├── shell/                            ← Sidebar, Layout, Topbar
│   ├── rooms/
│   │   ├── Hall.tsx
│   │   ├── Council.tsx
│   │   ├── Tidings.tsx
│   │   ├── Ravens.tsx
│   │   ├── Hearth.tsx
│   │   ├── Library.tsx
│   │   ├── Reckoning.tsx
│   │   ├── Forge.tsx
│   │   ├── Weavings.tsx
│   │   ├── Annals.tsx
│   │   └── Scribe.tsx
│   ├── chat/                             ← ported from samwise-2/src/...
│   ├── hooks/
│   ├── data/                             ← Supabase client, query keys
│   ├── components/                       ← primitives (cards, buttons, etc.)
│   └── utils/
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                      ← Express + ws + static
│       ├── chat/                         ← ported from samwise-2/server/src/
│       │   ├── runner.ts                 ← claude -p stream-json runner
│       │   ├── codex-runner.ts
│       │   ├── sessions.ts               ← per-(cli, repo) session store
│       │   ├── commands.ts
│       │   ├── chronicle.ts
│       │   └── repos.ts
│       ├── worker/                       ← NEW — the AI employee
│       │   ├── queue.ts                  ← reads Supabase tasks
│       │   ├── runner.ts                 ← spawns headless claude -p
│       │   ├── dispatchers.ts            ← per-skill (PR, email draft, etc.)
│       │   └── status.ts                 ← updates Supabase task state
│       ├── routes/
│       │   ├── tasks.ts
│       │   ├── calendar.ts
│       │   ├── email.ts
│       │   ├── family.ts
│       │   ├── docs.ts
│       │   ├── pl.ts
│       │   ├── cron.ts
│       │   ├── messages.ts
│       │   └── scribe.ts                 ← ws stream of worker activity
│       ├── lib/
│       │   ├── supabase.ts
│       │   ├── mcp.ts                    ← Railway MCP HTTP client
│       │   └── doppler.ts
│       └── config.ts
└── scripts/
    ├── start.sh
    ├── install-launchd.sh
    ├── uninstall-launchd.sh
    └── com.matt.rivendell.plist
```

---

## 6. Chat — port from samwise-2 (do not rebuild)

The Samwise-2 chat is already debugged. The job is to **lift and namespace**,
not rewrite.

### 6a. Server-side files to port (`samwise-2/server/src/` → `rivendell/server/src/chat/`):

- `runner.ts` — owns the persistent `claude -p --input-format stream-json
  --output-format stream-json --include-partial-messages
  --dangerously-skip-permissions` child process per `(cli, repo)`. Keep all
  the stream-json plumbing as-is.
- `codex-runner.ts` — Codex variant.
- `sessions.ts` — `~/.samwise-2/sessions.json` mapping `(cli, repo) → session_id`.
  **Change the path to `~/.rivendell/chat-sessions.json`** so the two apps
  don't fight over the same file.
- `commands.ts` — slash-command handling.
- `chronicle.ts` — scans `~/.claude/projects/<encoded-cwd>/*.jsonl` for past
  sessions.
- `repos.ts` — discovers repos from `~/code`, `~/samwise/Personal-Apps`,
  `~/Documents/PERSONAL-PROJECTS`, plus pinned ASSISTANT-HUB.

### 6b. Frontend files to port (`samwise-2/src/` → `rivendell/src/chat/`):

- `hooks/useChat.ts`, `hooks/useChronicle.ts`, `hooks/useCommands.ts`,
  `hooks/useLive.ts`, `hooks/useRepos.ts` — all the chat plumbing.
- `components/desktop/`, `components/mobile/`, `components/primitives/` —
  reusable chat UI primitives. **Re-skin** to match Rivendell's design
  tokens (parchment + starlight) instead of samwise-2's reading-room palette.
  Keep the structure; swap CSS variables and class names.

### 6c. Where chat appears in Rivendell

**Two integration points, both deep-link to standalone Samwise rather than
embedding fully:**

1. **The Hall (landing page):** small "talk to Sam" card → opens Samwise in a
   new tab at `bagend:8090`.
2. **Per-room "Open in Samwise" buttons:** on Council task cards, Tidings
   email items, Weavings queue items, etc. Pre-selects the right repo when
   it makes sense. Uses query string: `bagend:8090?repo=<encoded>`.

> **Decision point:** do we *also* need an inline chat panel in Rivendell, or
> is "open Samwise" enough? **Default = enough.** Samwise is one click away
> on the same tailnet. Don't duplicate the surface. Revisit only if we find
> ourselves wanting to chat *while looking at* a Rivendell room.

---

## 7. Backend — what each route does

For each room, the server route is mostly a thin Supabase wrapper plus a few
calls into the Railway MCP server for live data (Gmail, Calendar, Drive).

| Route                  | Reads                              | Writes                          |
| ---------------------- | ---------------------------------- | ------------------------------- |
| `/api/tasks`           | Supabase `tasks`                   | create / update / complete      |
| `/api/calendar`        | MCP `calendar` tool                | drafts only (no auto-send)      |
| `/api/email`           | MCP `gmail` tool                   | drafts only                     |
| `/api/family`          | Supabase `family_*` tables         | create / update                 |
| `/api/docs`            | Supabase `mobile_docs`             | create / update                 |
| `/api/pl`              | MCP `plTracker`                    | passthrough                     |
| `/api/cron`            | Supabase `cron_jobs`               | create / update / pause         |
| `/api/messages`        | MCP `slack` + `telegram`           | drafts only                     |
| `/api/weavings/queue`  | Supabase worker queue (NEW table)  | enqueue, cancel, retry          |
| `/ws/scribe`           | Worker stdout streamer             | -                               |

**Authoring conventions:**
- All MCP calls go through one HTTP client at `server/src/lib/mcp.ts`. Bearer
  token from Doppler. No per-route SDK wiring.
- Supabase access via service-role key from Doppler (server-side only).
  Frontend uses anon key for the few client-side reads it needs.
- All "send" actions (email, Slack, Telegram, calendar) **draft only by
  default.** Confirm-then-send. Same rule as the rest of the system.

---

## 8. The worker (the AI employee)

A separate Node process inside the Rivendell server, started alongside the
HTTP server. Job:

1. Poll Supabase worker-queue table every N seconds (or subscribe via
   realtime). New table — schema below.
2. For each new job, look up the dispatcher by `skill` field.
3. Spawn a headless `claude -p` with the job's prompt, repo, and tool
   constraints. Stream stdout to a websocket clients on `/ws/scribe`.
4. On completion, update job status, store result + artifacts, post to
   Supabase. Post a row to the chronicle.
5. If the job needs human approval (e.g. send email, push commit), park it
   in a `needs_review` state and notify via Telegram.

### Supabase schema (NEW)

```sql
create table rivendell_jobs (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz default now(),
  status          text not null check (status in
                   ('queued','running','needs_review','done','failed','cancelled')),
  skill           text not null,                -- 'fix-bug', 'draft-reply', etc.
  source          text,                         -- 'cron', 'webhook', 'manual'
  source_ref      text,                         -- ticket id, email id, etc.
  repo            text,
  prompt          text,
  result          jsonb,
  error           text,
  needs_review_reason text,
  approved_at     timestamptz,
  completed_at    timestamptz
);

create table rivendell_job_events (
  id              bigint generated always as identity primary key,
  job_id          uuid references rivendell_jobs(id) on delete cascade,
  ts              timestamptz default now(),
  level           text,                         -- 'thinking','tool','note','system'
  text            text,
  payload         jsonb
);
```

The Scribe room reads `rivendell_job_events` via realtime subscription.
The Weavings room reads `rivendell_jobs` and groups by status.

### Skills (initial set)

- `draft-customer-reply` — Operly / Kim support, drafts only.
- `draft-email` — generic, any account.
- `pull-dashboard-data` — Mon/Fri Kim + YPP, Mon/Thu CrossFit Threefold.
- `weekly-research` — Banana Code competitive watch, etc.
- `triage-feedback-ticket` — first-pass on incoming tickets.
- `dispatch-to-autofix-bot` — handoff a code-fix-shaped job to Railway's
  autofix-bot.

> Worker explicitly does **not** open PRs itself. PR-shaped jobs hand off to
> autofix-bot. Keeps each app focused.

---

## 9. Cron — where schedules live

- **Existing Railway cron** stays as-is for triage / autofix-bot triggers.
- **New Rivendell cron** uses launchd-spawned `node` jobs that POST to
  `http://localhost:8091/api/weavings/queue` with a job spec. Examples:
  - `0 6 * * 1,5` — Monday/Friday 6am: enqueue Kim dashboard prep.
  - `0 6 * * 1,4` — Monday/Thursday 6am: CrossFit Threefold dashboard prep.
  - `0 7 * * *` — every day: morning briefing.
  - `0 * * * *` — hourly: poll Operly support tickets, triage new ones.

The Forge room shows the cron list and lets you pause / run-now.

---

## 10. Mobile

Mockup includes a mobile shell with iPhone frame (`mobile.jsx`, `ios-frame.jsx`).
Don't ship the iPhone frame to production — that's a design preview. The
mobile layout itself (single column, bottom tabbar) is the real artifact.

Use Tailwind responsive breakpoints. Sidebar collapses to bottom tabbar
under `md`. Same components, different shell.

---

## 11. Build order (do this on the Mac in order)

**Phase 1 — Shell + theme (1 evening)**
1. `npm create vite@latest` → React + TS + Tailwind setup at
   `~/PERSONAL-PROJECTS/rivendell/`.
2. Port `design-mockups/rivendell.css` → `src/tokens.css`. Wire dark/light
   theme switch.
3. Convert `shell.jsx` (sidebar, layout) to a real Tailwind/TS component.
4. Stub all 11 rooms with their headers and a "coming soon" body.
5. Tweaks panel kept as a dev-mode floating widget; gated by env var.

**Phase 2 — Server skeleton (1 evening)**
6. Init `server/`. Express + ws. `/health`, static file serve from `dist/`.
7. Lib: Supabase client, MCP HTTP client (via Railway), Doppler env loader.
8. launchd plist + install script. Service runs on `:8091`.

**Phase 3 — Port chat (1-2 evenings)**
9. Lift `samwise-2/server/src/{runner,codex-runner,sessions,commands,
    chronicle,repos}.ts` into `server/src/chat/`. Change session file path
    to `~/.rivendell/chat-sessions.json`.
10. Lift `samwise-2/src/hooks/*` and chat components into `src/chat/`.
    Re-skin to Rivendell tokens.
11. Decide: inline chat in Rivendell, or just deep-link to Samwise? Default:
    deep-link. Add per-room "Open in Samwise" buttons.

**Phase 4 — Wire the rooms one at a time (one room per session)**
12. Council (tasks). Existing admin-ui Tasks page logic ports cleanly.
13. Hall — pulls a few summary counts from each room.
14. Tidings (email) — MCP `gmail`.
15. Hearth (family) — Supabase family_* tables.
16. Reckoning (P&L) — MCP plTracker.
17. Forge (cron) — Supabase cron_jobs + new launchd schedules.
18. Library (docs) — Supabase mobile_docs.
19. Annals (sessions) — chronicle reader.
20. Ravens (Slack + Telegram) — drafts only.
21. Weavings + Scribe — worker queue + live event stream.

**Phase 5 — The worker (1-2 evenings)**
22. Supabase migration: `rivendell_jobs`, `rivendell_job_events`.
23. Implement queue poller, dispatcher table, headless `claude -p` spawn.
24. Wire 2-3 starter skills (draft-customer-reply, pull-dashboard-data,
    triage-feedback-ticket).
25. Add launchd cron entries that POST jobs.

**Phase 6 — Polish**
26. Mobile breakpoints.
27. Telegram notifications on `needs_review`.
28. Tailscale serve for `rivendell.<tailnet>` if desired.

---

## 12. What stays where (final architecture)

```
Bag End (Mac Mini, always on, Tailscale)
├── Samwise          :8090   chat cockpit, untouched
├── Rivendell        :8091   office + worker
└── (room for more rooms in the house later)

Railway (unchanged)
├── assistant-mcp server     all MCP tools
├── autofix-bot              code-fix specialist
├── webhook receivers        Slack, Telegram, PushPress, etc.
└── existing cron schedulers triage etc.

Supabase (shared by everyone)
├── tasks, family_*, mobile_docs, cron_jobs, etc.   (existing)
└── rivendell_jobs, rivendell_job_events            (new)

Vercel
└── client-facing only       kgapplabs, share.stonelabs.app, Operly, etc.
```

---

## 13. Open questions to settle on Mac before building

1. **Inline chat in Rivendell, yes or no?** Default no (deep-link to Samwise).
2. **Worker on/off switch.** Single env var or a UI toggle in Settings?
3. **Telegram notifications** — same bot the assistant already has, or new
   one for Rivendell specifically? Default: reuse.
4. **Dev mode tweaks panel** — keep in production behind `?tweaks=1` or
   strip entirely on build? Default: behind query string.
5. **Codex** — port the runner now or stub for later? Default: port now,
   it's already in samwise-2. Cheap to bring.

---

## 14. Non-goals

- No Railway migration. MCP server, RAG, webhook receivers, autofix-bot stay.
- No Electron / no Tauri. Web app only.
- No public-internet exposure. Tailscale only.
- No new auth system. Tailscale ACLs are the auth.
- No password reset, user management, etc. Single-user app.
- No iPhone frame in production (mockup only).
- No sync layer for Supabase — both ends just hit it directly.
