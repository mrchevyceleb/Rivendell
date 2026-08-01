import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOST, PORT, STATIC_DIR, WORKER_RUNNER } from './config.ts';
import { registerChat } from './chat/register.ts';
import { ensureXaiProxy, shutdownXaiProxy } from './chat/xai-proxy.ts';
import { registerScribeSocket } from './worker/scribe.ts';
import { startWorkerQueue, stopWorkerQueue } from './worker/queue.ts';
import { startWorkspaceWatcher, stopWorkspaceWatcher } from './lib/workspaceWatcher.ts';
import { tasksRouter } from './routes/tasks.ts';
import { calendarRouter } from './routes/calendar.ts';
import { emailRouter } from './routes/email.ts';
import { familyRouter } from './routes/family.ts';
import { docsRouter } from './routes/docs.ts';
import { plRouter } from './routes/pl.ts';
import { cronRouter } from './routes/cron.ts';
import { messagesRouter } from './routes/messages.ts';
import { pinsRouter } from './routes/pins.ts';
import { weavingsRouter } from './routes/weavings.ts';
import { scribeRouter } from './routes/scribe.ts';
import { summaryRouter } from './routes/summary.ts';
import { artifactsRouter } from './routes/artifacts.ts';
import { mcpRouter } from './routes/mcp.ts';
import { filesRouter } from './routes/files.ts';
import { jarvisRouter } from './routes/jarvis.ts';
import { internalRouter } from './routes/internal.ts';
import { xaiOauthRouter } from './routes/xai-oauth.ts';
import { primeXaiOauthToken } from './chat/runner.ts';

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'rivendell',
    port: PORT,
    workerRunner: WORKER_RUNNER,
    ts: Date.now(),
  });
});

app.use('/api/summary', summaryRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/email', emailRouter);
app.use('/api/family', familyRouter);
app.use('/api/docs', docsRouter);
app.use('/api/pl', plRouter);
app.use('/api/pins', pinsRouter);
app.use('/api/cron', cronRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/weavings', weavingsRouter);
app.use('/api/scribe', scribeRouter);
app.use('/api/artifacts', artifactsRouter);
app.use('/api/mcp', mcpRouter);
app.use('/api/files', filesRouter);
app.use('/api/jarvis', jarvisRouter);
// Localhost-only headless runner (cron agentic loop). Gated by MCP_AUTH_TOKEN.
app.use('/internal', internalRouter);

// xAI SuperGrok OAuth login page (browser, one-time). Mounted before the SPA
// fallback so GET /xai-oauth serves the connector instead of index.html.
app.use('/xai-oauth', xaiOauthRouter);

const server = createServer(app);
// Start the xAI transform proxy before chat registers so its base URL is
// resolved before any xAI chat session can spawn. Non-fatal: a failure logs
// and xAI turns surface a clear error instead of crashing the server.
try {
  await ensureXaiProxy();
} catch (err) {
  console.warn(`[rivendell] xAI proxy failed to start: ${(err as Error).message}`);
}
// Prime the SuperGrok OAuth token (refresh now if near expiry, then background
// refresh every 30m) so xAI chat turns use the subscription, not API credits.
await primeXaiOauthToken();
const stopChat = await registerChat(app, server);
registerScribeSocket(server);
startWorkerQueue();
startWorkspaceWatcher();

if (existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(resolve(STATIC_DIR, 'index.html'));
  });
}

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: error.message });
});

server.listen(PORT, HOST, () => {
  console.log(`rivendell listening on http://${HOST}:${PORT}`);
});

const tearDown = (signal: NodeJS.Signals) => {
  console.warn(`[rivendell] received ${signal}, shutting down (pid=${process.pid}, uptime=${Math.round(process.uptime())}s)`);
  stopWorkerQueue();
  stopWorkspaceWatcher();
  stopChat();
  shutdownXaiProxy();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};

process.on('SIGINT', () => tearDown('SIGINT'));
process.on('SIGTERM', () => tearDown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[rivendell] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[rivendell] unhandledRejection:', reason);
});
