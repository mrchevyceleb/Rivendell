import { Router } from 'express';
import {
  createAdminCronJob,
  deleteAdminCronJob,
  fetchAdminCronJobs,
  runAdminCronJob,
  updateAdminCronJob,
} from '../lib/assistantData.ts';
import { emitScribe } from '../worker/scribe.ts';
import { asyncHandler } from './helpers.ts';

export const cronRouter = Router();

cronRouter.get('/', asyncHandler(async (_req, res) => {
  try {
    res.json(await fetchAdminCronJobs());
  } catch (err: any) {
    res.status(502).json({ error: `cron upstream failed: ${err?.message || 'unknown error'}` });
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
  try {
    await runAdminCronJob(String(req.params.id));
    await emitScribe({ level: 'system', text: `manual cron run requested: ${req.params.id}` });
    res.status(202).json({ ok: true });
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
