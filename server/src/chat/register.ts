import type express from 'express';
import type { Server } from 'node:http';
import { basename } from 'node:path';
import { WebSocketServer } from 'ws';
import { discoverRepos } from './repos.ts';
import { readChronicle } from './chronicle.ts';
import { readCommands } from './commands.ts';
import { ensureStateDir } from './sessions.ts';
import {
  activeClaudeSessions,
  freshStart,
  getOrCreateSession,
  interruptSession,
  pruneIdleClaudeSessions,
  shutdownAllSessions,
  type AnySession,
  type CliKind,
} from './runner.ts';
import {
  activeCodexSessions,
  pruneIdleCodexSessions,
  shutdownAllCodexSessions,
} from './codex-runner.ts';
import {
  activeBananaSessions,
  pruneIdleBananaSessions,
  shutdownAllBananaSessions,
} from './banana-runner.ts';
import { emitScribe } from '../worker/scribe.ts';

type ClientHello = { type: 'hello'; cli: CliKind; repo: string; chatId?: string; sinceSeq?: number };
// `model` is the Banana model id (e.g. `monkey/silverback`). It rides on every
// send/steer and is forwarded into BananaSession.send. Elrond and Codex ignore it.
type ClientSend = { type: 'send'; chatId?: string; text: string; images?: Array<{ mediaType: string; base64: string }>; model?: string };
type ClientFresh = { type: 'freshStart'; cli: CliKind; repo: string; chatId?: string };
type ClientStop = { type: 'stop'; cli: CliKind; repo: string; chatId?: string };
type ClientSteer = { type: 'steer'; cli: CliKind; repo: string; chatId?: string; text: string; images?: Array<{ mediaType: string; base64: string }>; model?: string };
type ClientMsg = ClientHello | ClientSend | ClientFresh | ClientStop | ClientSteer;
type ResumeWatchableSession = AnySession & {
  startedWithResume?: () => boolean;
  waitForInitOrExit?: (timeoutMs: number) => Promise<'initialized' | 'closed' | 'timeout'>;
};

const IDLE_SESSION_TTL_MS = 30 * 60 * 1000;
const IDLE_REAPER_INTERVAL_MS = 60 * 1000;
const RESUME_STARTUP_WATCH_MS = 8000;
const DEFAULT_CHAT_ID = 'main';
// Mobile networks (especially Android backgrounded tabs) silently drop WS
// connections without firing onclose on either side. Server-side ping every
// 25s, terminate after one missed pong, so the client's reconcile path can
// reopen instead of leaving the user staring at a dead socket.
const WS_PING_INTERVAL_MS = 25 * 1000;

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
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return safe || DEFAULT_CHAT_ID;
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

  app.post('/api/chat/interrupt', async (req, res) => {
    const body = req.body as Partial<{ cli: CliKind; repo: string; chatId: string }>;
    const cli = body.cli;
    if (cli !== 'assistant' && cli !== 'claude' && cli !== 'codex' && cli !== 'banana') {
      res.status(400).json({ error: 'invalid cli' });
      return;
    }
    if (typeof body.repo !== 'string' || !body.repo.trim()) {
      res.status(400).json({ error: 'invalid repo' });
      return;
    }
    const chatId = normalizeChatId(body.chatId);
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

  app.get('/api/commands', async (_req, res) => {
    try {
      res.json(await readCommands());
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  let wsCounter = 0;

  const onUpgrade = (req: import('node:http').IncomingMessage, socket: import('node:net').Socket, head: Buffer) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path !== '/api/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  };
  server.on('upgrade', onUpgrade);

  wss.on('connection', (ws, req) => {
    const wsId = ++wsCounter;
    const peer = (req.headers['x-forwarded-for'] as string | undefined) ?? req.socket.remoteAddress ?? '?';
    console.log(`[chat ws#${wsId}] open from ${peer}`);

    let sessionPromise: Promise<AnySession> | null = null;
    let unsubscribe: (() => void) | null = null;
    let busy = false;
    let cliKind: CliKind | null = null;
    let repoPath: string | null = null;
    let chatId = DEFAULT_CHAT_ID;
    let turnGeneration = 0;

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

    const detachCurrentSession = () => {
      sessionPromise = null;
      busy = false;
      unsubscribe?.();
      unsubscribe = null;
    };

    const dispatch = (se: { seq: number; ev: any }) => {
      const sev = se.ev;
      if (sev.type === 'event') {
        safeSend({ type: 'stream', event: sev.event, seq: se.seq });
      } else if (sev.type === 'turnEnd') {
        busy = false;
        safeSend({ type: 'turnEnd', sessionId: sev.sessionId, seq: se.seq });
      } else if (sev.type === 'error') {
        // Only surface stderr/spawn errors during an active turn. Idle CLI
        // chatter (death-rattle warnings, harmless deprecation notices) used
        // to flash a red banner in the chat for no good reason.
        if (busy) {
          safeSend({ type: 'error', message: sev.message, seq: se.seq });
        } else {
          console.log(`[chat ws#${wsId}] swallowed idle stderr: ${String(sev.message).slice(0, 200)}`);
        }
      } else if (sev.type === 'closed') {
        // The CLI process is dead. Drop the stale promise + subscription so
        // the next send can rebind via getOrCreateSession, which resumes from
        // the saved session id when possible.
        if (busy) {
          // Mid-turn death is a real failure — tell the client.
          safeSend({ type: 'sessionClosed', code: sev.code, seq: se.seq });
        } else {
          // Idle exit: swallow it. Next `send` will respawn transparently.
          console.log(`[chat ws#${wsId}] swallowed idle session close (code=${sev.code})`);
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
      unsubscribe = session.subscribe(dispatch, sinceSeq);
      return session;
    };

    const retryOnceAfterStaleResume = async (
      session: AnySession,
      text: string,
      generation: number,
      images?: Array<{ mediaType: string; base64: string }>,
      model?: string,
    ): Promise<boolean> => {
      if (!cliKind || !repoPath || cliKind === 'codex') return false;
      const watchable = session as ResumeWatchableSession;
      if (watchable.startedWithResume?.() !== true || !watchable.waitForInitOrExit) return false;

      const state = await watchable.waitForInitOrExit(RESUME_STARTUP_WATCH_MS);
      if (state !== 'closed') return false;
      if (generation !== turnGeneration) return false;

      console.log(`[chat ws#${wsId}] stale resume closed before init, retrying fresh`);
      try {
        const retrySession = await bindSession(getOrCreateSession({ cli: cliKind, repoPath, chatId }));
        busy = true;
        safeSend({ type: 'sessionRebound' });
        safeSend({ type: 'turnStart' });
        if ('send' in retrySession) (retrySession as any).send(text, images, { model });
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
          console.log(`[chat ws#${wsId}] hello cli=${msg.cli} repo=${msg.repo} chatId=${chatId} sinceSeq=${sinceSeq}`);
          const session = await bindSession(
            getOrCreateSession({ cli: msg.cli, repoPath: msg.repo, chatId }),
            sinceSeq,
          );
          const sessionBusy = (session as any).isBusy?.() === true;
          busy = sessionBusy;
          console.log(`[chat ws#${wsId}] session ready key=${session.key} latestSeq=${session.latestSeq()} busy=${sessionBusy}`);
          safeSend({ type: 'ready', cli: msg.cli, repo: msg.repo, chatId, latestSeq: session.latestSeq(), busy: sessionBusy });
          return;
        }

        if (msg.type === 'freshStart') {
          turnGeneration += 1;
          chatId = normalizeChatId(msg.chatId);
          detachCurrentSession();
          const session = await bindSession(freshStart({ cli: msg.cli, repoPath: msg.repo, chatId }));
          cliKind = msg.cli;
          repoPath = msg.repo;
          busy = false;
          safeSend({ type: 'freshStarted', cli: msg.cli, repo: msg.repo, chatId, latestSeq: session.latestSeq() });
          return;
        }

        if (msg.type === 'stop') {
          turnGeneration += 1;
          chatId = normalizeChatId(msg.chatId);
          detachCurrentSession();
          await interruptSession({ cli: msg.cli, repoPath: msg.repo, chatId });
          safeSend({ type: 'turnEnd' });
          return;
        }

        if (msg.type === 'steer') {
          turnGeneration += 1;
          chatId = normalizeChatId(msg.chatId);
          detachCurrentSession();
          await interruptSession({ cli: msg.cli, repoPath: msg.repo, chatId });
          const session = await bindSession(getOrCreateSession({ cli: msg.cli, repoPath: msg.repo, chatId }));
          cliKind = msg.cli;
          repoPath = msg.repo;
          busy = true;
          safeSend({ type: 'turnStart' });
          logChatTurn(wsId, 'steer', msg.cli, msg.repo, chatId, msg.text);
          const generation = ++turnGeneration;
          await (session as any).send(msg.text, msg.images, { model: msg.model });
          void retryOnceAfterStaleResume(session, msg.text, generation, msg.images, msg.model);
          return;
        }

        if (msg.type === 'send') {
          const requestedChatId = normalizeChatId(msg.chatId ?? chatId);
          if (requestedChatId !== chatId) {
            safeSend({ type: 'error', message: 'chat tab changed - reconnect before sending' });
            return;
          }
          if (!sessionPromise && cliKind && repoPath) {
            await bindSession(getOrCreateSession({ cli: cliKind, repoPath, chatId }));
          }
          if (!sessionPromise) {
            safeSend({ type: 'error', message: 'no session - send hello first' });
            return;
          }
          if (busy && cliKind === 'codex') {
            safeSend({ type: 'error', message: 'codex is on a turn - wait for the result' });
            return;
          }
          const generation = ++turnGeneration;
          if (!busy) {
            busy = true;
            safeSend({ type: 'turnStart' });
          }
          let session: AnySession | null = await sessionPromise;
          if (!session && cliKind && repoPath) {
            // sessionPromise resolved to a dead/null session — rebind a fresh
            // one rather than crashing on `null.send`.
            session = await bindSession(getOrCreateSession({ cli: cliKind, repoPath, chatId }));
          }
          if (!session) throw new Error('session unavailable, please retry');
          logChatTurn(wsId, 'send', cliKind, repoPath, chatId, msg.text);
          await (session as any).send(msg.text, msg.images, { model: msg.model });
          void retryOnceAfterStaleResume(session, msg.text, generation, msg.images, msg.model);
        }
      } catch (error) {
        busy = false;
        safeSend({ type: 'error', message: (error as Error).message });
        safeSend({ type: 'turnEnd' });
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe?.();
      unsubscribe = null;
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
