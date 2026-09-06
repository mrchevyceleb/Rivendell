/**
 * ASSISTANT-HUB structure contract.
 * Closed top-level spaces + write rules shared by workspace API, watcher, and agent prompts.
 */

export const HUB_SPACES = [
  'inbox',
  'projects',
  'areas',
  'resources',
  'scratch',
  'Shares',
  'archive',
  'legacy',
] as const;

export type HubSpace = (typeof HUB_SPACES)[number];

/** Dot / tooling dirs allowed to remain at hub root. */
export const HUB_ROOT_DOT_DIRS = [
  '.agents',
  '.claude',
  '.codex',
  '.github',
  '.playwright-mcp',
  '.ripley',
  '.stfolder',
] as const;

/** Control files allowed at hub root (humans edit; agents should not create new ones). */
export const HUB_CONTROL_FILES = new Set([
  'AGENTS.md',
  'AGENTS.MD',
  'CLAUDE.md',
  'README.md',
  'home.md',
  'global-agent-config.md',
  '.stignore',
  '.gitignore',
  'railway.json',
]);

export const HUB_ROOT_DIRS = new Set<string>([...HUB_SPACES, ...HUB_ROOT_DOT_DIRS]);

/** Default-hidden in Studio sidebar (still on disk). */
export const HUB_DEFAULT_HIDDEN_ROOTS = new Set(['legacy']);

export const HUB_WRITE_PREFIXES = [
  'inbox/',
  'projects/',
  'areas/',
  'resources/',
  'scratch/',
  'Shares/',
  'archive/',
] as const;

/** Top-level names that must never be deleted or renamed away. */
export const HUB_PROTECTED_ROOTS = new Set<string>([
  ...HUB_SPACES,
  ...HUB_ROOT_DOT_DIRS,
  ...HUB_CONTROL_FILES,
]);

export type HubWriteOp = 'write' | 'create' | 'rename-to' | 'rename-from' | 'delete';

export type HubWriteOpts = {
  /** For create/rename-to: whether the entry is a file or directory. */
  kind?: 'file' | 'directory';
};

export function normalizeHubRel(relPath: string): string {
  const raw = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
  const parts = raw.split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) {
    throw policyError('Path must not contain ".." segments.');
  }
  return parts.join('/');
}

export function hubTopLevel(relPath: string): string {
  const n = normalizeHubRel(relPath);
  if (!n) return '';
  return n.split('/')[0] ?? '';
}

export function isHubLegacyPath(relPath: string): boolean {
  const n = normalizeHubRel(relPath);
  return n === 'legacy' || n.startsWith('legacy/');
}

export function isHubRootPath(relPath: string): boolean {
  const n = normalizeHubRel(relPath);
  return n !== '' && !n.includes('/');
}

export function isClosedHubRootName(name: string): boolean {
  return HUB_ROOT_DIRS.has(name) || HUB_CONTROL_FILES.has(name);
}

export function isHubRootPollution(relPath: string): boolean {
  try {
    const n = normalizeHubRel(relPath);
    if (!n || n.includes('/')) return false;
    if (n.startsWith('.') && HUB_ROOT_DIRS.has(n)) return false;
    return !isClosedHubRootName(n);
  } catch {
    return true;
  }
}

function policyError(message: string): Error {
  return Object.assign(new Error(message), { code: 'EHUBPOLICY' });
}

function isWritableSpacePath(n: string): boolean {
  if (HUB_WRITE_PREFIXES.some((p) => n.startsWith(p))) return true;
  // Allow writing the space directory itself (bootstrap), but not as a file.
  return HUB_SPACES.includes(n as HubSpace);
}

/**
 * Enforce hub structure on create/write/rename/delete.
 * - legacy/ is read-only (no write/create/rename-from/delete of contents for promotion via rename)
 * - only closed write prefixes accept nested creates/writes
 * - protected roots cannot be deleted or renamed away
 */
export function assertHubStructureWrite(
  relPath: string,
  op: HubWriteOp,
  opts?: HubWriteOpts,
): void {
  const n = normalizeHubRel(relPath);
  if (!n) throw policyError('Cannot modify the hub root itself.');

  const top = hubTopLevel(n);
  const nested = n.includes('/');
  const isLegacy = top === 'legacy';

  // Legacy is fully locked for mutations that change content. Deletes of litter
  // under legacy are also blocked so the freeze stays intact; promote = copy out.
  if (isLegacy) {
    throw policyError(
      'legacy/ is read-only. Copy what you need into inbox/, projects/, areas/, resources/, or scratch/ to promote it.',
    );
  }

  if (!nested) {
    // Top-level entry
    if (HUB_PROTECTED_ROOTS.has(top)) {
      if (op === 'delete' || op === 'rename-from') {
        throw policyError(`Protected hub root "${top}" cannot be deleted or renamed.`);
      }
      if (op === 'create' || op === 'rename-to') {
        // Spaces and dot dirs must be directories; control files must be files.
        if (HUB_ROOT_DIRS.has(top)) {
          if (opts?.kind === 'file') {
            throw policyError(`"${top}" must be a directory, not a file.`);
          }
          return;
        }
        if (HUB_CONTROL_FILES.has(top)) {
          if (opts?.kind === 'directory') {
            throw policyError(`"${top}" must be a file, not a directory.`);
          }
          // Allow writing/updating existing control files; creating missing ones is ok for bootstrap.
          return;
        }
      }
      // write to control file / existing space marker — ok
      if (op === 'write') return;
      return;
    }

    // Illegal root name
    if (op === 'delete') return; // cleanup litter
    throw policyError(
      `Hub root is locked. "${top}" is not an allowed top-level name. ` +
        `Use inbox/, projects/, areas/, resources/, scratch/, Shares/, or archive/.`,
    );
  }

  // Nested path: only closed write prefixes.
  if (!isWritableSpacePath(n) && !HUB_WRITE_PREFIXES.some((p) => n.startsWith(p))) {
    // rename-from / delete of unknown nested trees: allow cleanup of pre-freeze leftovers if any remain
    if (op === 'delete' || op === 'rename-from') return;
    throw policyError(
      `Writes are limited to inbox/, projects/, areas/, resources/, scratch/, Shares/, and archive/. Path "${n}" is outside the closed schema.`,
    );
  }

  if (op === 'create' || op === 'rename-to' || op === 'write' || op === 'delete' || op === 'rename-from') {
    return;
  }
}

/** Short contract injected into TARDIS / Codex prompts. */
export const HUB_WRITE_LOCK_PROMPT = [
  'ASSISTANT-HUB filesystem lock (non-negotiable):',
  '1. Hub root is READ-ONLY except existing control files (AGENTS.md, CLAUDE.md, README.md, home.md). Never create new top-level files or folders.',
  '2. New durable notes → inbox/YYYY-MM-DD-kebab-title.md only.',
  '3. Implementation debris → scratch/YYYY-MM-DD/<task-slug>/.',
  '4. Project work → projects/<slug>/... ; ongoing responsibilities → areas/<slug>/... ; reference → resources/.',
  '5. Public one-off HTML → Shares/<name>/index.html (share.stonelabs.app).',
  '6. Never write under legacy/ or invent parallel trees (notes/, tmp/, output/, Sessions/, docs/ at root).',
  '7. archive/ only when the user says to archive something.',
  '8. Council/Supabase tasks tool is the real kanban. Do not create TODO.md boards.',
  '9. If unsure where a file goes → inbox/. Read home.md and AGENTS.md for the map.',
  '10. Session logs do NOT go in the hub. Use ~/.rivendell/sessions/ if you must write a session file.',
].join(' ');
