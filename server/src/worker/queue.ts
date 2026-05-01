import { WORKER_ENABLED, WORKER_POLL_MS } from '../config.ts';
import { createArtifact, type ArtifactKind } from '../lib/artifactStore.ts';
import { rewriteAbsolutePaths } from '../lib/proxyLinks.ts';
import { emitScribe } from './scribe.ts';
import { nextQueuedJob, updateJob } from './store.ts';
import { runJob } from './runner.ts';
import type { RivendellJob } from '../data/mock.ts';

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

// Anything below this length is treated as a status line, not a renderable
// artifact. Keeps the artifact store from filling up with one-line summaries.
const ARTIFACT_MIN_BYTES = 400;

async function maybeRegisterArtifact(job: RivendellJob, raw: unknown): Promise<unknown> {
  const candidate = pickArtifactCandidate(raw);
  if (!candidate) return raw;

  if (Buffer.byteLength(candidate.content, 'utf8') < ARTIFACT_MIN_BYTES) {
    return raw;
  }

  const { text } = rewriteAbsolutePaths(candidate.content);
  try {
    const record = await createArtifact({
      kind: candidate.kind,
      title: artifactTitle(job, candidate.kind),
      content: text,
      source: { kind: 'job', ref: job.id },
    });
    return embedArtifactId(raw, record.id);
  } catch (error) {
    void emitScribe({
      job_id: job.id,
      level: 'error',
      text: `artifact registration failed: ${(error as Error).message}`,
    });
    return raw;
  }
}

// Embed the artifactId inside the existing `result` jsonb column rather than
// adding a top-level field, so this works against the existing Supabase
// schema (rivendell_jobs has no artifactId column). Clients read
// (job.result as any)?.artifactId to surface the View result button.
function embedArtifactId(raw: unknown, artifactId: string): unknown {
  if (raw == null) return { artifactId };
  if (typeof raw === 'string') return { output: raw, artifactId };
  if (typeof raw !== 'object') return { value: raw, artifactId };
  return { ...(raw as Record<string, unknown>), artifactId };
}

function pickArtifactCandidate(
  raw: unknown,
): { kind: ArtifactKind; content: string } | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    return { kind: detectKind(raw), content: raw };
  }
  if (typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.html === 'string' && r.html.trim()) return { kind: 'html', content: r.html };
  if (typeof r.markdown === 'string' && r.markdown.trim()) return { kind: 'markdown', content: r.markdown };
  if (typeof r.output === 'string' && r.output.trim()) return { kind: detectKind(r.output), content: r.output };
  if (typeof r.text === 'string' && r.text.trim()) return { kind: 'text', content: r.text };
  return null;
}

function detectKind(content: string): ArtifactKind {
  if (/<\/?\w+[\s>]/.test(content) && /<(html|body|div|p|h\d|table|article|section)\b/i.test(content)) {
    return 'html';
  }
  if (/(^|\n)#\s|\*\*|^- /m.test(content)) return 'markdown';
  return 'text';
}

function artifactTitle(job: RivendellJob, kind: ArtifactKind): string {
  const stem = (job.prompt || job.source_ref || job.skill).split('\n')[0].slice(0, 80).trim();
  return stem ? `${job.skill}: ${stem}` : `${job.skill} (${kind})`;
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
      const cleanedResult = await maybeRegisterArtifact(job, result.result);
      await updateJob(job.id, {
        status,
        result: cleanedResult,
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
