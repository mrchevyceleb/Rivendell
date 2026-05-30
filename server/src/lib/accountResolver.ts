// Single source of truth for which Claude Code / Codex account a workspace uses.
// Reads the canonical map at ~/samwise/.accounts/account-map.json — the same file
// the shell resolver (~/samwise/.bin/resolve-account) reads for interactive terminals.
// Maps a spawn `cwd` to the right CLAUDE_CONFIG_DIR / CODEX_HOME so the Kim and
// Personal accounts never collide. See ~/samwise/MATT-OS-V2-PLAN.md.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

interface Account {
  claude_config_dir: string;
  codex_home: string;
}
interface AccountMap {
  accounts: Record<string, Account>;
  default_account: string;
  rules: Array<{ prefix: string; account: string }>;
}

const HOME = homedir();
const MAP_PATH = join(HOME, 'samwise', '.accounts', 'account-map.json');

let cached: AccountMap | null | undefined;
function loadMap(): AccountMap | null {
  if (cached !== undefined) return cached;
  try {
    cached = JSON.parse(readFileSync(MAP_PATH, 'utf8')) as AccountMap;
  } catch {
    cached = null; // map missing/unreadable → callers fall back to inherited env
  }
  return cached;
}

/** Which account ('kim' | 'personal' | ...) owns this path; null if no map. */
export function resolveAccount(cwd: string): string | null {
  const map = loadMap();
  if (!map) return null;
  const abs = resolvePath(cwd);
  const rel =
    abs === HOME ? '' : abs.startsWith(HOME + '/') ? abs.slice(HOME.length + 1) : abs;
  const rule = map.rules.find((r) => rel === r.prefix || rel.startsWith(r.prefix + '/'));
  return rule?.account ?? map.default_account;
}

/**
 * Env for spawning a CLI in `cwd`: layers the right CLAUDE_CONFIG_DIR / CODEX_HOME
 * for that workspace over process.env. If the map is missing or the account is
 * unknown, returns process.env unchanged (safe no-op fallback).
 */
export function accountEnv(cwd: string): NodeJS.ProcessEnv {
  const map = loadMap();
  const account = resolveAccount(cwd);
  if (!map || !account) return process.env;
  const a = map.accounts[account];
  if (!a) return process.env;
  return {
    ...process.env,
    SAMWISE_ACCOUNT: account,
    CLAUDE_CONFIG_DIR: join(HOME, a.claude_config_dir),
    CODEX_HOME: join(HOME, a.codex_home),
  };
}
