import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOST, PORT, STATIC_DIR, WORKER_RUNNER } from './config.ts';
import { registerChat } from './chat/register.ts';
import { registerScribeSocket } from './worker/scribe.ts';
import { startWorkerQueue, stopWorkerQueue } from './worker/queue.ts';
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

const server = createServer(app);
const stopChat = await registerChat(app, server);
registerScribeSocket(server);
startWorkerQueue();

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

const tearDown = () => {
  stopWorkerQueue();
  stopChat();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};

process.on('SIGINT', tearDown);
process.on('SIGTERM', tearDown);
