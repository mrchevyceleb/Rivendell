import type express from 'express';
import type { Server } from 'node:http';
import { basename } from 'node:path';
import { WebSocketServer } from 'ws';
import { discoverRepos } from './repos.ts';
import { readChronicle } from './chronicle.ts';
import { readCommands } from './commands.ts';
import { ensureStateDir } from './sessions.ts';
import { trustedWebSocketOrigin } from '../lib/origin.ts';
import {
  activeClaudeSessions,
  freshStart,
  getOrCreateSession,
  interruptSession,
  isClaudeFamilyCli,
  isClaudeUnrecognizedModelWarning,
  laneLogKey,
  MemoryPressureSpawnError,
  peekClaudeSession,
  pruneIdleClaudeSessions,
  shutdownAllSessions,
  type AnySession,
  type CliKind,
} from './runner.ts';
import { flushEventLog, loadEventLogSync, repairEventLogSequenceSync } from './event-log-store.ts';
import {
  activeCodexSessions,
  pruneIdleCodexSessions,
  shutdownAllCodexSessions,
} from './codex-runner.ts';
import {
  activeBananaSessions,
  listBananaOpenRouterModels,
  listFireworksModels,
  listLocalModels,
  localFullCatalog,
  localVllmStatus,
  serveLocalModel,
  pruneIdleBananaSessions,
  shutdownAllBananaSessions,
} from './banana-runner.ts';
import { emitScribe } from '../worker/scribe.ts';
import { listChatHistory } from './history.ts';
import { watchThread, unwatchThread, setWatchVisible } from './threadWatch.ts';

type ClientSelection = {
  model?: string;
  effort?: string;
  /** Process-local picker revision plus explicit dirty bit. Device defaults
   * report reconfigure=false, so they can never recycle a warm process. */
  selectionRevision?: number;
  reconfigure?: boolean;
};
type ClientHello = { type: 'hello'; cli: CliKind; repo: string; chatId?: string; sinceSeq?: number; visible?: boolean } & ClientSelection;
type ClientWatch = { type: 'watch'; visible?: boolean };
// `model` / `effort` ride on send/steer. Banana and Codex apply them per turn.
// Claude-family lanes (claude/assistant/zai/xai) apply them at spawn; a live
// steer must reuse that spawn, not the Counsel picker's current id.
type ClientSend = { type: 'send'; chatId?: string; text: string; images?: Array<{ mediaType: string; base64: string }>; clientMsgId?: string } & ClientSelection;
type ClientFresh = { type: 'freshStart'; cli: CliKind; repo: string; chatId?: string } & ClientSelection;
type ClientStop = { type: 'stop'; cli: CliKind; repo: string; chatId?: string };
type ClientSteer = { type: 'steer'; cli: CliKind; repo: string; chatId?: string; text: string; images?: Array<{ mediaType: string; base64: string }>; clientMsgId?: string } & ClientSelection;
type ClientMsg = ClientHello | ClientWatch | ClientSend | ClientFresh | ClientStop | ClientSteer;
type ResumeWatchableSession = AnySession & {
  startedWithResume?: () => boolean;
  waitForInitOrExit?: (timeoutMs: number) => Promise<'initialized' | 'closed' | 'timeout'>;
};

type SteerBoundary = 'turn-complete' | 'closed' | 'timeout' | 'aborted';

function sessionHasActiveBoundary(session: AnySession): boolean {
  return (session as { isBusy?: () => boolean }).isBusy?.() === true;
}

/** Every engine finishes its current turn naturally before guidance is sent.
 * This is the only steering policy that can guarantee no tool/process abort. */
function waitForNaturalTurnEnd(session: AnySession, signal: AbortSignal, timeoutMs = 30 * 60_000): Promise<SteerBoundary> {
  if (signal.aborted) return Promise.resolve('aborted');
  if (!sessionHasActiveBoundary(session)) return Promise.resolve('turn-complete');
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => {};
    const onAbort = () => done('aborted');
    const done = (result: SteerBoundary) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      unsubscribe();
      resolve(result);
    };
    const timer = setTimeout(() => done('timeout'), timeoutMs);
    timer.unref?.();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) { done('aborted'); return; }
    try {
      unsubscribe = (session as unknown as {
        subscribe: (fn: (se: { ev?: { type?: string } }) => void, since?: number, count?: boolean) => () => void;
      }).subscribe((se) => {
        if (se.ev?.type === 'turnEnd') done('turn-complete');
        else if (se.ev?.type === 'closed') done('closed');
      }, -1, false);
      // Close the check/subscribe race: the result can land after the first
      // isBusy read but before the listener is attached.
      if (!sessionHasActiveBoundary(session)) done('turn-complete');
    } catch {
      done('timeout');
    }
  });
}

// Personas stay warm all day: measured cost is ~0.5GB per warm session
// (claude CLI + MCP stack) on a 128GB box, so the 30-minute prune was pure
// cold-start tax. 24h still self-heals stale processes overnight (old CLI
// builds, dead OAuth) — and sessions with an open tab are never pruned.
const IDLE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const IDLE_REAPER_INTERVAL_MS = 60 * 1000;
const RESUME_STARTUP_WATCH_MS = 8000;
const DEFAULT_CHAT_ID = 'main';
// Mobile networks (especially Android backgrounded tabs) silently drop WS
// connections without firing onclose on either side. Server-side ping every
// 25s, terminate after one missed pong, so the client's reconcile path can
// reopen instead of leaving the user staring at a dead socket.
const WS_PING_INTERVAL_MS = 25 * 1000;
// Application-level keepalive while a turn is busy. Tool calls, MCP, and
// model thinking produce no stream frames for tens of seconds; without this
// the client's 90s silence watchdog treats a healthy pause as a dead socket.
const TURN_KEEPALIVE_MS = 15 * 1000;
// Restoring a window fires visibilitychange AND focus (plus pageshow/online on
// some paths), so a client emits several identical hellos in the same tick.
// Collapse them: re-binding and re-replaying for each one is wasted work.
const HELLO_DEDUPE_MS = 1500;

function previewText(text: unknown): string {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? flat.slice(0, 77) + '...' : flat;
}

/** Mirror every chat turn into the Scribe rail so a "frozen" UI is verifiable
 *  from the timeline — if the entry shows up there, the server received it
 *  and the gap is downstream of register. */
function logChatTurn(
  wsId: number,
  kind: 'send' | 'steer',
  cli: CliKind | null,
  repo: string | null,
  chatId: string,
  text: string,
): void {
  const repoLabel = repo ? basename(repo) : 'unknown';
  console.log(`[chat ws#${wsId}] ${kind} ${cli ?? '?'}/${chatId}: ${previewText(text)}`);
  void emitScribe({
    level: 'system',
    text: `chat ${kind} ws#${wsId} ${cli ?? '?'}/${repoLabel}/${chatId}: ${previewText(text)}`,
  }).catch((err) => {
    console.warn(`[chat ws#${wsId}] scribe log failed:`, (err as Error).message);
  });
}

function normalizeChatId(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CHAT_ID;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_CHAT_ID;
  // Account-suffixed lanes were a private deployment detail. Collapse legacy
  // clients onto the same public/default-profile thread instead of forking it.
  const withoutLegacyAccount = trimmed.replace(/__acct__[a-z0-9-]+$/i, '');
  const safe = withoutLegacyAccount.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return safe || DEFAULT_CHAT_ID;
}

function selectionRevisionOf(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function sessionCli(session: AnySession | null | undefined): CliKind | null {
  if (!session || typeof session.cli !== 'string') return null;
  return session.cli;
}

/** Spawn model/effort on a live Claude-family process. Missing on Codex/Banana
 *  (those take model per turn). */
function claudeSpawnOf(session: AnySession | null | undefined): { model: string; effort: string } | null {
  if (!session || !('spawnModel' in session)) return null;
  const spawned = session as { spawnModel?: unknown; spawnEffort?: unknown };
  if (typeof spawned.spawnModel !== 'string' || typeof spawned.spawnEffort !== 'string') return null;
  return { model: spawned.spawnModel, effort: spawned.spawnEffort };
}

type DispatchSeqEvent = { seq: number; ev: any };

function isBananaTaggedError(se: DispatchSeqEvent): boolean {
  if (se.ev?.type !== 'error') return false;
  return typeof se.ev.code === 'string' && se.ev.code.startsWith('BANANA_');
}

function isSuccessfulResult(se: DispatchSeqEvent): boolean {
  const event = se.ev?.type === 'event' ? se.ev.event : null;
  return event?.type === 'result' && event.is_error === false;
}

function filterReplayEvents(events: DispatchSeqEvent[]): DispatchSeqEvent[] {
  let lastSuccessSeq = -1;
  for (const se of events) {
    if (isSuccessfulResult(se)) lastSuccessSeq = se.seq;
  }

  let latestUnresolvedBananaErrorSeq = -1;
  for (const se of events) {
    if (se.seq > lastSuccessSeq && isBananaTaggedError(se)) {
      latestUnresolvedBananaErrorSeq = se.seq;
    }
  }

  return events.filter((se) => {
    if (!isBananaTaggedError(se)) return true;
    return se.seq === latestUnresolvedBananaErrorSeq;
  });
}

/** Set on service shutdown: new turns are rejected (existing sockets get a
 *  clean error) so no work starts after the busy lanes were tombstoned. */
let chatQuiesced = false;
export function quiesceChat(): void {
  chatQuiesced = true;
}

export async function registerChat(app: express.Express, server: Server): Promise<() => void> {
  await ensureStateDir();

  app.get('/api/repos', async (_req, res) => {
    try {
      res.json({ repos: await discoverRepos() });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/live', (_req, res) => {
    const sessions = [...activeClaudeSessions(), ...activeCodexSessions(), ...activeBananaSessions()];
    res.json({
      sessions: sessions.map((session) => ({
        cli: session.cli,
        cwd: session.cwd,
        repoName: basename(session.cwd),
        busy: session.busy,
        chatId: session.chatId,
        sessionId: session.sessionId,
        lastActivityAt: session.lastActivityAt,
      })),
    });
  });

  app.get('/api/banana/models', async (_req, res) => {
    try {
      res.json({ data: await listBananaOpenRouterModels() });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Fireworks catalog for the Banana → Fireworks engine. Ids are bare account
  // model ids (`accounts/fireworks/models/<name>`); the client prefixes
  // `fireworks/`.
  app.get('/api/fireworks/models', async (_req, res) => {
    try {
      res.json({ data: await listFireworksModels() });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Local (vLLM) catalog for the Banana → Local engine. Ids are `local/<model>`.
  app.get('/api/local/models', async (_req, res) => {
    try {
      res.json({ data: await listLocalModels() });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Full local catalog for the swap/download picker: loaded model, cached models,
  // and a curated FP8 list.
  app.get('/api/local/catalog', async (_req, res) => {
    try {
      res.json(await localFullCatalog());
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Live vLLM status (which model is loaded + ready) — polled by the picker
  // while a swap/download is in flight.
  app.get('/api/local/status', async (_req, res) => {
    try {
      res.json(await localVllmStatus());
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Swap vLLM to a model (downloads from HF if needed), then auto-reload banana.
  app.post('/api/local/serve', async (req, res) => {
    const body = req.body as Partial<{ model: string; util: string; maxLen: string }>;
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) {
      res.status(400).json({ error: 'model required' });
      return;
    }
    try {
      const result = await serveLocalModel(model, { util: body.util, maxLen: body.maxLen });
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/chat/interrupt', async (req, res) => {
    const body = req.body as Partial<{ cli: CliKind; repo: string; chatId: string }>;
    const cli = body.cli;
    if (
      cli !== 'assistant' &&
      cli !== 'claude' &&
      cli !== 'codex' &&
      cli !== 'banana' &&
      cli !== 'codex-personal' &&
      cli !== 'banana-local' &&
      cli !== 'banana-fireworks' &&
      cli !== 'zai' &&
      cli !== 'xai'
    ) {
      res.status(400).json({ error: 'invalid cli' });
      return;
    }
    if (typeof body.repo !== 'string' || !body.repo.trim()) {
      res.status(400).json({ error: 'invalid repo' });
      return;
    }
    const chatId = normalizeChatId(body.chatId);
    const peer = (req.headers['x-forwarded-for'] as string | undefined)
      ?? req.socket?.remoteAddress ?? '?';
    console.warn(`[chat http] interrupt from ${peer} cli=${cli} repo=${body.repo} chatId=${chatId}`);
    await interruptSession({ cli, repoPath: body.repo, chatId });
    res.json({ ok: true, chatId });
  });

  app.get('/api/chronicle', async (_req, res) => {
    try {
      res.json(await readChronicle());
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/chat/history', async (_req, res) => {
    try {
      res.json({ items: await listChatHistory() });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/commands', async (_req, res) => {
    try {
      res.json(await readCommands());
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Lane-scoped operation generations: a stop/steer from ANY socket (any device) bumps the lane's operation generation; a stale
  // steer awaiting natural turn completion must not write after being superseded.
  const laneGenerations = new Map<string, number>();
  const laneWaiters = new Map<string, AbortController>();
  // Authoritative server ownership for human guidance waiting behind a turn.
  // Reconnects receive these ids in ready/working so a cached "queued" bubble
  // can never remain optimistic forever after a timeout or process restart.
  const pendingSteers = new Map<string, Set<string>>();
  const laneGenKey = (cli: CliKind, repo: string, chatId: string) => `${cli}|${repo}|${chatId}`;
  const addPendingSteer = (key: string, clientMsgId: string | undefined) => {
    if (!clientMsgId) return;
    const ids = pendingSteers.get(key) ?? new Set<string>();
    ids.add(clientMsgId);
    pendingSteers.set(key, ids);
  };
  const deletePendingSteer = (key: string | null, clientMsgId: string | undefined) => {
    if (!key || !clientMsgId) return;
    const ids = pendingSteers.get(key);
    if (!ids) return;
    ids.delete(clientMsgId);
    if (ids.size === 0) pendingSteers.delete(key);
  };
  const pendingSteerIds = (cli: CliKind | null, repo: string | null, id: string): string[] => {
    if (!cli || !repo) return [];
    return [...(pendingSteers.get(laneGenKey(cli, repo, id)) ?? [])];
  };
  const bumpLaneGen = (cli: CliKind, repo: string, chatId: string): number => {
    const k = laneGenKey(cli, repo, chatId);
    laneWaiters.get(k)?.abort();
    laneWaiters.delete(k);
    const n = (laneGenerations.get(k) ?? 0) + 1;
    laneGenerations.set(k, n);
    return n;
  };

  // A repaired durable log can coexist with an older warm session buffer.
  // Remember exactly how far that buffer is stale so every later socket skips
  // only the renumbered prefix while still replaying newer memory-only events.
  const repairedSessionThrough = new WeakMap<AnySession, number>();
  const wss = new WebSocketServer({ noServer: true });
  let wsCounter = 0;
  // Backstop for a client that leaks sockets: a long-lived tab whose orphaned
  // WebSockets keep their handlers attached and keep re-helloing. One browser
  // reached 35 live sockets on a single lane. A healthy client holds one per
  // open conversation, so anything past this cap is a leak - drop the oldest.
  // Pure backstop against a runaway client. Deliberately well above the ~35
  // sockets an old cached bundle can leak: closing sockets a live client still
  // wants just feeds its reconnect loop, which is worse than idle sockets now
  // that hello is attach-only and cheap.
  const MAX_SOCKETS_PER_PEER = 64;
  const peerSockets = new Map<string, Set<import('ws').WebSocket>>();

  const onUpgrade = (req: import('node:http').IncomingMessage, socket: import('node:net').Socket, head: Buffer) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path !== '/api/ws') return;
    if (!trustedWebSocketOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  };
  server.on('upgrade', onUpgrade);

  wss.on('connection', (ws, req) => {
    const wsId = ++wsCounter;
    const peer = (req.headers['x-forwarded-for'] as string | undefined) ?? req.socket.remoteAddress ?? '?';
    console.log(`[chat ws#${wsId}] open from ${peer}`);

    const peerKey = String(peer);
    let peerSet = peerSockets.get(peerKey);
    if (!peerSet) {
      peerSet = new Set();
      peerSockets.set(peerKey, peerSet);
    }
    peerSet.add(ws);
    while (peerSet.size > MAX_SOCKETS_PER_PEER) {
      const oldest = peerSet.values().next().value;
      if (!oldest || oldest === ws) break;
      peerSet.delete(oldest);
      console.warn(`[chat ws#${wsId}] ${peerKey} exceeded ${MAX_SOCKETS_PER_PEER} sockets - closing its oldest`);
      try { oldest.close(4002, 'too many concurrent connections'); } catch { /* already gone */ }
    }

    let sessionPromise: Promise<AnySession> | null = null;
    let unsubscribe: (() => void) | null = null;
    let busy = false;
    let cliKind: CliKind | null = null;
    let repoPath: string | null = null;
    let chatId = DEFAULT_CHAT_ID;
    // The lane this socket is currently counted as watching (threadWatch registry).
    let watchedLane: { repo: string; chatId: string } | null = null;
    let turnGeneration = 0;
    const ownedSteerWaiters = new Set<AbortController>();
    // Last model/effort actually used on this socket (hello/send/steer).
    // Steer must reuse these for Codex/Banana so a drifted Counsel picker
    // cannot feed grok-4.6 into a live Codex turn (Claude-family uses spawnModel).
    let lastTurnModel: string | undefined;
    let lastTurnEffort: string | undefined;
    /** Last authoritative queue set sent to this socket. Keepalive sends one
     * empty transition after cancellation even when the lane just became idle. */
    let lastQueuedSignature = '';
    // Duplicate-hello suppression (see HELLO_DEDUPE_MS).
    let lastHelloSig = '';
    let lastHelloAt = 0;
    // Idle CLI chatter is logged, not surfaced. A wedged lane can emit hundreds
    // of identical lines, so keep the first few and then sample.
    let swallowedIdle = 0;

    // Heartbeat: any pong (or any inbound frame) marks the socket alive. The
    // interval ticks the ping; if a tick finds the socket already not-alive,
    // the prior ping went unanswered and we tear it down so the client's
    // visibility/online listeners can reopen a fresh connection.
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      if (!alive) {
        console.log(`[chat ws#${wsId}] heartbeat lost, terminating`);
        try { ws.terminate(); } catch {}
        return;
      }
      alive = false;
      try { ws.ping(); } catch {}
    }, WS_PING_INTERVAL_MS);
    heartbeat.unref();

    const safeSend = (msg: object) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };

    const keepalive = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      const queuedClientMsgIds = pendingSteerIds(cliKind, repoPath, chatId);
      const signature = queuedClientMsgIds.join('\u0000');
      const queueChanged = signature !== lastQueuedSignature;
      if (!busy && !queueChanged) return;
      safeSend({ type: 'working', busy, queuedClientMsgIds });
      lastQueuedSignature = signature;
    }, TURN_KEEPALIVE_MS);
    keepalive.unref();

    const detachCurrentSession = () => {
      sessionPromise = null;
      busy = false;
      unsubscribe?.();
      unsubscribe = null;
    };

    const dispatch = (se: DispatchSeqEvent) => {
      const sev = se.ev;
      if (sev.type === 'event') {
        safeSend({ type: 'stream', event: sev.event, seq: se.seq });
      } else if (sev.type === 'turnStart') {
        busy = true;
        safeSend({ type: 'turnStart', seq: se.seq });
      } else if (sev.type === 'turnEnd') {
        busy = false;
        safeSend({ type: 'turnEnd', sessionId: sev.sessionId, seq: se.seq });
      } else if (sev.type === 'compacted') {
        // Auto-compaction marker — the model's context rotated with a juicy
        // durable summary (saved to the RAG vault); the visible thread lives on.
        safeSend({ type: 'compacted', chatId: sev.chatId, words: sev.words, turns: sev.turns, count: sev.count, savedToRag: sev.savedToRag, at: sev.at, seq: se.seq });
      } else if (sev.type === 'error') {
        if (typeof sev.message === 'string' && isClaudeUnrecognizedModelWarning(sev.message)) {
          console.log(`[chat ws#${wsId}] swallowed unrecognized_model warning`);
          return;
        }
        // Only surface stderr/spawn errors during an active turn. Banana turn
        // failures are tagged so a reconnect can replay them even after the
        // backend already marked the turn ended; plain idle chatter stays
        // suppressed.
        const code = typeof sev.code === 'string' ? sev.code : '';
        // Fatal errors (e.g. a 401 auth failure) must ALWAYS reach the client,
        // even with no turn in flight, or the chat dies silently. Only harmless
        // idle stderr chatter is suppressed.
        if (busy || sev.fatal || code.startsWith('BANANA_')) {
          // NB: do NOT clear `busy` on fatal. failAuth()'s deferred shutdown
          // fires `closed` next, and the closed branch only sends `sessionClosed`
          // (which clears the client spinner) while `busy` is true. Zeroing it
          // here would swallow that and strand the spinner until the watchdog.
          safeSend({
            type: 'error',
            message: sev.message,
            code: sev.code,
            retryable: sev.retryable,
            seq: se.seq,
          });
        } else {
          swallowedIdle += 1;
          if (swallowedIdle <= 3 || swallowedIdle % 50 === 0) {
            console.log(`[chat ws#${wsId}] swallowed idle stderr (x${swallowedIdle}): ${String(sev.message).slice(0, 200)}`);
          }
        }
      } else if (sev.type === 'closed') {
        // The CLI process is dead. Drop the stale promise + subscription so
        // the next send can rebind via getOrCreateSession, which resumes from
        // the saved session id when possible.
        if (busy && !sev.intentional) {
          // Mid-turn death is a real failure — tell the client.
          safeSend({ type: 'sessionClosed', code: sev.code, seq: se.seq });
        } else {
          // Idle/intentional replacement: swallow it. The current send path
          // resolves the lane owner again before writing.
          console.log(`[chat ws#${wsId}] swallowed ${sev.intentional ? 'intentional' : 'idle'} session close (code=${sev.code})`);
        }
        sessionPromise = null;
        busy = false;
        unsubscribe?.();
        unsubscribe = null;
      }
    };

    const bindSession = async (promise: Promise<AnySession>, sinceSeq = -1) => {
      sessionPromise = promise;
      const session = await promise;
      unsubscribe?.();

      // The durable thread, not an engine's potentially stale in-memory tail,
      // owns replay. Older builds let a resumed Codex session allocate below a
      // Banana/GLM tail; repair those regressions in file chronology before
      // comparing the browser cursor or subscribing to new live events.
      await flushEventLog(session.logKey);
      const repair = repairEventLogSequenceSync(session.logKey);
      if (repair.repaired) {
        repairedSessionThrough.set(
          session,
          Math.max(repairedSessionThrough.get(session) ?? 0, repair.latestSeq),
        );
        console.warn(`[chat ws#${wsId}] repaired non-monotonic event sequence for ${session.logKey}`);
      }
      const { events } = loadEventLogSync(session.logKey);
      const durableLatest = events.reduce((max, event) => Math.max(max, event.seq), 0);
      const latest = Math.max(durableLatest, session.latestSeq());
      const resetReplay = sinceSeq >= 0 && sinceSeq > latest;
      const replaySince = resetReplay ? 0 : sinceSeq;
      if (resetReplay) safeSend({ type: 'replayReset', latestSeq: latest });

      const liveReplay: DispatchSeqEvent[] = [];
      let replaying = replaySince >= 0;
      const listener = (se: DispatchSeqEvent) => {
        if (replaying) {
          liveReplay.push(se);
          return;
        }
        dispatch(se);
      };
      // Replay the session's in-memory tail too. Durable appends deliberately
      // fail soft; subscribing only above the disk high-water would discard a
      // valid buffered reply whose mirror write failed. The one exception is a
      // sequence repair: that session buffer still carries the pre-repair seqs,
      // so disk is authoritative through `latest` and only newer live events
      // may join the replay.
      const staleSessionThrough = repairedSessionThrough.get(session) ?? 0;
      unsubscribe = session.subscribe(listener, Math.max(replaySince, staleSessionThrough));
      if (replaying) {
        const durableReplay: DispatchSeqEvent[] = events
          .filter((event) => event.seq > replaySince)
          .map((event) => ({ seq: event.seq, ev: event.ev as any }));
        const seenSeq = new Set<number>();
        const merged = [...durableReplay, ...liveReplay]
          .sort((a, b) => a.seq - b.seq)
          .filter((event) => {
            if (seenSeq.has(event.seq)) return false;
            seenSeq.add(event.seq);
            return true;
          });
        replaying = false;
        for (const se of filterReplayEvents(merged)) dispatch(se);
      }
      return session;
    };

    /** Replay a lane's durable event log straight to this socket, with no
     *  engine process involved. Same shape and same replay filtering as
     *  bindSession, so a cold attach renders identically to a warm one. */
    const replayFromEventLog = async (
      cli: CliKind,
      repo: string,
      id: string,
      sinceSeq: number,
    ): Promise<number> => {
      const logKey = laneLogKey(cli, repo, id);
      await flushEventLog(logKey);
      const repair = repairEventLogSequenceSync(logKey);
      if (repair.repaired) {
        console.warn(`[chat ws#${wsId}] repaired non-monotonic cold event sequence for ${logKey}`);
      }
      const { events } = loadEventLogSync(logKey);
      let latest = 0;
      for (const event of events) if (event.seq > latest) latest = event.seq;
      const resetReplay = sinceSeq >= 0 && sinceSeq > latest;
      const replaySince = resetReplay ? 0 : sinceSeq;
      if (resetReplay) safeSend({ type: 'replayReset', latestSeq: latest });
      if (replaySince >= 0) {
        const pending: DispatchSeqEvent[] = events
          .filter((event) => event.seq > replaySince)
          .map((event) => ({ seq: event.seq, ev: event.ev as any }));
        for (const se of filterReplayEvents(pending)) dispatch(se);
      }
      return latest;
    };

    const retryOnceAfterStaleResume = async (
      session: AnySession,
      text: string,
      generation: number,
      images?: Array<{ mediaType: string; base64: string }>,
      model?: string,
      effort?: string,
      clientMsgId?: string,
    ): Promise<boolean> => {
      if (!cliKind || !repoPath || cliKind === 'codex') return false;
      const watchable = session as ResumeWatchableSession;
      if (watchable.startedWithResume?.() !== true || !watchable.waitForInitOrExit) return false;

      const state = await watchable.waitForInitOrExit(RESUME_STARTUP_WATCH_MS);
      if (state !== 'closed') return false;
      if (generation !== turnGeneration) return false;

      console.log(`[chat ws#${wsId}] stale resume closed before init, retrying fresh`);
      try {
        const retrySession = await bindSession(getOrCreateSession({ cli: cliKind, repoPath, chatId, model, effort }));
        busy = true;
        safeSend({ type: 'sessionRebound' });
        safeSend({ type: 'turnStart' });
        // send() is async (ClaudeSession runs the vision adapter); this retry is
        // fire-and-forget, so guard the promise or a rejection escapes the outer
        // try/catch as an unhandled rejection.
        if ('send' in retrySession) {
          void Promise.resolve((retrySession as any).send(text, images, { model, clientMsgId, skipAttachments: true })).catch((e: Error) => {
            // Don't just log: a rejected retry-send would otherwise strand the
            // client with busy=true and no turnEnd. Clean up the turn like the
            // synchronous catch below.
            console.warn(`[chat ws#${wsId}] retry send failed:`, e?.message ?? e);
            busy = false;
            safeSend({ type: 'error', message: String(e?.message ?? e) });
            safeSend({ type: 'turnEnd' });
          });
        }
        return true;
      } catch (error) {
        console.warn(`[chat ws#${wsId}] stale resume retry failed:`, (error as Error).message);
        busy = false;
        safeSend({ type: 'error', message: String((error as Error).message) });
        safeSend({ type: 'turnEnd' });
        return false;
      }
    };

    ws.on('message', async (raw) => {
      // Inbound traffic counts as proof-of-life for the heartbeat — no need to
      // wait for the next pong if the client just sent us a real message.
      alive = true;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        safeSend({ type: 'error', message: 'invalid JSON' });
        return;
      }

      try {
        if (msg.type === 'hello') {
          cliKind = msg.cli;
          repoPath = msg.repo;
          chatId = normalizeChatId(msg.chatId);
          const sinceSeq = typeof msg.sinceSeq === 'number' ? msg.sinceSeq : -1;
          // Same-lane re-hellos (focus/online/pageshow reconcile) refresh
          // visibility even when the replay dedupe below swallows the rest —
          // a lost or racing watch message must self-heal on the next hello.
          if (watchedLane && watchedLane.repo === msg.repo && watchedLane.chatId === chatId) {
            setWatchVisible(watchedLane.repo, watchedLane.chatId, wsId, msg.visible !== false);
          }
          const helloSig = `${msg.cli}|${msg.repo}|${chatId}|${sinceSeq}`;
          const helloAt = Date.now();
          if (helloSig === lastHelloSig && helloAt - lastHelloAt < HELLO_DEDUPE_MS) return;
          lastHelloSig = helloSig;
          lastHelloAt = helloAt;
          console.log(`[chat ws#${wsId}] hello cli=${msg.cli} repo=${msg.repo} chatId=${chatId} sinceSeq=${sinceSeq}`);
          if (watchedLane && (watchedLane.repo !== msg.repo || watchedLane.chatId !== chatId)) {
            unwatchThread(watchedLane.repo, watchedLane.chatId, wsId);
            watchedLane = null;
          }
          if (!watchedLane) {
            // Client reports tab visibility in hello; a backgrounded tab must
            // not suppress the badge on other devices.
            watchThread(msg.repo, chatId, wsId, msg.visible !== false);
            watchedLane = { repo: msg.repo, chatId };
          }
          // A hello is a passive attach and must never start an engine process.
          // Warm lane -> attach to it. Cold lane -> serve the durable log and
          // wait; the first real turn spawns lazily in the `send` handler.
          const warm = peekClaudeSession({ cli: msg.cli, repoPath: msg.repo, chatId });
          if (!warm && isClaudeFamilyCli(msg.cli)) {
            // Drop any session this socket was already bound to. Without it a
            // socket that re-helloes onto a different, cold lane keeps the old
            // lane's subscription - those events would stream into the new
            // lane's transcript - and `send` would reuse the stale
            // sessionPromise instead of starting the lane that was asked for.
            detachCurrentSession();
            const coldLatestSeq = await replayFromEventLog(msg.cli, msg.repo, chatId, sinceSeq);
            lastTurnModel = msg.model;
            lastTurnEffort = msg.effort;
            busy = false;
            console.log(`[chat ws#${wsId}] attached cold ${laneLogKey(msg.cli, msg.repo, chatId)} latestSeq=${coldLatestSeq} (no spawn)`);
            const queuedClientMsgIds = pendingSteerIds(msg.cli, msg.repo, chatId);
            lastQueuedSignature = queuedClientMsgIds.join('\u0000');
            safeSend({
              type: 'ready',
              cli: msg.cli,
              repo: msg.repo,
              chatId,
              latestSeq: coldLatestSeq,
              busy: false,
              queuedClientMsgIds,
            });
            return;
          }
          const session = await bindSession(
            warm
              ? Promise.resolve(warm)
              : getOrCreateSession({ cli: msg.cli, repoPath: msg.repo, chatId, model: msg.model, effort: msg.effort }),
            sinceSeq,
          );
          lastTurnModel = msg.model;
          lastTurnEffort = msg.effort;
          const sessionBusy = (session as any).isBusy?.() === true;
          busy = sessionBusy;
          console.log(`[chat ws#${wsId}] session ready key=${session.key} latestSeq=${session.latestSeq()} busy=${sessionBusy}`);
          const queuedClientMsgIds = pendingSteerIds(msg.cli, msg.repo, chatId);
          lastQueuedSignature = queuedClientMsgIds.join('\u0000');
          safeSend({
            type: 'ready',
            cli: msg.cli,
            repo: msg.repo,
            chatId,
            latestSeq: session.latestSeq(),
            busy: sessionBusy,
            queuedClientMsgIds,
          });
          return;
        }

        if (msg.type === 'freshStart') {
          turnGeneration += 1;
          chatId = normalizeChatId(msg.chatId);
          bumpLaneGen(cliKind ?? msg.cli, repoPath ?? msg.repo, chatId);
          console.warn(`[chat ws#${wsId}] freshStart from ${peer} cli=${msg.cli} repo=${msg.repo} chatId=${chatId}`);
          detachCurrentSession();
          const session = await bindSession(
            freshStart({ cli: msg.cli, repoPath: msg.repo, chatId, model: msg.model, effort: msg.effort }),
          );
          lastTurnModel = msg.model;
          lastTurnEffort = msg.effort;
          cliKind = msg.cli;
          repoPath = msg.repo;
          busy = false;
          safeSend({ type: 'selectionApplied', selectionRevision: selectionRevisionOf(msg.selectionRevision) });
          safeSend({ type: 'freshStarted', cli: msg.cli, repo: msg.repo, chatId, latestSeq: session.latestSeq() });
          return;
        }

        if (msg.type === 'stop') {
          turnGeneration += 1;
          chatId = normalizeChatId(msg.chatId);
          const stopCli = cliKind ?? msg.cli;
          const stopRepo = repoPath ?? msg.repo;
          console.warn(`[chat ws#${wsId}] stop from ${peer} cli=${stopCli} repo=${stopRepo} chatId=${chatId}`);
          bumpLaneGen(stopCli, stopRepo, chatId);
          detachCurrentSession();
          await interruptSession({ cli: stopCli, repoPath: stopRepo, chatId });
          safeSend({ type: 'turnEnd' });
          return;
        }

        if (msg.type === 'watch') {
          if (watchedLane) setWatchVisible(watchedLane.repo, watchedLane.chatId, wsId, msg.visible !== false);
          return;
        }

        if (msg.type === 'steer') {
          if (chatQuiesced) {
            safeSend({ type: 'error', code: 'STEER_REJECTED', clientMsgId: msg.clientMsgId, message: 'Rivendell is restarting — try again in a few seconds.' });
            safeSend({ type: 'turnEnd' });
            return;
          }
          turnGeneration += 1;
          chatId = normalizeChatId(msg.chatId);
          // Own cancellation from the first await through the final stdin
          // write. Stop, Fresh, or a newer steer aborts this path. A socket
          // close does NOT: accepted guidance must survive tab switches and
          // reconnects, and its durable echo will reach whichever socket binds.
          const steerAborter = new AbortController();
          ownedSteerWaiters.add(steerAborter);
          let waitKey: string | null = null;
          const releaseSteer = () => {
            ownedSteerWaiters.delete(steerAborter);
            if (waitKey && laneWaiters.get(waitKey) === steerAborter) laneWaiters.delete(waitKey);
          };
          const rejectSteer = (message = 'Queued guidance was superseded or canceled before delivery.') => {
            deletePendingSteer(waitKey, msg.clientMsgId);
            safeSend({ type: 'steerRejected', clientMsgId: msg.clientMsgId, message, busy });
          };
          // Pin to the engine already bound on this socket. Counsel picker
          // drift (Grok 4.6 while a Claude turn is live, or vice versa) must
          // not respawn the wrong runner with a model it cannot accept.
          let steerCli: CliKind = cliKind ?? msg.cli;
          let steerRepo = repoPath ?? msg.repo;
          let steerModel = msg.model;
          let steerEffort = msg.effort;
          const bound = sessionPromise;
          // Register on the socket's current lane BEFORE awaiting its bind. A
          // Stop/Fresh/new steer during a cold bind can now abort this operation.
          waitKey = laneGenKey(steerCli, steerRepo, chatId);
          let laneGen = bumpLaneGen(steerCli, steerRepo, chatId);
          laneWaiters.set(waitKey, steerAborter);
          addPendingSteer(waitKey, msg.clientMsgId);
          if (bound) {
            try {
              const current = await bound;
              if (steerAborter.signal.aborted) { rejectSteer(); releaseSteer(); return; }
              const live = sessionCli(current);
              if (live) steerCli = live;
              const spawned = isClaudeFamilyCli(steerCli) ? claudeSpawnOf(current) : null;
              if (spawned) {
                steerModel = spawned.model;
                steerEffort = spawned.effort;
              } else {
                if (lastTurnModel !== undefined) steerModel = lastTurnModel;
                if (lastTurnEffort !== undefined) steerEffort = lastTurnEffort;
              }
            } catch {
              // Dead bind — fall through with hello/picker values.
            }
          }
          if (steerAborter.signal.aborted) { rejectSteer(); releaseSteer(); return; }
          const resolvedKey = laneGenKey(steerCli, steerRepo, chatId);
          if (resolvedKey !== waitKey) {
            if (waitKey && laneWaiters.get(waitKey) === steerAborter) laneWaiters.delete(waitKey);
            deletePendingSteer(waitKey, msg.clientMsgId);
            laneGen = bumpLaneGen(steerCli, steerRepo, chatId);
            waitKey = resolvedKey;
            laneWaiters.set(waitKey, steerAborter);
            addPendingSteer(waitKey, msg.clientMsgId);
          }
          console.warn(`[chat ws#${wsId}] steer from ${peer} cli=${steerCli} repo=${steerRepo} chatId=${chatId}`);
          // Lane-scoped supersession: recheck after every await so a stopped,
          // reset, disconnected, or superseded steer never writes later.
          const laneGenStale = () => !waitKey || laneGenerations.get(waitKey) !== laneGen;
          // STRICTLY NON-DESTRUCTIVE steer: every engine finishes its current
          // turn naturally. No control interrupt and no process signal occurs.
          let session: AnySession | null = bound ? await bound.catch(() => null) : null;
          if (steerAborter.signal.aborted || laneGenStale()) { rejectSteer(); releaseSteer(); return; }
          if (
            session
            && (session as { isPrewarming?: () => boolean }).isPrewarming?.() === true
            && 'prewarm' in session
            && typeof session.prewarm === 'function'
          ) {
            await session.prewarm().catch(() => {});
            if (steerAborter.signal.aborted || laneGenStale()) { rejectSteer(); releaseSteer(); return; }
          }
          // Claude Code's native stream-json input is trustworthy only while a
          // tool is actively executing: guidance then lands before the next
          // provider request. If inference has already begun, stdin still
          // accepts and echoes the message but that request can silently ignore
          // it. canAcceptNativeHumanSteer() exposes only the safe tool window;
          // every other phase finishes naturally and starts a separate turn.
          // Scheduled automation never absorbs human input as mission guidance.
          const nativeClaudeSteer = Boolean(
            session
            && (!msg.images || msg.images.length === 0)
            && isClaudeFamilyCli(steerCli)
            && (session as { canAcceptNativeHumanSteer?: () => boolean })
              .canAcceptNativeHumanSteer?.() === true,
          );
          const steerDeadline = Date.now() + 30 * 60_000;
          while (!nativeClaudeSteer && session && sessionHasActiveBoundary(session)) {
            const remaining = Math.max(1, steerDeadline - Date.now());
            const boundary = await waitForNaturalTurnEnd(session, steerAborter.signal, remaining);
            if (steerAborter.signal.aborted || laneGenStale() || boundary === 'aborted') { rejectSteer(); releaseSteer(); return; }
            if (boundary === 'closed') { session = null; break; }
            if (boundary === 'timeout') {
              rejectSteer('Guidance is still waiting for the current turn to finish. The running agent was not interrupted; try again later or use Stop.');
              releaseSteer();
              return;
            }
            // Some engines immediately start an internal continuation after
            // turnEnd. Loop until the session is genuinely idle.
          }
          if (session) {
            console.warn(`[chat ws#${wsId}] guidance ${nativeClaudeSteer ? 'queued natively in active Claude turn' : 'queued after natural turn completion'}`);
          }
          if (session && (session as { isAlive?: () => boolean }).isAlive?.() === false) session = null;
          if (!session) {
            // The old process is already gone; starting its normal replacement
            // is recovery, not an interrupt. Never call interruptSession here.
            detachCurrentSession();
            try {
              const replacement = await getOrCreateSession({
                cli: steerCli,
                repoPath: steerRepo,
                chatId,
                model: steerModel,
                effort: steerEffort,
              });
              if (steerAborter.signal.aborted || laneGenStale()) {
                rejectSteer();
                releaseSteer();
                return;
              }
              session = await bindSession(Promise.resolve(replacement));
              if (steerAborter.signal.aborted || laneGenStale()) {
                detachCurrentSession(); // unsubscribe the bind created after close/cancel
                rejectSteer();
                releaseSteer();
                return;
              }
            } catch (error) {
              rejectSteer(`Guidance could not bind safely: ${(error as Error).message}`);
              releaseSteer();
              safeSend({ type: 'turnEnd' });
              return;
            }
          }
          if (steerAborter.signal.aborted || laneGenStale()) { rejectSteer(); releaseSteer(); return; }
          if ((session as { isAlive?: () => boolean }).isAlive?.() === false) {
            rejectSteer('Guidance target closed before delivery — try again.');
            releaseSteer();
            safeSend({ type: 'turnEnd' });
            return;
          }
          if (chatQuiesced) {
            rejectSteer('Rivendell is restarting — try again in a few seconds.');
            releaseSteer();
            safeSend({ type: 'turnEnd' });
            return;
          }
          cliKind = steerCli;
          repoPath = steerRepo;
          busy = true;
          // This is the commit point: all cancellation/generation checks passed.
          // An idle/after-turn delivery starts a new turn. Native Claude steer
          // remains inside the already-running turn; its _user_echo carries the
          // clientMsgId that clears the client's queued state.
          if (!nativeClaudeSteer) safeSend({ type: 'turnStart', clientMsgId: msg.clientMsgId });
          logChatTurn(wsId, 'steer', steerCli, steerRepo, chatId, msg.text);
          ++turnGeneration;
          try {
            await (session as any).send(msg.text, msg.images, {
              model: steerModel,
              effort: steerEffort,
              clientMsgId: msg.clientMsgId,
              allowNativeHumanSteer: nativeClaudeSteer,
              signal: steerAborter.signal,
            });
          } finally {
            // Keep cross-device Stop/Fresh/newer guidance capable of aborting
            // through attachment persistence and the vision adapter. The
            // durable _user_echo is emitted before send resolves, so deleting
            // authoritative ownership here cannot race ahead of acceptance.
            deletePendingSteer(waitKey, msg.clientMsgId);
            releaseSteer();
          }
          lastTurnModel = steerModel;
          lastTurnEffort = steerEffort;
          // Guidance is never auto-resubmitted after acceptance: a cross-device
          // Stop/Fresh must not be undone by the stale-resume retry helper.
          return;
        }

        if (msg.type === 'send') {
          if (chatQuiesced) {
            safeSend({ type: 'error', message: 'Rivendell is restarting — try again in a few seconds.' });
            safeSend({ type: 'turnEnd' });
            return;
          }
          const requestedChatId = normalizeChatId(msg.chatId ?? chatId);
          if (requestedChatId !== chatId) {
            safeSend({ type: 'error', message: 'chat tab changed - reconnect before sending' });
            return;
          }
          if (!cliKind || !repoPath) {
            safeSend({ type: 'error', message: 'no session - send hello first' });
            return;
          }
          const sendCli = cliKind;
          const sendRepo = repoPath;
          const sendKey = laneGenKey(sendCli, sendRepo, chatId);
          const sendAborter = new AbortController();
          const sendLaneGeneration = bumpLaneGen(sendCli, sendRepo, chatId);
          laneWaiters.set(sendKey, sendAborter);
          ownedSteerWaiters.add(sendAborter);
          const sendCanceled = () => sendAborter.signal.aborted
            || laneGenerations.get(sendKey) !== sendLaneGeneration;
          const releaseSend = () => {
            ownedSteerWaiters.delete(sendAborter);
            if (laneWaiters.get(sendKey) === sendAborter) laneWaiters.delete(sendKey);
          };
          try {
          if (!sessionPromise && cliKind && repoPath) {
            // Claim the turn BEFORE the spawn. The client arms its 90s silence
            // watchdog the moment it sends, and the `working` keepalive below is
            // gated on `busy`, so with busy=false a 30-70s MCP startup looked
            // like a dead socket and the client force-reconnected mid-spawn.
            // Now hello never spawns, this is the only place that cost lands.
            // Restored immediately after so the turn bookkeeping below (and
            // `wasBusy`) still sees a fresh, idle turn.
            busy = true;
            try {
              // Spawn with the picked model/effort. Omitting them started the
              // lane on defaults, and the model/effort reconcile further down
              // then SIGTERMed that brand-new process to respawn on the right
              // model - two full spawns, each paying 30-70s of MCP startup, for
              // every cold lane's first turn. That is the cost this outage fix
              // exists to kill.
              await bindSession(getOrCreateSession({
                cli: cliKind,
                repoPath,
                chatId,
                model: msg.model,
                effort: msg.effort,
              }));
              if (sendCanceled()) return;
            } finally {
              busy = false;
            }
          }
          if (!sessionPromise) {
            safeSend({ type: 'error', message: 'no session - send hello first' });
            return;
          }
          if (busy && cliKind === 'codex') {
            safeSend({ type: 'error', message: 'codex is on a turn - wait for the result' });
            return;
          }
          // Model/effort values are device-local. Only the explicit dirty bit
          // advanced by a real picker click may recycle a warm Claude-family
          // process. Defaults/hydration/reconnects always send false.
          const selectionChangeRequested = msg.reconfigure === true;
          const requestedSelectionRevision = selectionRevisionOf(msg.selectionRevision);
          let selectionApplied = false;
          const generation = ++turnGeneration;
          let session: AnySession | null = await sessionPromise;
          if (sendCanceled()) return;

          if (!session && cliKind && repoPath) {
            // sessionPromise resolved to a dead/null session — rebind a fresh
            // one rather than crashing on `null.send`.
            session = await bindSession(getOrCreateSession({ cli: cliKind, repoPath, chatId }));
            if (sendCanceled()) return;
          }
          const initiallyBusy = Boolean(session && (session as { isBusy?: () => boolean }).isBusy?.() === true);

          // Persistent CLIs (claude/assistant): reconcile the spawned model/effort
          // with the current pick before an idle turn. An attach-only lookup on
          // every idle send also resolves a replacement made by another socket;
          // recycleOnMismatch remains explicit, so stale device defaults cannot
          // cause replacement themselves.
          if (!initiallyBusy && isClaudeFamilyCli(cliKind) && repoPath) {
            const reconciled = await getOrCreateSession({
              cli: cliKind,
              repoPath,
              chatId,
              model: msg.model,
              effort: msg.effort,
              recycleOnMismatch: selectionChangeRequested,
            });
            if (reconciled !== session) session = await bindSession(Promise.resolve(reconciled));
            if (sendCanceled()) return;
            if (selectionChangeRequested) {
              selectionApplied = true;
            } else {
              const spawned = claudeSpawnOf(session);
              if (spawned && (spawned.model !== msg.model || spawned.effort !== msg.effort)) {
                console.log(
                  `[chat ws#${wsId}] preserving warm ${cliKind} session across device-local model/effort mismatch`,
                );
              }
            }
          }
          if (session && (session as { isAlive?: () => boolean }).isAlive?.() === false) {
            session = repoPath && cliKind
              ? await bindSession(getOrCreateSession({ cli: cliKind, repoPath, chatId, model: msg.model, effort: msg.effort }))
              : null;
            if (sendCanceled()) return;
          }
          if (!session) throw new Error('session unavailable, please retry');
          if (sendCanceled()) return;
          // Recompute after every awaited owner/rebind operation. Another send
          // may have started this session while we yielded.
          const wasBusy = (session as { isBusy?: () => boolean }).isBusy?.() === true;
          busy = wasBusy;
          if (!wasBusy) {
            busy = true;
            safeSend({ type: 'turnStart' });
          } else if (cliKind === 'codex') {
            safeSend({ type: 'error', message: 'codex is on a turn - wait for the result' });
            return;
          }
          if (chatQuiesced) {
            safeSend({ type: 'error', message: 'Rivendell is restarting — try again in a few seconds.' });
            safeSend({ type: 'turnEnd' });
            return;
          }
          logChatTurn(wsId, 'send', cliKind, repoPath, chatId, msg.text);
          await (session as any).send(msg.text, msg.images, {
            model: msg.model,
            effort: msg.effort,
            clientMsgId: msg.clientMsgId,
            signal: sendAborter.signal,
          });
          if (sendCanceled()) return;
          if (selectionApplied) {
            safeSend({ type: 'selectionApplied', selectionRevision: requestedSelectionRevision });
          }
          lastTurnModel = msg.model;
          lastTurnEffort = msg.effort;
          void retryOnceAfterStaleResume(session, msg.text, generation, msg.images, msg.model, msg.effort, msg.clientMsgId);
          } finally {
            releaseSend();
          }
        }
      } catch (error) {
        busy = false;
        if (error instanceof MemoryPressureSpawnError) {
          console.warn(`[chat ws#${wsId}] memory-pressure spawn refused: ${error.message}`);
          safeSend({
            type: 'error',
            code: error.code,
            retryable: true,
            message: error.message,
          });
        } else {
          safeSend({ type: 'error', message: (error as Error).message });
        }
        safeSend({ type: 'turnEnd' });
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(keepalive);
      // Do not abort ownedSteerWaiters here. The server already accepted those
      // messages; they must cross the natural turn boundary even if a mobile
      // tab sleeps, navigates to another agent, or reconnects. releaseSteer()
      // removes each waiter after delivery/rejection. Lane Stop/Fresh/new steer
      // still aborts it through bumpLaneGen().
      unsubscribe?.();
      unsubscribe = null;
      const set = peerSockets.get(peerKey);
      if (set) {
        set.delete(ws);
        if (set.size === 0) peerSockets.delete(peerKey);
      }
      if (watchedLane) {
        unwatchThread(watchedLane.repo, watchedLane.chatId, wsId);
        watchedLane = null;
      }
      console.log(`[chat ws#${wsId}] close`);
    });
  });

  const idleReaper = setInterval(() => {
    const now = Date.now();
    const pruned = pruneIdleClaudeSessions(IDLE_SESSION_TTL_MS, now)
      + pruneIdleCodexSessions(IDLE_SESSION_TTL_MS, now)
      + pruneIdleBananaSessions(IDLE_SESSION_TTL_MS, now);
    if (pruned > 0) console.log(`[chat idle-reaper] pruned ${pruned} idle session(s)`);
  }, IDLE_REAPER_INTERVAL_MS);
  idleReaper.unref();

  return () => {
    clearInterval(idleReaper);
    server.off('upgrade', onUpgrade);
    shutdownAllSessions();
    shutdownAllCodexSessions();
    shutdownAllBananaSessions();
    wss.close();
  };
}
