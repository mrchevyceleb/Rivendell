import { Router } from 'express';
import { fetchAdminQueueJobs } from '../lib/assistantData.ts';
import { emitScribe } from '../worker/scribe.ts';
import { enqueueJob, listJobs, updateJob } from '../worker/store.ts';
import { asyncHandler } from './helpers.ts';

export const weavingsRouter = Router();

weavingsRouter.get('/queue', asyncHandler(async (_req, res) => {
  const local = await listJobs();
  try {
    const remote = await fetchAdminQueueJobs();
    res.json([...remote, ...local]);
  } catch {
    res.json(local);
  }
}));

weavingsRouter.post('/queue', asyncHandler(async (req, res) => {
  const skill = String(req.body?.skill || '').trim();
  if (!skill) {
    res.status(400).json({ error: 'skill is required' });
    return;
  }
  const job = await enqueueJob({
    skill,
    source: req.body.source || 'manual',
    source_ref: req.body.source_ref,
    repo: req.body.repo,
    prompt: req.body.prompt,
  });
  await emitScribe({ job_id: job.id, level: 'system', text: `queued ${job.skill}` });
  res.status(201).json(job);
}));

weavingsRouter.post('/queue/:id/cancel', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  await updateJob(id, { status: 'cancelled', completed_at: new Date().toISOString() });
  await emitScribe({ job_id: id, level: 'note', text: 'job cancelled' });
  res.json({ ok: true });
}));

weavingsRouter.post('/queue/:id/retry', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  await updateJob(id, { status: 'queued', error: undefined, completed_at: undefined });
  await emitScribe({ job_id: id, level: 'system', text: 'job queued for retry' });
  res.json({ ok: true });
}));
