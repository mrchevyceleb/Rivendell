import { readdir, stat, open } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { CLAUDE_PROJECTS_DIR } from './config.ts';
import { activeClaudeSessions } from './runner.ts';
import { discoverRepos } from './repos.ts';

// One chronicle entry per Claude session JSONL file.
export type ChronicleEntry = {
  id: string;            // session_id (filename minus .jsonl)
  title: string;         // derived from first user message
  cwd: string;           // decoded path from the directory name
  repoName: string;      // basename of cwd
  ts: number;            // file mtime in ms
  running: boolean;      // is this session currently spawned in our runner?
  busy: boolean;         // is that spawned session currently mid-turn?
};

const MAX_ENTRIES = 25;
const RECENT_DAYS = 7;
// A session log with no interesting user message used to be streamed in full ???
// some are tens of MB. The first real user turn is always near the top.
const MAX_TITLE_SCAN_BYTES = 256 * 1024;
// Derived titles keyed by (mtime, size) so a poll only re-reads changed logs.
const titleCache = new Map<string, { mtimeMs: number; size: number; title: string }>();
const TITLE_CACHE_MAX = 600;
const RESULT_TTL_MS = 5_000;
let resultCache: { at: number; entries: ChronicleEntry[] } | null = null;
let inFlight: Promise<ChronicleEntry[]> | null = null;

function naiveDecode(encoded: string): string {
  if (!encoded.startsWith('-')) return encoded;
  return '/' + encoded.slice(1).replaceAll('-', '/');
}

function encodeForClaude(absPath: string): string {
  // Claude's encoding replaces every "/" (and "-" stays as "-"), so this
  // round-trips for paths without dashes but is ambiguous when paths contain
  // dashes (like "OneDrive-Personal" or "ASSISTANT-HUB"). We use known repo
  // paths as a reverse lookup to recover the real path.
  return absPath.replaceAll('/', '-');
}

async function buildPathDecoder(): Promise<(encoded: string) => string> {
  let repos: { path: string }[] = [];
  try {
    repos = await discoverRepos();
  } catch {
    repos = [];
  }
  const known: Map<string, string> = new Map(
    repos.map((r) => [encodeForClaude(r.path), r.path]),
  );
  return (encoded: string) => known.get(encoded) ?? naiveDecode(encoded);
}

function isInteresting(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('<')) return false;            // <ide_opened_file>, <command-message> etc
  if (t.startsWith('You are')) return false;      // claude-internal system prompts
  if (t.startsWith('Caveat:')) return false;      // claude's "ide opened" caveats
  return true;
}

async function firstUserMessage(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, 'r');
    const reader = handle.createReadStream({ encoding: 'utf8', highWaterMark: 16 * 1024 });
    let buf = '';
    let scanned = 0;
    for await (const chunk of reader as AsyncIterable<string>) {
      buf += chunk;
      scanned += chunk.length;
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev?.type === 'user' && ev.message?.content) {
            const c = ev.message.content;
            let text: string | null = null;
            if (typeof c === 'string') text = c;
            else if (Array.isArray(c)) {
              text = c.find((p: any) => p?.type === 'text')?.text ?? null;
            }
            if (text && isInteresting(text)) return text.trim();
          }
        } catch { /* not JSON */ }
      }
      if (scanned >= MAX_TITLE_SCAN_BYTES) break;
    }
    return null;
  } finally {
    await handle?.close();
  }
}

function summarizeTitle(text: string | null): string {
  if (!text) return 'a fresh errand';
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? text;
  return firstLine.length <= 60 ? firstLine.trim() : `${firstLine.slice(0, 60).trim()}…`;
}

// running/busy are live runner state, so they are recomputed on every read —
// the cache only spares the directory walk and the title reads.
function withLiveState(entries: ChronicleEntry[]): ChronicleEntry[] {
  const activeById = new Map(
    activeClaudeSessions()
      .filter((s) => s.sessionId)
      .map((s) => [s.sessionId as string, s]),
  );
  return entries.map((e) => {
    const active = activeById.get(e.id);
    return { ...e, running: Boolean(active), busy: active?.busy ?? false };
  });
}

export async function readChronicle(): Promise<ChronicleEntry[]> {
  const now = Date.now();
  if (resultCache && now - resultCache.at < RESULT_TTL_MS) return withLiveState(resultCache.entries);
  if (inFlight) return inFlight;
  inFlight = scanChronicle()
    .then((entries) => {
      resultCache = { at: Date.now(), entries };
      // Every caller gets running/busy as of NOW rather than as of scan start,
      // and a fresh array, so no caller can mutate the cached copy.
      return withLiveState(entries);
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function scanChronicle(): Promise<ChronicleEntry[]> {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return [];
  const projectDirs = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const activeById = new Map(
    activeClaudeSessions()
      .filter((s) => s.sessionId)
      .map((s) => [s.sessionId as string, s]),
  );
  const decode = await buildPathDecoder();

  const candidates: Array<{ entry: ChronicleEntry; path: string; size: number }> = [];

  for (const d of projectDirs) {
    if (!d.isDirectory()) continue;
    const cwd = decode(d.name);
    const dir = join(CLAUDE_PROJECTS_DIR, d.name);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch { continue; }
    for (const fname of files) {
      if (!fname.endsWith('.jsonl')) continue;
      const filePath = join(dir, fname);
      let s;
      try { s = await stat(filePath); } catch { continue; }
      if (s.mtimeMs < cutoff) continue;
      const sessionId = fname.slice(0, -'.jsonl'.length);
      const active = activeById.get(sessionId);
      candidates.push({
        entry: {
          id: sessionId,
          title: 'a fresh errand',
          cwd,
          repoName: basename(cwd),
          ts: s.mtimeMs,
          running: Boolean(active),
          busy: active?.busy ?? false,
        },
        path: filePath,
        size: s.size,
      });
    }
  }

  candidates.sort((a, b) => b.entry.ts - a.entry.ts);
  const top = candidates.slice(0, MAX_ENTRIES);

  // Hydrate titles in parallel.
  await Promise.all(
    top.map(async ({ entry, path, size }) => {
      const cached = titleCache.get(path);
      if (cached && cached.mtimeMs === entry.ts && cached.size === size) {
        entry.title = cached.title;
        return;
      }
      try {
        entry.title = summarizeTitle(await firstUserMessage(path));
        if (titleCache.size >= TITLE_CACHE_MAX) {
          const evict = titleCache.keys().next().value;
          if (evict !== undefined) titleCache.delete(evict);
        }
        titleCache.set(path, { mtimeMs: entry.ts, size, title: entry.title });
      } catch {
        // leave default
      }
    }),
  );

  return top.map((c) => c.entry);
}
