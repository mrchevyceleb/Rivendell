// Auto-compaction for long-running teammate threads.
//
// Grok Bot's model: an agent has ONE persistent conversation, forever. The
// context behind it compacts on a cadence so the thread never dies:
//
//   every 100 user turns →
//     1. generate a JUICY durable compact (3000–5000 words, Grok 4.6 via the
//        local xAI proxy) of the full transcript,
//     2. fire it into the savemem RAG vault (assistant-mcp `memory`
//        save_memory) so every tool in the house can recall it semantically,
//     3. rotate the session's MODEL context: respawn the engine with the
//        compact as the primer (claude family: --append-system-prompt on the
//        fresh process; codex/banana: primed next turn on a fresh thread),
//     4. stamp a `compacted` marker into the durable event log.
//
// The durable event log — what the user actually sees — is NEVER wiped by
// this. Display history is lossless; compaction replaces only what the model
// carries in its head.
//
// Counting: every runner echoes accepted prompts as `_user_echo` events (the
// universal replay shape), but the event log is a capped rolling window
// (MAX_EVENTS_PER_LOG), so the cadence also keeps a MONOTONIC per-thread
// user-turn counter in ~/.rivendell/compaction-state.json — the window can
// never make a busy thread miss its compaction.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from './config.ts';
import { callMcp } from '../lib/mcp.ts';
import { ensureXaiProxy, xaiProxyBaseUrl, xaiProxySecret } from './xai-proxy.ts';
import { flushEventLog } from './event-log-store.ts';

/** User turns between compactions (Matt's number). */
export const COMPACT_EVERY_USER_TURNS = 100;
/** We ask for 3000–5000 words and refuse to bank anything thin. */
const MIN_ACCEPT_WORDS = 1500;
const COMPACT_MAX_TOKENS = 8000;
/** Transcript feed cap: head + tail around an elision marker. */
const TRANSCRIPT_HEAD = 24 * 1024;
const TRANSCRIPT_TAIL = 220 * 1024;

const STATE_FILE = join(STATE_DIR, 'compaction-state.json');

type CompactionRecord = {
  /** Monotonic user-turn counter (survives the rolling log window). */
  userTurnsTotal: number;
  /** user-turn count at the last successful compact. */
  lastCompactUserTurns: number;
  /** how many compactions this thread has had. */
  count: number;
  lastAt: number;
  lastWords: number;
  /** A compact banked while a turn was streaming (or while the server died
   *  before the primer fired); its rotation is owed and pays on the next
   *  idle turn end. Also restores codex/banana primers across restarts. */
  pendingRotation?: string | null;
};
type CompactionState = Record<string, CompactionRecord>;

// All state mutations funnel through one queue; each mutation reloads and
// merges so concurrent keys can never clobber each other's records.
let stateQueue: Promise<void> = Promise.resolve();

function loadState(): CompactionState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as CompactionState;
  } catch {
    return {};
  }
}

function mutateState(fn: (state: CompactionState) => void): Promise<void> {
  stateQueue = stateQueue.then(() => {
    try {
      const state = loadState(); // fresh snapshot — merge, never blind overwrite
      fn(state);
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.warn('[compaction] state mutation failed:', (err as Error).message);
    }
  });
  return stateQueue;
}

/** User turns currently visible in the log window (echo shape: universal
 *  across claude/codex/banana runners). Used to seed the monotonic counter. */
export function countUserEchoes(events: Array<{ ev: any }>): number {
  let n = 0;
  for (const { ev } of events) {
    if (ev?.type !== 'event') continue;
    const e = ev.event;
    if (e?.type === '_user_echo' && typeof e.text === 'string' && e.text.trim()) n++;
  }
  return n;
}

/** Called by every runner's send() after the user echo: keeps the monotonic
 *  turn counter honest regardless of the rolling log window. */
export function noteUserTurn(key: string): void {
  void mutateState((state) => {
    const rec = state[key];
    if (!rec) {
      // First sight of this thread: seed from the visible window (floor).
      state[key] = { userTurnsTotal: 1, lastCompactUserTurns: 0, count: 0, lastAt: 0, lastWords: 0 };
    } else {
      rec.userTurnsTotal += 1;
    }
  });
}

/** Bank an owed rotation (deferred or restart-surviving primer debt). */
export function bankRotation(key: string, primer: string): void {
  void mutateState((state) => {
    const rec = state[key] ?? { userTurnsTotal: 0, lastCompactUserTurns: 0, count: 0, lastAt: 0, lastWords: 0 };
    rec.pendingRotation = primer;
    state[key] = rec;
  });
}

/** Take (and clear) an owed rotation, if any. */
export async function takeRotation(key: string): Promise<string | null> {
  const primer = loadState()[key]?.pendingRotation ?? null;
  if (primer) await mutateState((state) => { if (state[key]) state[key].pendingRotation = null; });
  return primer;
}

/** Flatten the log into a readable transcript for the compactor. User side
 *  comes from the `_user_echo` replay events; assistant side from the
 *  claude-shaped `assistant` message events all runners synthesize. */
function buildTranscript(events: Array<{ ev: any }>): string {
  const parts: string[] = [];
  for (const { ev } of events) {
    if (ev?.type !== 'event') continue;
    const e = ev.event;
    if (e?.type === '_user_echo' && typeof e.text === 'string' && e.text.trim()) {
      parts.push(`MATT: ${e.text}`);
      continue;
    }
    if (e?.type === 'assistant') {
      const content = e.message?.content;
      const texts: string[] = [];
      if (typeof content === 'string') texts.push(content);
      else if (Array.isArray(content)) {
        for (const c of content) if (c?.type === 'text' && typeof c.text === 'string' && c.text.trim()) texts.push(c.text);
      }
      if (texts.length) parts.push(`AGENT: ${texts.join('\n')}`);
    }
  }
  let transcript = parts.join('\n\n');
  if (transcript.length > TRANSCRIPT_HEAD + TRANSCRIPT_TAIL) {
    transcript = `${transcript.slice(0, TRANSCRIPT_HEAD)}\n\n[…middle elided for size — the full log persists…]\n\n${transcript.slice(-TRANSCRIPT_TAIL)}`;
  }
  return transcript;
}

const COMPACT_SYSTEM = `You are the memory keeper for a long-running AI-teammate conversation. You write the durable memory document that lets the thread continue FOREVER without losing anything that matters.

Rules for the document you produce:
- LENGTH: 3000–5000 words. Dense, concrete, specific. This is the whole point — a thin summary loses history.
- Capture: every decision made (and why), every open task and its state, every fact about people/projects/systems mentioned, every commitment or promise, every preference expressed, every technical detail that mattered (paths, models, endpoints, prices, IDs), and the current state of play.
- Organize with clear headings (## ...) so it can be indexed: Overview / People & Projects / Decisions / Open Work / Facts & References / Preferences & Style / Current State.
- Write in third person, past tense, no fluff, no meta commentary. Never invent content that is not in the transcript.`;

const PRIMER_HEADER = `You are continuing a single long-running conversation that has been compacted to preserve its context window. The durable memory document below was generated from the full transcript (which is preserved verbatim elsewhere — nothing was lost). Treat it as ground truth for everything before this point: decisions, open work, people, facts, preferences, and the current state of play. Continue seamlessly from it. When something from before this point matters and is not in the document, say so rather than guessing.

`;

/** One compaction per key at a time. */
const inFlight = new Set<string>();

export type AutoCompactArgs = {
  key: string;
  cli: string;
  chatId: string;
  /** The session's in-memory event log (PersistedEvent-shaped). */
  events: Array<{ ev: any }>;
  /** True if a turn is currently streaming — rotation waits for idle. */
  isBusy: () => boolean;
  /** Persist+broadcast marker events through the session's emit. */
  emit: (ev: any) => void;
  /** Runner-specific context rotation: restart the model with the primer. */
  rotate: (primer: string) => Promise<void> | void;
};

export async function maybeAutoCompact(args: AutoCompactArgs): Promise<boolean> {
  const { key, cli, chatId } = args;
  if (inFlight.has(key)) return false;

  const state = loadState();
  const rec = state[key];

  // First, pay any owed rotation from a previous compact (turn was in flight
  // when it banked, or the server restarted with the primer in debt).
  const owed = rec?.pendingRotation;
  if (owed && !args.isBusy()) {
    try {
      await flushEventLog(key);
      await args.rotate(owed);
      await mutateState((s) => { if (s[key]) s[key].pendingRotation = null; });
      console.warn(`[compaction] ${key}: owed rotation applied`);
    } catch (err) {
      console.warn(`[compaction] ${key}: owed rotation failed, will retry:`, (err as Error).message);
      return false; // keep the debt; retry next turn end
    }
  }

  // Cadence: monotonic counter (seeded from the visible window on first sight).
  const total = rec?.userTurnsTotal ?? countUserEchoes(args.events);
  const sinceLast = total - (rec?.lastCompactUserTurns ?? 0);
  if (sinceLast < COMPACT_EVERY_USER_TURNS) return false;

  inFlight.add(key);
  console.warn(`[compaction] ${key}: ${sinceLast} user turns since last compact — compacting (${total} total)`);
  try {
    const transcript = buildTranscript(args.events);
    if (transcript.length < 4000) {
      // Not enough real content in the visible window — the monotonic counter
      // still advances so we don't spin on every turn end.
      await mutateState((s) => {
        const r = s[key] ?? { userTurnsTotal: total, lastCompactUserTurns: 0, count: 0, lastAt: 0, lastWords: 0 };
        r.lastCompactUserTurns = total; // skip this window; retry at the next threshold
        s[key] = r;
      });
      return false;
    }

    // 1 — generate the juicy compact via Grok through the local xAI proxy
    //     (bearer = the proxy secret, exactly like the CLI's env).
    await ensureXaiProxy();
    const res = await fetch(`${xaiProxyBaseUrl().replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${xaiProxySecret()}`,
      },
      body: JSON.stringify({
        model: 'grok-4.6',
        max_tokens: COMPACT_MAX_TOKENS,
        system: COMPACT_SYSTEM,
        messages: [{ role: 'user', content: `Transcript of the conversation so far:\n\n${transcript}` }],
      }),
    });
    if (!res.ok) throw new Error(`compact generation failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const compact = (body.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n').trim();
    const words = compact ? compact.split(/\s+/).length : 0;
    if (words < MIN_ACCEPT_WORDS) throw new Error(`compact came back thin (${words} words < ${MIN_ACCEPT_WORDS}) — will retry next threshold`);

    // 2 — savemem RAG hook (never blocks the compaction; failure is logged)
    const count = (rec?.count ?? 0) + 1;
    let savedToRag = false;
    try {
      await callMcp('memory', {
        action: 'save_memory',
        params: {
          title: `Chat compact — ${chatId} (#${count}, ${total} turns)`,
          content: compact,
          project: 'rivendell',
          category: 'conversation-compact',
          tags: [cli, chatId, 'auto-compaction'],
        },
      });
      savedToRag = true;
    } catch (err) {
      console.warn(`[compaction] ${key}: savemem hook failed (compact still applies locally):`, (err as Error).message);
    }

    // 3 — stamp the marker FIRST (persisted in the durable log + broadcast),
    //     flush its append, THEN rotate: rotation shuts this session down and
    //     a shut-down session no longer persists or forwards emits.
    args.emit({
      type: 'compacted',
      chatId,
      words,
      turns: total,
      count,
      savedToRag,
      at: Date.now(),
    });
    await flushEventLog(key);

    // 4 — rotate the model context with the compact as primer
    if (args.isBusy()) {
      // A new turn started while we were generating. The compact is banked to
      // RAG + stamped already; rotate on the next idle boundary instead of
      // killing the in-flight stream. The owed rotation is stored in state.
      await mutateState((s) => {
        s[key] = { userTurnsTotal: total, lastCompactUserTurns: total, count, lastAt: Date.now(), lastWords: words, pendingRotation: PRIMER_HEADER + compact };
      });
      console.warn(`[compaction] ${key}: turn in flight — rotation deferred to next turn end`);
      return true;
    }
    await args.rotate(PRIMER_HEADER + compact);

    await mutateState((s) => {
      s[key] = { userTurnsTotal: total, lastCompactUserTurns: total, count, lastAt: Date.now(), lastWords: words };
    });
    console.warn(`[compaction] ${key}: compacted at ${total} user turns, ${words} words, rag=${savedToRag} (compact #${count})`);
    return true;
  } catch (err) {
    // Retry on a later turn end — the threshold stays tripped because
    // lastCompactUserTurns is only advanced on success.
    console.warn(`[compaction] ${key}: compact failed, will retry:`, (err as Error).message);
    return false;
  } finally {
    inFlight.delete(key);
  }
}
