import { Router } from 'express';
import {
  createAdminCronJob,
  deleteAdminCronJob,
  fetchAdminCronJobs,
  fetchAdminCronHistory,
  runAdminCronJob,
  updateAdminCronJob,
} from '../lib/assistantData.ts';
import { emitScribe } from '../worker/scribe.ts';
import { asyncHandler } from './helpers.ts';
import { CRON_LOCAL_TRIGGER_URL } from '../config.ts';

export const cronRouter = Router();

cronRouter.get('/', asyncHandler(async (_req, res) => {
  try {
    res.json(await fetchAdminCronJobs());
  } catch (err: any) {
    res.status(502).json({ error: `cron upstream failed: ${err?.message || 'unknown error'}` });
  }
}));

// Execution history for a job. runtime=local jobs run on the local cron runner
// but still log every execution to `scheduled_jobs`, so this works for both
// runtimes. Read-only proxy to assistant-mcp /admin/api/cron/jobs/:id/history.
cronRouter.get('/:id/history', asyncHandler(async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string || '15', 10) || 15, 1), 50);
    res.json({ runs: await fetchAdminCronHistory(String(req.params.id), limit) });
  } catch (err: any) {
    res.status(502).json({ error: `cron history failed: ${err?.message || 'unknown error'}` });
  }
}));

cronRouter.post('/', asyncHandler(async (req, res) => {
  try {
    const job = await createAdminCronJob(req.body);
    res.status(201).json(job);
  } catch (err: any) {
    res.status(502).json({ error: `cron create failed: ${err?.message || 'unknown error'}` });
  }
}));

cronRouter.post('/:id/run-now', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  try {
    // runtime=local jobs can only be triggered on the local runner; the Railway
    // server refuses them ("runtime is local but this process is railway").
    // Look up the job's runtime and route accordingly.
    let runtime = 'railway';
    try {
      const jobs = await fetchAdminCronJobs();
      const job = jobs.find((j) => j.id === id);
      if (job?.runtime) runtime = job.runtime;
    } catch {
      // Lookup failed — fall back to the Railway proxy below.
    }

    if (runtime === 'local') {
      const resp = await fetch(`${CRON_LOCAL_TRIGGER_URL}/run/${encodeURIComponent(id)}`, {
        method: 'POST',
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`local runner ${resp.status}: ${body.slice(0, 200)}`);
      }
    } else {
      await runAdminCronJob(id);
    }

    await emitScribe({ level: 'system', text: `manual cron run requested: ${id} (${runtime})` });
    res.status(202).json({ ok: true, runtime });
  } catch (err: any) {
    res.status(502).json({ error: `cron run failed: ${err?.message || 'unknown error'}` });
  }
}));

cronRouter.patch('/:id', asyncHandler(async (req, res) => {
  try {
    const job = await updateAdminCronJob(String(req.params.id), req.body);
    if (!job) {
      res.status(404).json({ error: 'cron job not found' });
      return;
    }
    res.json(job);
  } catch (err: any) {
    res.status(502).json({ error: `cron update failed: ${err?.message || 'unknown error'}` });
  }
}));

cronRouter.delete('/:id', asyncHandler(async (req, res) => {
  try {
    await deleteAdminCronJob(String(req.params.id));
    res.status(204).end();
  } catch (err: any) {
    res.status(502).json({ error: `cron delete failed: ${err?.message || 'unknown error'}` });
  }
}));
