import { Router } from 'express';
import {
  createAdminCronJob,
  deleteAdminCronJob,
  fetchAdminCronJobs,
  runAdminCronJob,
  updateAdminCronJob,
} from '../lib/assistantData.ts';
import { cronStore } from '../lib/roomStores.ts';
import { emitScribe } from '../worker/scribe.ts';
import { enqueueJob } from '../worker/store.ts';
import { asyncHandler } from './helpers.ts';

export const cronRouter = Router();

cronRouter.get('/', asyncHandler(async (_req, res) => {
  try {
    res.json(await fetchAdminCronJobs());
  } catch {
    res.json(await cronStore.list());
  }
}));

cronRouter.post('/', asyncHandler(async (req, res) => {
  try {
    const job = await createAdminCronJob(req.body);
    res.status(201).json(job);
  } catch {
    const job = await cronStore.create({
      name: req.body.name || 'New schedule',
      description: req.body.description || '',
      schedule: req.body.schedule || 'manual',
      target: req.body.toolName || req.body.target || req.body.actionType || 'ai_prompt',
      actionType: req.body.actionType || 'ai_prompt',
      prompt: req.body.prompt || '',
      toolName: req.body.toolName || '',
      deliveryChannel: req.body.deliveryChannel || 'log_only',
      maxTokens: Number(req.body.maxTokens) || 1024,
      status: req.body.status || 'paused',
      lastRun: 'never',
      lastRunAt: null,
      lastRunStatus: null,
    });
    res.status(201).json(job);
  }
}));

cronRouter.post('/:id/run-now', asyncHandler(async (req, res) => {
  try {
    await runAdminCronJob(String(req.params.id));
    await emitScribe({ level: 'system', text: `manual cron run requested: ${req.params.id}` });
    res.status(202).json({ ok: true });
    return;
  } catch {
    // Fall through to the local dry-run queue if the admin API is unavailable.
  }
  const jobs = await cronStore.list();
  const job = jobs.find((item) => item.id === req.params.id);
  if (!job) {
    res.status(404).json({ error: 'cron job not found' });
    return;
  }
  const queued = await enqueueJob({
    skill: job.target,
    source: 'cron-manual',
    source_ref: job.id,
    prompt: `Manual run of ${job.name} (${job.schedule}).`,
  });
  const updated = await cronStore.update(job.id, { lastRun: 'queued now' } as any);
  await emitScribe({ job_id: queued.id, level: 'system', text: `manual cron run queued: ${job.name}` });
  res.status(202).json(updated);
}));

cronRouter.patch('/:id', asyncHandler(async (req, res) => {
  let job: unknown;
  try {
    job = await updateAdminCronJob(String(req.params.id), req.body);
  } catch {
    job = await cronStore.update(String(req.params.id), req.body);
  }
  if (!job) {
    res.status(404).json({ error: 'cron job not found' });
    return;
  }
  res.json(job);
}));

cronRouter.delete('/:id', asyncHandler(async (req, res) => {
  try {
    await deleteAdminCronJob(String(req.params.id));
  } catch {
    const deleted = await cronStore.delete(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'cron job not found' });
      return;
    }
  }
  res.status(204).end();
}));
