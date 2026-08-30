// Team bus — agent-to-agent messaging. Any teammate can message any other
// teammate through the `rivendell-team` MCP tool (see server/scripts/team-mcp.mjs);
// delivery lands in the recipient's home thread as a `peer_message` event
// (rendered with the sender's identity, not as a user turn) and wakes the
// recipient's engine for a real turn. Guards: hop limit, rate limits, text cap,
// busy-recipient reporting — free conversation, no runaway loops.

import { join } from 'node:path';
import { ELROND_WORKSPACE_PATH } from '../config.ts';
import { listAgents, type Agent } from './agents.ts';

// Late import to dodge a require cycle (runner imports nothing from here, but
// both sides touch shared graph modules — keeping this lazy is cheap insurance).
type SessionLike = {
  send: (text: string, images?: unknown, opts?: Record<string, unknown>) => Promise<void>;
  isBusy?: () => boolean;
  key: string;
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
  opts: { peerFrom: string; peerFromRole?: string },
): Promise<{ delivered: boolean; reason?: string }> {
  const runner = await getRunner();
  const { cli, chatKey } = agentLogKey(agent);
  let session: SessionLike;
  try {
    session = await runner.getOrCreateSession({ cli, repoPath: ELROND_WORKSPACE_PATH, chatId: chatKey });
  } catch (e) {
    return { delivered: false, reason: `engine failed to start: ${(e as Error).message}` };
  }
  if (session.isBusy?.() === true) {
    return { delivered: false, reason: 'agent is mid-turn — routine skipped this cycle' };
  }
  try {
    await session.send(text, undefined, { peerFrom: opts.peerFrom, peerFromRole: opts.peerFromRole });
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

  const prompt = [
    `[message from teammate ${from.name}${from.role ? ` (${from.role})` : ''} — hop ${hop}/${HOP_LIMIT}]`,
    text,
    '',
    `(Reply inline for the thread, or use team_message(to: "${from.name}", text: ..., hop: ${hop + 1}) to answer ${from.name} directly.)`,
  ].join('\n');

  // send() resolves once the prompt is WRITTEN, not when the turn ends —
  // subscribe first and wait for this turn's turnEnd before reading a reply.
  // Reply extraction is floored at this turn's starting seq so a failed turn
  // never returns the PREVIOUS reply as if it were the answer.
  let startSeq = 0;
  try {
    const { nextSeq } = loadEventLogSync(`${cli}|${ELROND_WORKSPACE_PATH}|${chatKey}`);
    startSeq = nextSeq;
  } catch { /* no log yet */ }
  let turnDone: () => void;
  const turnDoneP = new Promise<void>((resolve) => { turnDone = resolve; });
  const REPLY_WAIT_MS = 150_000;
  const timer = setTimeout(turnDone!, REPLY_WAIT_MS);
  timer.unref?.();
  let unsubscribe: (() => void) | null = null;
  try {
    const sub = (session as unknown as {
      subscribe: (fn: (se: { ev?: { type?: string } }) => void) => () => void;
    }).subscribe((se) => {
      if (se?.ev?.type === 'turnEnd') {
        unsubscribe?.();
        clearTimeout(timer);
        turnDone();
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
    return { delivered: false, reason: `delivery failed: ${(e as Error).message}` };
  }

  const result: TeamMessageResult = { delivered: true, to: to.name, hop };
  if (input.wait !== false) {
    await turnDoneP;
    // The log flushes lazily — flush, and retry once: the reply text usually
    // lands within a second or two of turnEnd.
    result.reply = await readLastReply(cli, repoPath, chatKey, startSeq).catch(() => undefined);
    if (!result.reply) {
      await new Promise((r) => setTimeout(r, 1500));
      result.reply = await readLastReply(cli, repoPath, chatKey, startSeq).catch(() => undefined);
    }
    if (!result.reply) result.reason = 'reply not captured (check the thread) — delivered';
  }
  unsubscribe?.();
  clearTimeout(timer);
  return result;
}

// ---- reply extraction ---------------------------------------------------------

import { readFileSync } from 'node:fs';
import { EVENT_LOG_DIR, flushEventLog, loadEventLogSync } from './event-log-store.ts';

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

/** Read the recipient's log tail for the last assistant-authored text. */
async function readLastReply(cli: string, repoPath: string, chatId: string, minSeq = 0): Promise<string | undefined> {
  const { readFile } = await import('node:fs/promises');
  try { await flushEventLog(`${cli}|${repoPath}|${chatId}`); } catch { /* best-effort */ }
  const file = join(EVENT_LOG_DIR, `${sanitizeKey(`${cli}|${repoPath}|${chatId}`)}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"assistant"')) continue;
    try {
      const parsed = JSON.parse(line);
      const ev = parsed?.ev ?? parsed;
      if (typeof ev?.seq === 'number' && ev.seq < minSeq) break; // older than this turn
      const inner = ev?.event ?? ev;
      if (inner?.type !== 'assistant') continue;
      const content = inner?.message?.content;
      const texts: string[] = [];
      if (typeof content === 'string') texts.push(content);
      else if (Array.isArray(content)) {
        for (const c of content) if (c?.type === 'text' && typeof c.text === 'string') texts.push(c.text);
      }
      const joined = texts.join('\n').trim();
      if (joined) return joined.slice(0, 4000);
    } catch { /* keep scanning */ }
  }
  return undefined;
}

// ---- introspection ------------------------------------------------------------

export function teamRoster() {
  return listAgents().map((a) => ({ id: a.id, name: a.name, role: a.role, engine: a.engine }));
}

/** Recent visible texts from an agent's home thread (for team_recent). */
export async function teamRecent(name: string, limit = 8): Promise<Array<{ who: 'agent' | 'user' | 'peer'; text: string }>> {
  const a = findAgent(name);
  if (!a) return [];
  const { readFile } = await import('node:fs/promises');
  const cli = cliForEngine(a.engine);
  const account = a.engine === 'claude-kim' || a.engine === 'codex-kim' ? '__acct__kim' : '';
  const file = join(EVENT_LOG_DIR, `${sanitizeKey(`${cli}|${ELROND_WORKSPACE_PATH}|${a.home}${account}`)}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out: Array<{ who: 'agent' | 'user' | 'peer'; text: string }> = [];
  for (const line of raw.split('\n')) {
    if (!line || !line.includes('"text"')) continue;
    try {
      const parsed = JSON.parse(line);
      const ev = parsed?.ev ?? parsed;
      const inner = ev?.event ?? ev;
      let who: 'agent' | 'user' | 'peer' | null = null;
      let text: string | null = null;
      if (inner?.type === '_user_echo') { who = 'user'; text = inner.text; }
      else if (inner?.type === 'peer_message') { who = 'peer'; text = inner.text; }
      else if (inner?.type === 'assistant') {
        who = 'agent';
        const content = inner?.message?.content;
        if (typeof content === 'string') text = content;
        else if (Array.isArray(content)) {
          const t = [...content].reverse().find((c: any) => c?.type === 'text' && typeof c.text === 'string');
          text = t?.text ?? null;
        }
      }
      if (who && typeof text === 'string' && text.trim()) {
        out.push({ who, text: text.replace(/\s+/g, ' ').trim().slice(0, 400) });
      }
    } catch { /* skip */ }
  }
  return out.slice(-limit);
}

// Keep the unused-import lint quiet if readFileSync ends up shadowed later.
void readFileSync;
