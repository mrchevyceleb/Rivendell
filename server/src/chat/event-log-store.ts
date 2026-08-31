import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from './config.ts';
import type { SessionEvent } from './runner.ts';

// Per-session event log persistence. The in-memory rolling buffer
// (ClaudeSession.eventLog / CodexSession.eventLog) is the primary source
// of truth during a process lifetime, but if the server restarts mid-turn
// or between turns those events are lost — so a reconnecting client whose
// `sinceSeq` is past the new session's `latestSeq` ends up with a half-
// rendered conversation that never recovers. Backing the in-memory log to
// disk lets a fresh session restore prior history and keep replay semantics
// intact across restarts.
//
// Format: one JSON object per line, `{"seq":N,"ev":{...},"eng":"xai"}`. Files
// live in ~/.rivendell/event-logs/<sanitized-key>.jsonl. Cap is enforced
// lazily on load (truncate to last MAX_EVENTS_PER_LOG); appends are unbuffered.
//
// `eng`/`mdl` are provenance: which engine and model produced this event. An
// agent thread's log is keyed on the thread, not the engine (see threadKey.ts),
// so a single file holds turns from several brains and the transcript has to be
// able to say which one said what.

export type PersistedEvent = {
  seq: number;
  ev: SessionEvent;
  /** Engine (cli) that produced this event. Absent on pre-provenance lines. */
  eng?: string;
  /** Model id that produced this event, when the engine reports one. */
  mdl?: string;
};

export const EVENT_LOG_DIR = join(STATE_DIR, 'event-logs');
export const MAX_EVENTS_PER_LOG = 2000;

export function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

function logPath(key: string): string {
  return join(EVENT_LOG_DIR, `${sanitizeKey(key)}.jsonl`);
}

/** Overflow sink for trimmed lines. The hot log stays bounded; the bytes are
 *  never destroyed. */
function archivePath(key: string): string {
  return join(EVENT_LOG_DIR, `${sanitizeKey(key)}.archive.jsonl`);
}

// Synchronous load — called once during ClaudeSession / CodexSession
// construction so the new instance can prime its in-memory buffer and
// `nextSeq` counter before any new emit. Files top out at MAX_EVENTS_PER_LOG
// lines (~a few MB), so blocking the construct here is fine.
// Parsed-log cache, validated against (mtimeMs, size). The same multi-MB logs
// are re-read by every session spawn, every ws `hello`, and the /api/agents
// unread pass; parsing them per call is pure event-loop burn. Callers mutate the
// array they receive (a live session appends to its own event log), so the
// cached array stays private and every caller gets a shallow copy.
const parsedCache = new Map<
  string,
  { mtimeMs: number; size: number; events: PersistedEvent[]; nextSeq: number; bytes: number }
>();
const PARSED_CACHE_MAX = 128;
// An entry count is not a memory bound. The retained MAX_EVENTS_PER_LOG window
// of this box's biggest lanes is 8-11 MB of JSON *each*, so 128 of them is
// ~340 MB of raw text and several times that once parsed - an OOM on an
// always-on process for anyone paging through the sidebar. Cap retained bytes.
// Budget is RETAINED JSON TEXT, which is a floor on the real heap cost: parsed
// objects typically run 2-4x their source text. 32 MB of text is therefore
// roughly 65-130 MB of heap - deliberately conservative for a process that is
// never restarted.
const PARSED_CACHE_MAX_BYTES = 32 * 1024 * 1024;
let parsedCacheBytes = 0;

// Map iteration is insertion-ordered and a cache hit re-inserts, so the front
// of the map is the least recently used entry.
function evictParsedCache(): void {
  while (
    parsedCache.size > 0
    && (parsedCache.size > PARSED_CACHE_MAX || parsedCacheBytes > PARSED_CACHE_MAX_BYTES)
  ) {
    const oldest = parsedCache.keys().next().value;
    if (oldest === undefined) break;
    const dropped = parsedCache.get(oldest);
    parsedCache.delete(oldest);
    if (dropped) parsedCacheBytes -= dropped.bytes;
  }
  if (parsedCacheBytes < 0) parsedCacheBytes = 0;
}

export function loadEventLogSync(key: string): { events: PersistedEvent[]; nextSeq: number } {
  const path = logPath(key);
  let mtimeMs: number;
  let size: number;
  try {
    const st = statSync(path);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    return { events: [], nextSeq: 1 };
  }
  const cached = parsedCache.get(path);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    // Re-insert so eviction order is least-recently-USED, not first-inserted.
    parsedCache.delete(path);
    parsedCache.set(path, cached);
    return { events: cached.events.slice(), nextSeq: cached.nextSeq };
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { events: [], nextSeq: 1 };
  }
  const events: PersistedEvent[] = [];
  // Source-text length of each kept event, so the cache can charge itself the
  // EXACT retained tail. Pro-rating the whole file by event count under-counts
  // badly on a long lane, where the biggest events cluster at the end.
  const eventChars: number[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed?.seq === 'number' && parsed?.ev) {
        const event: PersistedEvent = { seq: parsed.seq, ev: parsed.ev as SessionEvent };
        if (typeof parsed.eng === 'string' && parsed.eng) event.eng = parsed.eng;
        if (typeof parsed.mdl === 'string' && parsed.mdl) event.mdl = parsed.mdl;
        events.push(event);
        eventChars.push(line.length);
      }
    } catch {
      // skip malformed lines (interrupted append, etc.)
    }
  }
  const highWater = events.length > 0
    ? events.reduce((m, e) => (e.seq > m ? e.seq : m), 0)
    : 0;
  // Trim to the most recent window so a long-lived session that crashed
  // mid-turn doesn't keep replaying ancient events forever.
  const trimmed = events.length > MAX_EVENTS_PER_LOG
    ? events.slice(events.length - MAX_EVENTS_PER_LOG)
    : events;
  // High-water + 1 from the FULL file, not last-line + 1 and not only the
  // trimmed window: concurrent writers can append a duplicate lower seq,
  // and trimming oldest lines must not rewind the allocator.
  const nextSeq = highWater + 1;
  // Charge the cache for exactly what we retained, so a handful of multi-MB
  // lanes cannot quietly hold hundreds of MB. `trimmed` is always a suffix of
  // `events`, so this window is in range.
  let retainedBytes = 0;
  for (let i = eventChars.length - trimmed.length; i < eventChars.length; i += 1) {
    retainedBytes += eventChars[i];
  }
  const prior = parsedCache.get(path);
  if (prior) parsedCacheBytes -= prior.bytes;
  parsedCache.delete(path);
  parsedCache.set(path, { mtimeMs, size, events: trimmed, nextSeq, bytes: retainedBytes });
  parsedCacheBytes += retainedBytes;
  // A single log bigger than the whole budget evicts itself here: callers still
  // get their data, it just is not retained.
  evictParsedCache();
  return { events: trimmed.slice(), nextSeq };
}

// Append-only writer keyed by sanitized session key. A per-key promise chain
// preserves ordering when many emits land back-to-back during streaming. We
// fire-and-forget at the call site (emit is sync); failures get logged but
// don't propagate, since losing a disk-mirror line is better than crashing a
// live turn.
const writeChains = new Map<string, Promise<void>>();

/** Resolves once every queued append for `key` has hit disk — compaction
 *  flushes its marker before rotating so the fresh session's log restore
 *  can't race the append chain and miss it. */
export function flushEventLog(key: string): Promise<void> {
  return writeChains.get(key) ?? Promise.resolve();
}

export function appendEventLog(key: string, persisted: PersistedEvent): void {
  const path = logPath(key);
  const line = JSON.stringify(persisted) + '\n';
  const prior = writeChains.get(key) ?? Promise.resolve();
  const next = prior
    .then(async () => {
      try {
        await mkdir(EVENT_LOG_DIR, { recursive: true });
        await appendFile(path, line, 'utf8');
      } catch (err) {
        console.warn('[event-log-store] append failed', key, (err as Error).message);
      }
    })
    .catch(() => {});
  writeChains.set(key, next);
}

// Wipe the durable log for a key. Called on freshStart so a reset thread can't
// be resurrected when a client with an empty cache requests a full replay
// (sinceSeq=0). Chained through the per-key write queue so any in-flight append
// from the prior session lands first and can't re-create the file afterward,
// then the chain is cleared so the next session starts from an empty log.
export async function clearEventLog(key: string): Promise<void> {
  const path = logPath(key);
  const prior = writeChains.get(key) ?? Promise.resolve();
  const next = prior
    .then(async () => {
      try {
        await rm(path, { force: true });
        // A fresh start resets the whole thread, so the overflow archive goes
        // too — otherwise the next trim would splice pre-reset turns back in.
        await rm(archivePath(key), { force: true });
      } catch (err) {
        console.warn('[event-log-store] clear failed', key, (err as Error).message);
      }
    })
    .catch(() => {});
  writeChains.set(key, next);
  await next;
  // Drop the chain entry if no newer write superseded ours, so the file we
  // just removed isn't pinned by a stale resolved promise.
  if (writeChains.get(key) === next) writeChains.delete(key);
}

// Rewrite the file to drop everything but the most recent MAX_EVENTS_PER_LOG
// entries. Called from session spawn after load so a long-running session
// doesn't grow its file unboundedly. Atomic via write-temp + rename so a crash
// mid-rewrite never leaves a half-written log.
//
// The trimmed prefix is APPENDED to `<key>.archive.jsonl` before the rewrite,
// not discarded. The cap is a bound on the hot window a session replays and
// holds in memory, and it has to stay one — but merging an agent's per-engine
// logs into a single thread log pushes long threads past 2000 events, and
// deleting the oldest turns off disk to enforce a memory bound is not a trade
// anyone agreed to. Archive first, then trim; nothing leaves the box.
export async function compactEventLog(key: string): Promise<void> {
  const path = logPath(key);
  if (!existsSync(path)) return;
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return;
  }
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length <= MAX_EVENTS_PER_LOG) return;
  const dropped = lines.slice(0, lines.length - MAX_EVENTS_PER_LOG);
  const kept = lines.slice(lines.length - MAX_EVENTS_PER_LOG).join('\n') + '\n';
  const tmp = `${path}.compact-${process.pid}`;
  try {
    // Archive must land BEFORE the rewrite. If the append fails we keep the
    // fat log rather than trim it, so a full disk cannot turn into data loss.
    await appendFile(archivePath(key), dropped.join('\n') + '\n', 'utf8');
  } catch (err) {
    console.warn(
      `[event-log-store] archive failed for ${key}, leaving log untrimmed:`,
      (err as Error).message,
    );
    return;
  }
  try {
    await writeFile(tmp, kept, 'utf8');
    await rename(tmp, path);
    console.log(`[event-log-store] trimmed ${key}: archived ${dropped.length} event(s)`);
  } catch (err) {
    console.warn('[event-log-store] compact failed', key, (err as Error).message);
  }
}
