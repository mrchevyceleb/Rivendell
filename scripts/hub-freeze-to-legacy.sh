#!/usr/bin/env bash
# Freeze ASSISTANT-HUB chaos into legacy/, stand up clean Notion-style spaces.
# Safe: moves only (no deletes). Prefer a recent restic snapshot first.
set -euo pipefail

HUB="${ELROND_WORKSPACE_PATH:-$HOME/ASSISTANT-HUB}"
STATE="${RIVENDELL_STATE_DIR:-$HOME/.rivendell}"
STAMP="${HUB_FREEZE_STAMP:-$(date +%Y-%m-%d)}"
FREEZE_DIR="$HUB/legacy/${STAMP}-freeze"
SESSIONS_DEST="$STATE/sessions"
DRY_RUN="${DRY_RUN:-0}"

CLOSED_DIRS=(
  inbox projects areas resources scratch Shares archive legacy
  .agents .claude .codex .github .playwright-mcp .ripley .stfolder
)
CLOSED_FILES=(
  AGENTS.md AGENTS.MD CLAUDE.md README.md home.md
  global-agent-config.md .stignore .gitignore railway.json
)

is_closed() {
  local name="$1"
  local x
  for x in "${CLOSED_DIRS[@]}" "${CLOSED_FILES[@]}"; do
    [[ "$name" == "$x" ]] && return 0
  done
  return 1
}

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY: $*"
  else
    "$@"
  fi
}

echo "== hub-freeze-to-legacy =="
echo "HUB=$HUB"
echo "FREEZE_DIR=$FREEZE_DIR"
echo "SESSIONS_DEST=$SESSIONS_DEST"
echo "DRY_RUN=$DRY_RUN"

if [[ ! -d "$HUB" ]]; then
  echo "ERROR: hub missing: $HUB" >&2
  exit 1
fi

# Hard safety: never run against /, $HOME, or a non-hub tree.
HUB_REAL="$(readlink -f "$HUB" 2>/dev/null || realpath "$HUB" 2>/dev/null || echo "$HUB")"
case "$HUB_REAL" in
  /|/home|/Users|"$HOME"|"$HOME/"|"")
    echo "ERROR: refusing to freeze unsafe path: $HUB_REAL" >&2
    exit 1
    ;;
esac
# Require hub markers (at least one control file or known history).
if [[ ! -f "$HUB_REAL/CLAUDE.md" && ! -f "$HUB_REAL/AGENTS.md" && ! -f "$HUB_REAL/AGENTS.MD" && ! -d "$HUB_REAL/.stfolder" ]]; then
  echo "ERROR: $HUB_REAL does not look like ASSISTANT-HUB (missing CLAUDE.md/AGENTS.md/.stfolder)" >&2
  exit 1
fi
# Basename check (allow ASSISTANT-HUB)
base="$(basename "$HUB_REAL")"
if [[ "$base" != "ASSISTANT-HUB" && "$base" != "assistant-hub" && -z "${HUB_FREEZE_FORCE:-}" ]]; then
  echo "ERROR: hub basename is '$base' (expected ASSISTANT-HUB). Set HUB_FREEZE_FORCE=1 to override." >&2
  exit 1
fi
HUB="$HUB_REAL"
FREEZE_DIR="$HUB/legacy/${STAMP}-freeze"

if [[ ! -d "$HOME/backups/assistant-hub" ]]; then
  echo "WARN: restic repo not found at ~/backups/assistant-hub — continue only if you accept risk"
fi

run mkdir -p \
  "$HUB/inbox" \
  "$HUB/projects" \
  "$HUB/areas" \
  "$HUB/resources" \
  "$HUB/scratch" \
  "$HUB/Shares" \
  "$HUB/archive" \
  "$FREEZE_DIR" \
  "$SESSIONS_DEST"

# Move share-deploy trees into Shares/ (stable public pages)
if [[ -d "$HUB/share-deploy" && ! -e "$HUB/Shares/pages" ]]; then
  echo "→ Shares: share-deploy → Shares/pages"
  run mv "$HUB/share-deploy" "$HUB/Shares/pages"
elif [[ -d "$HUB/share-deploy" ]]; then
  echo "→ Shares: share-deploy → freeze (Shares/pages exists)"
  run mv "$HUB/share-deploy" "$FREEZE_DIR/share-deploy"
fi

if [[ -d "$HUB/share-deploy-ypp" && ! -e "$HUB/Shares/ypp" ]]; then
  echo "→ Shares: share-deploy-ypp → Shares/ypp"
  run mv "$HUB/share-deploy-ypp" "$HUB/Shares/ypp"
elif [[ -d "$HUB/share-deploy-ypp" ]]; then
  run mv "$HUB/share-deploy-ypp" "$FREEZE_DIR/share-deploy-ypp"
fi

# Sessions out of hub
if [[ -d "$HUB/Sessions" ]]; then
  echo "→ Sessions: hub/Sessions → $SESSIONS_DEST"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY: merge Sessions into $SESSIONS_DEST (no-clobber)"
  else
    mkdir -p "$SESSIONS_DEST"
    # No-clobber copy: keep both on name collision.
    while IFS= read -r -d '' src; do
      rel="${src#"$HUB/Sessions/"}"
      dest="$SESSIONS_DEST/$rel"
      if [[ -e "$dest" ]]; then
        dest="$SESSIONS_DEST/${rel}.from-hub-${STAMP}"
      fi
      mkdir -p "$(dirname "$dest")"
      mv "$src" "$dest"
    done < <(find "$HUB/Sessions" -type f -print0)
    rm -rf "$HUB/Sessions"
  fi
fi

# Preserve structure doc into resources before reference is frozen
if [[ -f "$HUB/reference/folder-structure.md" ]]; then
  echo "→ resources: copy folder-structure.md"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY: cp folder-structure.md → resources/"
  else
    mkdir -p "$HUB/resources"
    cp -a "$HUB/reference/folder-structure.md" "$HUB/resources/folder-structure.md"
  fi
fi

# Freeze everything else not in closed set
# Skip names already handled by special-case moves (even in DRY_RUN).
SPECIAL_DONE=(Sessions share-deploy share-deploy-ypp)
is_special_done() {
  local name="$1" x
  for x in "${SPECIAL_DONE[@]}"; do
    [[ "$name" == "$x" ]] && return 0
  done
  return 1
}

# Single pass over hub root (including dot entries), no double-glob races.
while IFS= read -r -d '' entry; do
  base="$(basename "$entry")"
  [[ "$base" == "." || "$base" == ".." ]] && continue
  # skip if already closed
  if is_closed "$base"; then
    continue
  fi
  if is_special_done "$base"; then
    continue
  fi
  # never move the freeze dir into itself
  [[ "$entry" == "$FREEZE_DIR" ]] && continue
  # skip syncthing internals already covered; also skip if path is freeze parent internals
  target="$FREEZE_DIR/$base"
  if [[ -e "$target" ]]; then
    target="$FREEZE_DIR/${base}__$(date +%H%M%S)"
  fi
  echo "→ freeze: $base"
  run mv "$entry" "$target"
done < <(find "$HUB" -mindepth 1 -maxdepth 1 -print0)

# Seed maps if missing
HOME_MD="$HUB/home.md"
README_MD="$HUB/README.md"
LEGACY_MD="$HUB/legacy/README.md"
AGENTS_MD="$HUB/AGENTS.md"

write_if_missing() {
  local f="$1"
  shift
  if [[ -f "$f" ]]; then
    echo "keep existing $(basename "$f")"
    return
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY: write $f"
    return
  fi
  cat > "$f" <<'INNER'
PLACEHOLDER
INNER
}

if [[ "$DRY_RUN" != "1" ]]; then
  if [[ ! -f "$HOME_MD" ]]; then
    cat > "$HOME_MD" <<'MD'
---
title: Home
type: page
---

# ASSISTANT-HUB

Notion-simple workspace. Fixed spaces only. Agents do not invent top-level folders.

| Space | Use |
|-------|-----|
| **Inbox** | Unsorted durable notes (`inbox/YYYY-MM-DD-slug.md`) |
| **Projects** | Finite outcomes (`projects/<slug>/`) |
| **Areas** | Ongoing responsibilities (`areas/<slug>/`) |
| **Resources** | Reference, no deadline |
| **Scratch** | Ephemeral agent work (`scratch/YYYY-MM-DD/<task>/`) |
| **Shares** | Public pages → share.stonelabs.app |
| **Archive** | Cold, intentional |
| **Legacy** | Frozen pre-reorg mess (read-only). Promote on touch. |

**Kanban:** Council in Rivendell (Supabase). Not files.

**Product code:** lives in `~/samwise`, not here.

Read `AGENTS.md` for the write lock.
MD
  fi

  if [[ ! -f "$README_MD" ]]; then
    cat > "$README_MD" <<'MD'
# ASSISTANT-HUB

Shared multi-device ops + knowledge workspace (Syncthing + restic). Not a git monorepo.

## Spaces

- `inbox/` — default landing zone
- `projects/` — client and product outcomes
- `areas/` — ongoing (personal, bag-end, …)
- `resources/` — reference
- `scratch/` — ephemeral
- `Shares/` — share.stonelabs.app deploy pages
- `archive/` — cold
- `legacy/` — frozen history (hidden in Rivendell by default)

## Deploy shares

```bash
cd ~/ASSISTANT-HUB/Shares/pages   # or the specific page folder
# each page: Shares/pages/<name>/index.html → share.stonelabs.app/<name>
```

See AGENTS.md for agent write rules.
MD
  fi

  if [[ ! -f "$LEGACY_MD" ]]; then
    cat > "$LEGACY_MD" <<MD
# Legacy

Frozen hub contents from ${STAMP}.

This tree is **read-only** in Rivendell. To use something:

1. Find it under \`legacy/${STAMP}-freeze/\`
2. Copy into \`projects/<slug>/\`, \`areas/<slug>/\`, \`resources/\`, or \`inbox/\`
3. Do not write new work back into legacy

## Suggested homes for old roots

| Old | Suggested |
|-----|-----------|
| KimGarst/ | projects/kim-garst/ |
| YPP/ | projects/ypp/ |
| CrossFitThreefold/ | projects/crossfit-threefold/ |
| mjio/ | projects/mjio/ |
| personal/ | areas/personal/ |
| assistant-mcp/ | projects/assistant-mcp/ (or keep editing under samwise runtime) |
| reference/ | resources/ |
| SHARE-CROSS-COMPUTER-DEV/ | stay in legacy or external disk |
| Sessions/ | moved to ~/.rivendell/sessions/ |
| share-deploy/ | Shares/pages/ |
| tasks/, task-logs/ | Council (Supabase) is SoT |
MD
  fi
fi

echo
echo "Done. Hub root should only show closed spaces + control files."
echo "Verify: ls -1 \"$HUB\""
echo "Rivendell Studio hides legacy by default (eye toggle to show)."
