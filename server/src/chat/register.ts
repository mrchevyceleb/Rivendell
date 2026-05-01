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

type ClientHello = { type: 'hello'; cli: CliKind; repo: string; sinceSeq?: number };
type ClientSend = { type: 'send'; text: string; images?: Array<{ mediaType: string; base64: string }> };
type ClientFresh = { type: 'freshStart'; cli: CliKind; repo: string };
type ClientStop = { type: 'stop'; cli: CliKind; repo: string };
type ClientSteer = { type: 'steer'; cli: CliKind; repo: string; text: string; images?: Array<{ mediaType: string; base64: string }> };
type ClientMsg = ClientHello | ClientSend | ClientFresh | ClientStop | ClientSteer;
type ResumeWatchableSession = AnySession & {
  startedWithResume?: () => boolean;
  waitForInitOrExit?: (timeoutMs: number) => Promise<'initialized' | 'closed' | 'timeout'>;
};

const IDLE_SESSION_TTL_MS = 30 * 60 * 1000;
const IDLE_REAPER_INTERVAL_MS = 60 * 1000;
const RESUME_STARTUP_WATCH_MS = 8000;

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
    const sessions = [...activeClaudeSessions(), ...activeCodexSessions()];
    res.json({
      sessions: sessions.map((session) => ({
        cli: session.cli,
        cwd: session.cwd,
        repoName: basename(session.cwd),
        busy: session.busy,
        sessionId: session.sessionId,
        lastActivityAt: session.lastActivityAt,
      })),
    });
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
    let turnGeneration = 0;

    const safeSend = (msg: object) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };

    const dispatch = (se: { seq: number; ev: any }) => {
      const sev = se.ev;
      if (sev.type === 'event') {
        safeSend({ type: 'stream', event: sev.event, seq: se.seq });
      } else if (sev.type === 'turnEnd') {
        busy = false;
        safeSend({ type: 'turnEnd', sessionId: sev.sessionId, seq: se.seq });
      } else if (sev.type === 'error') {
        safeSend({ type: 'error', message: sev.message, seq: se.seq });
      } else if (sev.type === 'closed') {
        safeSend({ type: 'sessionClosed', code: sev.code, seq: se.seq });
        // The CLI process is dead. Drop the stale promise + subscription so
        // the next send can rebind via getOrCreateSession, which resumes from
        // the saved session id when possible.
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
    ): Promise<boolean> => {
      if (!cliKind || !repoPath || cliKind === 'codex') return false;
      const watchable = session as ResumeWatchableSession;
      if (watchable.startedWithResume?.() !== true || !watchable.waitForInitOrExit) return false;

      const state = await watchable.waitForInitOrExit(RESUME_STARTUP_WATCH_MS);
      if (state !== 'closed') return false;
      if (generation !== turnGeneration) return false;

      console.log(`[chat ws#${wsId}] stale resume closed before init, retrying fresh`);
      try {
        const retrySession = await bindSession(getOrCreateSession({ cli: cliKind, repoPath }));
        busy = true;
        safeSend({ type: 'sessionRebound' });
        safeSend({ type: 'turnStart' });
        if ('send' in retrySession) (retrySession as any).send(text, images);
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
          const sinceSeq = typeof msg.sinceSeq === 'number' ? msg.sinceSeq : -1;
          console.log(`[chat ws#${wsId}] hello cli=${msg.cli} repo=${msg.repo} sinceSeq=${sinceSeq}`);
          const session = await bindSession(
            getOrCreateSession({ cli: msg.cli, repoPath: msg.repo }),
            sinceSeq,
          );
          const sessionBusy = (session as any).isBusy?.() === true;
          busy = sessionBusy;
          console.log(`[chat ws#${wsId}] session ready key=${session.key} latestSeq=${session.latestSeq()} busy=${sessionBusy}`);
          safeSend({ type: 'ready', cli: msg.cli, repo: msg.repo, latestSeq: session.latestSeq(), busy: sessionBusy });
          return;
        }

        if (msg.type === 'freshStart') {
          turnGeneration += 1;
          const session = await bindSession(freshStart({ cli: msg.cli, repoPath: msg.repo }));
          cliKind = msg.cli;
          repoPath = msg.repo;
          busy = false;
          safeSend({ type: 'freshStarted', cli: msg.cli, repo: msg.repo, latestSeq: session.latestSeq() });
          return;
        }

        if (msg.type === 'stop') {
          turnGeneration += 1;
          await interruptSession({ cli: msg.cli, repoPath: msg.repo });
          sessionPromise = null;
          unsubscribe?.();
          unsubscribe = null;
          busy = false;
          safeSend({ type: 'turnEnd' });
          return;
        }

        if (msg.type === 'steer') {
          turnGeneration += 1;
          await interruptSession({ cli: msg.cli, repoPath: msg.repo });
          const session = await bindSession(getOrCreateSession({ cli: msg.cli, repoPath: msg.repo }));
          cliKind = msg.cli;
          repoPath = msg.repo;
          busy = true;
          safeSend({ type: 'turnStart' });
          const generation = ++turnGeneration;
          await (session as any).send(msg.text, msg.images);
          void retryOnceAfterStaleResume(session, msg.text, generation, msg.images);
          return;
        }

        if (msg.type === 'send') {
          if (!sessionPromise && cliKind && repoPath) {
            await bindSession(getOrCreateSession({ cli: cliKind, repoPath }));
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
          const session = await sessionPromise;
          await (session as any).send(msg.text, msg.images);
          void retryOnceAfterStaleResume(session, msg.text, generation, msg.images);
        }
      } catch (error) {
        busy = false;
        safeSend({ type: 'error', message: (error as Error).message });
        safeSend({ type: 'turnEnd' });
      }
    });

    ws.on('close', () => {
      unsubscribe?.();
      unsubscribe = null;
      console.log(`[chat ws#${wsId}] close`);
    });
  });

  const idleReaper = setInterval(() => {
    const now = Date.now();
    const pruned = pruneIdleClaudeSessions(IDLE_SESSION_TTL_MS, now) + pruneIdleCodexSessions(IDLE_SESSION_TTL_MS, now);
    if (pruned > 0) console.log(`[chat idle-reaper] pruned ${pruned} idle session(s)`);
  }, IDLE_REAPER_INTERVAL_MS);
  idleReaper.unref();

  return () => {
    clearInterval(idleReaper);
    server.off('upgrade', onUpgrade);
    shutdownAllSessions();
    shutdownAllCodexSessions();
    wss.close();
  };
}
