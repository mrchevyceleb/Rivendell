// Team bus — agent-to-agent messaging. Any teammate can message any other
// teammate through the `rivendell-team` MCP tool (see server/scripts/team-mcp.mjs);
// delivery lands in the recipient's home thread as a `peer_message` event
// (rendered with the sender's identity, not as a user turn) and wakes the
// recipient's engine for a real turn. Guards: hop limit, rate limits, text cap,
// busy-recipient reporting — free conversation, no runaway loops.

import { ELROND_WORKSPACE_PATH } from '../config.ts';
import { listAgents, type Agent } from './agents.ts';
import { logKeyFor } from './threadKey.ts';
import { extractVisibleTurns } from './threadWindow.ts';
import { isThreadWatched } from './threadWatch.ts';

// Late import to dodge a require cycle (runner imports nothing from here, but
// both sides touch shared graph modules — keeping this lazy is cheap insurance).
type SessionLike = {
  send: (text: string, images?: unknown, opts?: Record<string, unknown>) => Promise<void>;
  isBusy?: () => boolean;
  latestSeq: () => number;
  key: string;
  logKey: string;
};

async function getRunner() {
  const mod = await import('./runner.ts');
  return mod as unknown as {
    getOrCreateSession: (opts: { cli: string; repoPath: string; chatId: string }) => Promise<SessionLike>;
  };
}

/** Engine lane → session cli kind. Mirrors WORKSPACE_COMPANIONS ids. */
export function cliForEngine(engine: string): string {
  if (engine.startsWith('claude')) return 'claude';
  if (engine.startsWith('banana')) return engine; // banana | banana-local | banana-fireworks
  if (engine.startsWith('codex')) return 'codex';
  if (engine === 'zai') return 'zai';
  if (engine === 'xai') return 'xai';
  return 'claude';
}

function findAgent(ref: string): Agent | undefined {
  const needle = ref.trim().toLowerCase();
  return listAgents().find((a) => a.id === needle || a.name.trim().toLowerCase() === needle);
}

// ---- guards ----------------------------------------------------------------

const HOP_LIMIT = 4;
const MAX_TEXT = 8000;
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_MAX = 20;
const PAIR_MAX = 8;

const globalDeliveries: number[] = [];
const pairDeliveries = new Map<string, number[]>();

function rateOk(pairKey: string): { ok: boolean; reason?: string } {
  const now = Date.now();
  while (globalDeliveries.length && now - globalDeliveries[0] > GLOBAL_WINDOW_MS) globalDeliveries.shift();
  if (globalDeliveries.length >= GLOBAL_MAX) return { ok: false, reason: 'team message rate limit reached — wait a minute' };
  const arr = pairDeliveries.get(pairKey) ?? [];
  while (arr.length && now - arr[0] > GLOBAL_WINDOW_MS) arr.shift();
  if (arr.length >= PAIR_MAX) return { ok: false, reason: 'this pair is rate limited — wait a minute' };
  globalDeliveries.push(now);
  arr.push(now);
  pairDeliveries.set(pairKey, arr);
  return { ok: true };
}

// ---- delivery ----------------------------------------------------------------

/** Resolve an agent's live session key (lane-stamped, account-suffixed). */
export function agentLogKey(agent: Agent): { cli: string; chatKey: string } {
  const cli = agent.cli || cliForEngine(agent.engine);
  const account = cli === 'claude' || cli === 'codex' ? '__acct__kim' : '';
  return { cli, chatKey: `${agent.home}${account}` };
}

/** Fire-and-forget delivery into an agent's home thread (routines path). */
export async function sendToAgentHome(
  agent: Agent,
  text: string,
  opts: { peerFrom: string; peerFromRole?: string; peerText?: string },
): Promise<{ delivered: boolean; reason?: string }> {
  const { cli, chatKey } = agentLogKey(agent);
  const watchedByHuman = () => opts.peerFromRole === 'automation'
    && isThreadWatched(ELROND_WORKSPACE_PATH, chatKey);
  // Human conversation always owns a visible home thread. Do not even spawn a
  // routine engine while Matt is there; the next scheduled cycle can retry.
  if (watchedByHuman()) {
    return { delivered: false, reason: 'agent thread is actively watched — routine deferred' };
  }
  const runner = await getRunner();
  let session: SessionLike;
  try {
    session = await runner.getOrCreateSession({ cli, repoPath: ELROND_WORKSPACE_PATH, chatId: chatKey });
  } catch (e) {
    return { delivered: false, reason: `engine failed to start: ${(e as Error).message}` };
  }
  if (session.isBusy?.() === true) {
    return { delivered: false, reason: 'agent is mid-turn — routine skipped this cycle' };
  }
  // Recheck after the async bind: the user may have opened the thread while a
  // cold engine was starting.
  if (watchedByHuman()) {
    return { delivered: false, reason: 'agent thread became active — routine deferred' };
  }
  try {
    await session.send(text, undefined, {
      peerFrom: opts.peerFrom,
      peerFromRole: opts.peerFromRole,
      peerText: opts.peerText,
    });
  } catch (e) {
    return { delivered: false, reason: `delivery failed: ${(e as Error).message}` };
  }
  return { delivered: true };
}


export type TeamMessageResult = {
  delivered: boolean;
  to?: string;
  reason?: string;
  reply?: string;
  hop?: number;
};

export async function deliverTeamMessage(input: {
  from: string;
  to: string;
  text: string;
  hop?: number;
  wait?: boolean;
  signal?: AbortSignal;
}): Promise<TeamMessageResult> {
  const hop = Math.max(1, Math.floor(input.hop ?? 1));
  const text = (input.text ?? '').trim().slice(0, MAX_TEXT);
  if (!text) return { delivered: false, reason: 'empty message' };
  if (hop > HOP_LIMIT) return { delivered: false, reason: `hop limit (${HOP_LIMIT}) reached — end the chain and summarize to the human instead` };

  const to = findAgent(input.to);
  if (!to) return { delivered: false, reason: `no teammate named "${input.to}" — call team_list first` };
  const from = findAgent(input.from) ?? { id: 'unknown', name: input.from || 'Unknown', role: '', engine: '', home: '', createdAt: 0 };
  if (to.id === from.id && input.from.trim().toLowerCase() === to.name.trim().toLowerCase()) {
    return { delivered: false, reason: 'that is you — no need to message yourself' };
  }

  const rl = rateOk(`${from.id}->${to.id}`);
  if (!rl.ok) return { delivered: false, reason: rl.reason };

  const runner = await getRunner();
  // Prefer the LIVE lane (stamped on every user turn) over the birth engine —
  // a rebrained teammate receives on the thread the human actually sees.
  const cli = to.cli || cliForEngine(to.engine);
  const repoPath = ELROND_WORKSPACE_PATH;
  // The UI encodes the account into the chatId (`__acct__kim`); deliver into
  // the same key so the thread the human sees is the thread that receives.
  const account = cli === 'claude' || cli === 'codex' ? '__acct__kim' : '';
  const chatKey = `${to.home}${account}`;
  let session: SessionLike;
  try {
    session = await runner.getOrCreateSession({ cli, repoPath, chatId: chatKey });
  } catch (e) {
    return { delivered: false, reason: `recipient engine failed to start: ${(e as Error).message}` };
  }
  if (session.isBusy?.() === true) {
    return { delivered: false, reason: `${to.name} is mid-turn — retry team_message in a little while` };
  }
  if (input.signal?.aborted) return { delivered: false, reason: 'sender stopped before delivery' };

  const waitForReply = input.wait !== false;
  const replyInstruction = waitForReply
    ? `(Reply inline in this turn. Your final answer is returned automatically to ${from.name}. Do NOT call team_message back — ${from.name} is busy waiting for this turn and a direct reply would bounce.)`
    : `(Reply inline for the thread, or use team_message(to: "${from.name}", text: ..., hop: ${hop + 1}) to answer ${from.name} directly.)`;
  const prompt = [
    `[message from teammate ${from.name}${from.role ? ` (${from.role})` : ''} — hop ${hop}/${HOP_LIMIT}]`,
    text,
    '',
    replyInstruction,
  ].join('\n');

  // send() resolves once the prompt is WRITTEN, not when the turn ends —
  // subscribe first and wait for this turn's turnEnd before reading a reply.
  // Reply extraction is floored at this turn's starting seq so a failed turn
  // never returns the PREVIOUS reply as if it were the answer.
  // The live session owns the authoritative engine-free durable key and seq
  // allocator. Building `${cli}|...` here reads an obsolete per-engine file
  // after a rebrain and makes both wait=true and team_recent miss the reply.
  const replyLogKey = session.logKey;
  const startSeq = session.latestSeq() + 1;
  type WaitOutcome = { kind: 'completed'; endSeq: number } | { kind: 'timeout' } | { kind: 'aborted' };
  let settled = false;
  let finishWait!: (outcome: WaitOutcome) => void;
  const turnDoneP = new Promise<WaitOutcome>((resolve) => {
    finishWait = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
  });
  // Delegated checks routinely take several minutes. The prior 150s timeout
  // expired while Kip was still working, then encouraged polling/retries that
  // collided with the original sender's busy turn.
  const REPLY_WAIT_MS = 8 * 60_000;
  const timer = setTimeout(() => finishWait({ kind: 'timeout' }), REPLY_WAIT_MS);
  timer.unref?.();
  const onAbort = () => finishWait({ kind: 'aborted' });
  input.signal?.addEventListener('abort', onAbort, { once: true });
  let unsubscribe: (() => void) | null = null;
  try {
    const sub = (session as unknown as {
      subscribe: (fn: (se: { seq?: number; ev?: { type?: string } }) => void) => () => void;
    }).subscribe((se) => {
      if (se?.ev?.type === 'turnEnd' && (se.seq ?? 0) >= startSeq) {
        unsubscribe?.();
        clearTimeout(timer);
        finishWait({ kind: 'completed', endSeq: se.seq ?? session.latestSeq() });
      }
    });
    unsubscribe = sub;
  } catch { /* no subscribe surface — wait the full window below */ }

  try {
    // peerFrom makes the runner echo a peer_message event (sender-tagged
    // bubble) instead of _user_echo, and skips the compaction turn counter.
    await session.send(prompt, undefined, { peerFrom: from.name, peerFromRole: from.role });
  } catch (e) {
    unsubscribe?.();
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
    return { delivered: false, reason: `delivery failed: ${(e as Error).message}` };
  }

  const result: TeamMessageResult = { delivered: true, to: to.name, hop };
  try {
    if (waitForReply) {
      const outcome = await turnDoneP;
      if (outcome.kind === 'completed') {
        // Bound extraction to this exact turn. A rebrain or follow-up can append
        // another assistant message before disk flush/retry and must not replace
        // the recipient's actual reply.
        result.reply = await readLastReply(replyLogKey, startSeq, outcome.endSeq).catch(() => undefined);
        if (!result.reply) {
          await new Promise((r) => setTimeout(r, 1500));
          result.reply = await readLastReply(replyLogKey, startSeq, outcome.endSeq).catch(() => undefined);
        }
        if (!result.reply) result.reason = 'reply not captured (check the thread) — delivered';
      } else if (outcome.kind === 'timeout') {
        result.reason = `${to.name} is still working after ${Math.round(REPLY_WAIT_MS / 60_000)} minutes — delivery remains in their thread`;
      } else {
        result.reason = `sender stopped waiting — delivery remains in ${to.name}'s thread`;
      }
    }
    return result;
  } finally {
    unsubscribe?.();
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

// ---- reply extraction ---------------------------------------------------------

import { flushEventLog, loadEventLogSync } from './event-log-store.ts';

/** Read the recipient's authoritative shared-thread tail for this exact turn. */
async function readLastReply(logKey: string, minSeq = 0, maxSeq = Number.POSITIVE_INFINITY): Promise<string | undefined> {
  try { await flushEventLog(logKey); } catch { /* best-effort */ }
  const { events } = loadEventLogSync(logKey);
  const bounded = events.filter((event) => event.seq >= minSeq && event.seq <= maxSeq);
  // One shared transcript extractor handles Claude's full assistant messages
  // plus Codex/Banana stream-only content blocks, while excluding tool results.
  const reply = [...extractVisibleTurns(bounded)].reverse().find((turn) => turn.role === 'assistant');
  return reply?.text.trim() || undefined;
}

// ---- introspection ------------------------------------------------------------

export function teamRoster() {
  return listAgents().map((a) => ({ id: a.id, name: a.name, role: a.role, engine: a.engine }));
}

/** Recent visible texts from an agent's authoritative shared home thread. */
export async function teamRecent(name: string, limit = 8): Promise<Array<{ who: 'agent' | 'user' | 'peer'; text: string }>> {
  const agent = findAgent(name);
  if (!agent) return [];
  const { cli, chatKey } = agentLogKey(agent);
  const logKey = logKeyFor(cli, ELROND_WORKSPACE_PATH, chatKey);
  // Polls commonly happen immediately after delivery/turnEnd; wait for the
  // append chain so team_recent never reports an empty stale disk tail.
  try { await flushEventLog(logKey); } catch { /* best-effort */ }
  const { events } = loadEventLogSync(logKey);
  return extractVisibleTurns(events).slice(-limit).map((turn) => {
    const peer = turn.role === 'user' ? /^\[([^\]]+)]\s+([\s\S]*)$/.exec(turn.text) : null;
    return {
      who: turn.role === 'assistant' ? 'agent' as const : peer ? 'peer' as const : 'user' as const,
      text: (peer?.[2] ?? turn.text).replace(/\s+/g, ' ').trim().slice(0, 400),
    };
  });
}
