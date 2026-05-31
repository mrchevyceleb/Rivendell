import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SESSIONS_FILE, STATE_DIR } from './config.ts';

// One mapping per (repo, cli) → claude session_id.
// Persists across server restarts so re-opening a chat resumes the right thread.

type Cli = 'claude' | 'codex' | 'assistant' | 'banana' | 'codex-personal' | 'banana-local';
type Key = string; // `${cli}|${repoPath}` or `${cli}|${repoPath}|${chatId}`

type Stored = Record<Key, { sessionId: string; updatedAt: number }>;

let cache: Stored | null = null;
let writeQueue: Promise<void> = Promise.resolve();

const key = (cli: Cli, repoPath: string, chatId = 'main'): Key => {
  const normalized = chatId || 'main';
  return normalized === 'main' ? `${cli}|${repoPath}` : `${cli}|${repoPath}|${normalized}`;
};

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

export async function getSessionId(cli: Cli, repoPath: string, chatId = 'main'): Promise<string | undefined> {
  const all = await load();
  return all[key(cli, repoPath, chatId)]?.sessionId;
}

export async function setSessionId(cli: Cli, repoPath: string, sessionId: string, chatId = 'main'): Promise<void> {
  const all = await load();
  const storageKey = key(cli, repoPath, chatId);
  if (sessionId) all[storageKey] = { sessionId, updatedAt: Date.now() };
  else delete all[storageKey];
  // Coalesce concurrent writes.
  writeQueue = writeQueue.then(flush, flush);
  await writeQueue;
}

export async function ensureStateDir(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
}
