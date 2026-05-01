import { WORKER_ENABLED, WORKER_POLL_MS } from '../config.ts';
import { emitScribe } from './scribe.ts';
import { nextQueuedJob, updateJob } from './store.ts';
import { runJob } from './runner.ts';

let timer: NodeJS.Timeout | null = null;
let busy = false;

export function startWorkerQueue(): void {
  if (!WORKER_ENABLED) {
    void emitScribe({ level: 'system', text: 'worker disabled by RIVENDELL_WORKER_ENABLED=false' });
    return;
  }

  void emitScribe({ level: 'system', text: `worker queue polling every ${WORKER_POLL_MS}ms` });
  timer = setInterval(() => void pollOnce(), WORKER_POLL_MS);
  timer.unref();
  void pollOnce();
}

export function stopWorkerQueue(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function pollOnce(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const job = await nextQueuedJob();
    if (!job) return;

    await updateJob(job.id, { status: 'running' });
    await emitScribe({ job_id: job.id, level: 'system', text: `started ${job.skill}` });

    try {
      const result = await runJob(job);
      const status = result.status ?? 'done';
      await updateJob(job.id, {
        status,
        result: result.result,
        needs_review_reason: result.needs_review_reason,
        completed_at: status === 'done' ? new Date().toISOString() : undefined,
      });
      await emitScribe({ job_id: job.id, level: 'note', text: `${job.skill} moved to ${status}` });
    } catch (error) {
      await updateJob(job.id, { status: 'failed', error: (error as Error).message, completed_at: new Date().toISOString() });
      await emitScribe({ job_id: job.id, level: 'error', text: `${job.skill} failed: ${(error as Error).message}` });
    }
  } finally {
    busy = false;
  }
}
