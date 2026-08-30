import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
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
// Format: one JSON object per line, `{"seq":N,"ev":{...}}`. Files live in
// ~/.rivendell/event-logs/<sanitized-key>.jsonl. Cap is enforced lazily on
// load (truncate to last MAX_EVENTS_PER_LOG); appends are unbuffered.

export type PersistedEvent = { seq: number; ev: SessionEvent };

export const EVENT_LOG_DIR = join(STATE_DIR, 'event-logs');
export const MAX_EVENTS_PER_LOG = 2000;

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

function logPath(key: string): string {
  return join(EVENT_LOG_DIR, `${sanitizeKey(key)}.jsonl`);
}

// Synchronous load — called once during ClaudeSession / CodexSession
// construction so the new instance can prime its in-memory buffer and
// `nextSeq` counter before any new emit. Files top out at MAX_EVENTS_PER_LOG
// lines (~a few MB), so blocking the construct here is fine.
export function loadEventLogSync(key: string): { events: PersistedEvent[]; nextSeq: number } {
  const path = logPath(key);
  if (!existsSync(path)) return { events: [], nextSeq: 1 };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { events: [], nextSeq: 1 };
  }
  const events: PersistedEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed?.seq === 'number' && parsed?.ev) {
        events.push({ seq: parsed.seq, ev: parsed.ev as SessionEvent });
      }
    } catch {
      // skip malformed lines (interrupted append, etc.)
    }
  }
  // Trim to the most recent window so a long-lived session that crashed
  // mid-turn doesn't keep replaying ancient events forever.
  const trimmed = events.length > MAX_EVENTS_PER_LOG
    ? events.slice(events.length - MAX_EVENTS_PER_LOG)
    : events;
  const nextSeq = trimmed.length > 0 ? trimmed[trimmed.length - 1].seq + 1 : 1;
  return { events: trimmed, nextSeq };
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

// Optional: rewrite the file to drop everything but the most recent
// MAX_EVENTS_PER_LOG entries. Called from session spawn after load so a
// long-running session doesn't grow its file unboundedly. Atomic via
// write-temp + rename so a crash mid-rewrite never leaves a half-written log.
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
  const kept = lines.slice(lines.length - MAX_EVENTS_PER_LOG).join('\n') + '\n';
  const tmp = `${path}.compact-${process.pid}`;
  try {
    await writeFile(tmp, kept, 'utf8');
    await rename(tmp, path);
  } catch (err) {
    console.warn('[event-log-store] compact failed', key, (err as Error).message);
  }
}
