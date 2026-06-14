# Rivendell redesign — the Studio shell

Reimagining the frontend into a WebStorm-grade IDE. Backend (real Claude/Codex CLI,
file CRUD, cron, Tailscale, systemd) is reused untouched. This is a cockpit rebuild.

## Matt's locked decisions
- No left activity sidebar. Removed.
- File tree stays present and prominent (leftmost), collapsible.
- Navigation lives in a **top bar**. The tab strip is the navigation.
- Tabs are **content**, not rooms: a file opens as an editor tab, Elrond as a chat
  tab, Forge as its own tab.
- Keep the Rivendell identity (name, gold accent, lore touches) on an otherwise
  calm pro-IDE dark theme.
- Drop the 13 rooms from the UI. Only chat + docs + Forge. (Room code stays in repo.)

## Build plan — CUT 1 SHIPPED (2026-06-14, live on Moria)
- [x] Read shell, theme tokens, chat + editor + tree + Forge interfaces
- [x] `src/shell/studio/types.ts` — tab model
- [x] `src/shell/studio/FileTree.tsx` — present, collapsible tree + CRUD (lifted from Workspace)
- [x] `src/shell/studio/FileTab.tsx` — CodeMirror editor pane per file (lifted from Workspace)
- [x] `src/shell/studio/ChatTab.tsx` — Elrond chat pane per chat (useChat + Conversation, compact)
- [x] `src/shell/Studio.tsx` — top bar + tree + tabbed content + status bar
- [x] `src/shell/studio/studio.css` — IDE shell styles
- [x] `src/App.tsx` — render `<Studio/>`, keep deep-link `?path=` -> file tab
- [x] build + restart rivendell.service + Playwright verify (file tab, Forge tab, collapse, both themes, 0 errors)

## Cut 1 scope
Tabbed center (file / chat / forge), full width each. Tree present + collapsible.
Top bar nav. Status bar. Pro theme + gold identity. Land on a chat tab (no void).

## Feedback round 1 (2026-06-14, shipped + verified)
- [x] Forge: active crons sorted to top, cards made compact (1-line desc, tighter padding)
- [x] HTML/code editor word-wrap hardened (lineWrapping + overflow-wrap anywhere, no h-scroll)
- [x] UI zoom control in top bar (70–200%, persisted) — reading-glasses friendly
- [x] Local engine: vLLM:8000 -> LM Studio :1234 (RIVENDELL_LOCAL_LLM_BASE_URL), label "Local · LM Studio", lists whatever LM Studio has loaded
- [x] Broken Sam avatar -> Evenstar gold mark; message name "Samwise" -> agent name (Elrond)
- Note: PWA SW is pass-through; a stale in-memory tab needs a refresh to pick up new deploys.

## Feedback round 2 (2026-06-14)
- [x] Chat "asleep when working" bug: sessionClosed now auto-reconnects (matches samwise-2);
      added 45s stream watchdog; status label 'asleep' -> 'reconnecting'.
- [x] Chat CSS: user bubble was `background: var(--ink)` (white on dark) -> elf-blue tint;
      message font 19px -> 15px.
- [x] **Z.ai coding plan added to chat** (GLM 5.2 / GLM 5.1). New `zai` engine runs through
      the claude CLI with ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic + ANTHROPIC_AUTH_TOKEN=
      Z_AI_API_KEY (assistant-mcp Doppler) and a clean ~/.claude-zai config dir (no OAuth bleed).
      Verified live: GLM-5.2 self-identifies. Companion "Z.ai · GLM" + model picker.

## Feedback round 3 (2026-06-14) — Forge full engine support SHIPPED
Took the cron executor off life support. A Forge cron can now run on ANY chat engine.
- **assistant-mcp-runtime/server** (the local cron runner, :8771):
  - New `src/lib/cron-engines.ts`: `resolveEngine(engine, modelId)` → account env (kim/personal),
    Z.ai env redirect (~/.claude-zai), or HTTP (OpenRouter / LM Studio). Mirrors Rivendell's runner.
  - `claude-cli.ts` + `codex-cli.ts`: now accept `env` + `model`.
  - `cron-engine.ts runAiPromptLocalCli`: dispatches on `action_config.engine` (+ `model_id`);
    legacy `model`='claude'|'codex' still maps to KG account. HTTP engines run via `runHttpCompletion`.
  - Built (dist) + `assistant-cron.service` restarted.
- **Rivendell**: `assistantData.ts` passes `engine` + `model_id` through action_config both ways;
  `CronJob`/`RivendellCronJob` gained `engine`/`modelId`; Forge editor replaced the 3-way toggle with
  an **Engine dropdown (7 engines) + Model field**; all engine jobs use runtime=local.
- **Verified live:** created a `zai`/`glm-5.2` cron, run-now → logs show
  `spawning claude ... (model=glm-5.2, permissionMode=bypassPermissions)` → "completed successfully".
  Codex + assistant engines also route correctly. Test cron deleted.
- **ALL engines run-tested live (2026-06-14):**
  - zai/glm-5.2 → claude CLI redirect ✅
  - codex default ✅ and codex custom model gpt-5.5 (`--model`) ✅
  - assistant (KG Claude) ✅
  - banana (OpenRouter, openai/gpt-4o-mini) ✅ — POST openrouter.ai 200
  - banana-local (LM Studio, qwen/qwen3.5-9b) ✅ — POST localhost:1234 200 (also direct-curl verified)
  - Personal Claude / Personal Codex: same resolveEngine path as KG, just .claude-personal /
    .codex-personal config dirs (mechanism identical to the KG runs that passed).
  All test crons created via Forge API, run-now, confirmed non-failed, then deleted.

## Forge "any model for crons" — RESOLVED (was: blocked on external executor)
Forge's /api/cron is a thin proxy. Crons actually EXECUTE in assistant-mcp (railway runtime)
and assistant-cron.service (:8771, local runtime) — separate repos, not Rivendell. CronAiModel
is claude|codex|mandrill. Expanding the Forge picker to the full chat engine set (KG/Personal
Claude+Codex, OpenRouter, Local, Z.ai) needs those executors to support the engines, or crons
fail at run time. Decision pending from Matt: extend the cron executor(s)?

## Next cuts
- Drag-to-split (file + chat side by side)
- Command palette
- Editor tabs reorder, multi-file find
