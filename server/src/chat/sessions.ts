import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SESSIONS_FILE, STATE_DIR } from './config.ts';

// One mapping per (repo, cli) → claude session_id.
// Persists across server restarts so re-opening a chat resumes the right thread.

type Cli = 'claude' | 'codex' | 'assistant';
type Key = string; // `${cli}|${repoPath}`

type Stored = Record<Key, { sessionId: string; updatedAt: number }>;

let cache: Stored | null = null;
let writeQueue: Promise<void> = Promise.resolve();

const key = (cli: Cli, repoPath: string): Key => `${cli}|${repoPath}`;

async function load(): Promise<Stored> {
  if (cache) return cache;
  try {
    const raw = await readFile(SESSIONS_FILE, 'utf8');
    cache = JSON.parse(raw) as Stored;
  } catch {
    cache = {};
  }
  return cache;
}

async function flush() {
  if (!cache) return;
  await mkdir(dirname(SESSIONS_FILE), { recursive: true });
  await writeFile(SESSIONS_FILE, JSON.stringify(cache, null, 2));
}

export async function getSessionId(cli: Cli, repoPath: string): Promise<string | undefined> {
  const all = await load();
  return all[key(cli, repoPath)]?.sessionId;
}

export async function setSessionId(cli: Cli, repoPath: string, sessionId: string): Promise<void> {
  const all = await load();
  if (sessionId) all[key(cli, repoPath)] = { sessionId, updatedAt: Date.now() };
  else delete all[key(cli, repoPath)];
  // Coalesce concurrent writes.
  writeQueue = writeQueue.then(flush, flush);
  await writeQueue;
}

export async function ensureStateDir(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
}
