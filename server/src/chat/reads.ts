// Unread tracking — "this agent replied and is waiting for you". The server
// knows each agent home thread's latest event seq; the focused client reports
// reads; the agents API carries the delta as `unread`.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR, ELROND_WORKSPACE_PATH } from '../config.ts';
import { loadEventLogSync } from './event-log-store.ts';
import { agentLogKey } from './teamBus.ts';
import type { Agent } from './agents.ts';

const READS_FILE = join(STATE_DIR, 'agent-reads.json');

type Reads = Record<string, number>;

function readReads(): Reads {
  try {
    return JSON.parse(readFileSync(READS_FILE, 'utf8')) as Reads;
  } catch {
    return {};
  }
}

function writeReads(reads: Reads): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(READS_FILE, JSON.stringify(reads, null, 2));
}

/** Latest persisted seq in an agent's home log (0 when no log yet). */
export function agentLatestSeq(agent: Agent): number {
  const { cli, chatKey } = agentLogKey(agent);
  try {
    const { events } = loadEventLogSync(`${cli}|${ELROND_WORKSPACE_PATH}|${chatKey}`);
    return events.length ? events[events.length - 1].seq : 0;
  } catch {
    return 0;
  }
}

/** Count of assistant-authored events since the last read (0 = read). */
export function agentUnread(agent: Agent): number {
  const { cli, chatKey } = agentLogKey(agent);
  try {
    const { events } = loadEventLogSync(`${cli}|${ELROND_WORKSPACE_PATH}|${chatKey}`);
    if (!events.length) return 0;
    const latest = events[events.length - 1].seq;
    const reads = readReads();
    let lastRead = reads[agent.id] ?? 0;
    if (lastRead > latest) {
      // Log head moved BACKWARDS (fresh-start wipe / lane change): the old
      // cursor is meaningless — reset it so new replies badge again.
      lastRead = 0;
      reads[agent.id] = 0;
      writeReads(reads);
    }
    if (lastRead >= latest) return 0;
    // Count events after lastRead that carry assistant text (replies waiting).
    let unread = 0;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].seq <= lastRead) break;
      const inner = (events[i].ev as { type?: string; event?: { type?: string } });
      const t = inner?.event?.type ?? inner?.type;
      if (t === 'assistant' || t === 'peer_message' || t === 'result') unread++;
    }
    return unread;
  } catch {
    return 0;
  }
}

/** The focused client calls this while it has the agent's thread open. */
export function markAgentRead(agentId: string, seq: number): void {
  const reads = readReads();
  if ((reads[agentId] ?? 0) >= seq) return;
  reads[agentId] = seq;
  writeReads(reads);
}
