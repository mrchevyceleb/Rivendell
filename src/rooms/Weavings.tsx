import { Eye, Play, Plus, RotateCcw, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiJson } from '../data/api';
import type { RivendellJob, RivendellJobStatus } from '../data/types';
import { useWeavings } from '../hooks/useRoomData';
import { useProxyViewer } from '../hooks/useProxyViewer';
import { Button, Chip } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import { timeAgo } from '../utils/format';

const statuses: RivendellJobStatus[] = ['queued', 'running', 'needs_review', 'done', 'failed', 'cancelled'];

const skills = [
  'draft-customer-reply',
  'draft-email',
  'pull-dashboard-data',
  'weekly-research',
  'triage-feedback-ticket',
  'dispatch-to-autofix-bot',
];

export function Weavings() {
  const { data: jobs = [], refetch } = useWeavings();
  const proxy = useProxyViewer();
  const [skill, setSkill] = useState(skills[0]);
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const grouped = useMemo(() => {
    return statuses.reduce<Record<RivendellJobStatus, RivendellJob[]>>((acc, status) => {
      acc[status] = jobs.filter((job) => job.status === status);
      return acc;
    }, {} as Record<RivendellJobStatus, RivendellJob[]>);
  }, [jobs]);

  const enqueue = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    try {
      await apiJson('/api/weavings/queue', {
        method: 'POST',
        body: JSON.stringify({ skill, prompt, source: 'manual' }),
      });
      setPrompt('');
      await refetch();
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async (id: string) => {
    await apiJson(`/api/weavings/queue/${encodeURIComponent(id)}/retry`, { method: 'POST' });
    await refetch();
  };

  const cancel = async (id: string) => {
    await apiJson(`/api/weavings/queue/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    await refetch();
  };

  return (
    <div className="room-scroll r-scroll">
      <RoomHeader
        eyebrow="The Weavings"
        title="Employee Kanban"
        subtitle="Queued, running, review, and completed work for the headless worker."
        actions={
          <Button tone="ghost" onClick={() => refetch()}>
            <RotateCcw size={15} />
            Refresh
          </Button>
        }
      />
      <section className="enqueue-panel">
        <select value={skill} onChange={(event) => setSkill(event.target.value)}>
          {skills.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the work to queue" />
        <Button tone="gold" onClick={enqueue} disabled={submitting || !prompt.trim()}>
          <Plus size={15} />
          Enqueue
        </Button>
      </section>
      <div className="weavings-board">
        {statuses.map((status) => (
          <section className="weaving-column" key={status}>
            <header>
              <h2>{status.replaceAll('_', ' ')}</h2>
              <code>{grouped[status]?.length ?? 0}</code>
            </header>
            <div className="stack-list">
              {(grouped[status] ?? []).map((job) => {
                const artifactId = jobArtifactId(job);
                const resultPreview = jobResultPreview(job);
                const onView = () => {
                  if (artifactId) {
                    proxy.open({ source: 'artifact', id: artifactId, title: jobTitle(job) });
                    return;
                  }
                  if (!resultPreview) return;
                  proxy.open({
                    source: 'inline',
                    title: jobTitle(job),
                    kind: resultPreview.kind,
                    content: resultPreview.content,
                  });
                };
                const canView = Boolean(artifactId || resultPreview);
                return (
                  <article className="job-card" key={job.id}>
                    <div className="job-card-head">
                      <Chip tone={status === 'failed' ? 'rose' : status === 'done' ? 'emerald' : status === 'running' ? 'elf' : 'gold'}>
                        {job.skill}
                      </Chip>
                      <code>{timeAgo(job.created_at)}</code>
                    </div>
                    <p>{job.prompt || job.source_ref || job.source || 'No prompt stored.'}</p>
                    {job.needs_review_reason ? <small>{job.needs_review_reason}</small> : null}
                    <div className="task-actions">
                      {canView ? (
                        <button type="button" onClick={onView} title="View the result in the in-app viewer">
                          <Eye size={13} />
                          View result
                        </button>
                      ) : null}
                      <button type="button" onClick={() => void retry(job.id)} disabled={job.id.startsWith('sam:')}>
                        <Play size={13} />
                        Retry
                      </button>
                      <button type="button" onClick={() => void cancel(job.id)} disabled={job.id.startsWith('sam:')}>
                        <XCircle size={13} />
                        Cancel
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function jobArtifactId(job: RivendellJob): string | null {
  if (!job.result || typeof job.result !== 'object') return null;
  const id = (job.result as Record<string, unknown>).artifactId;
  return typeof id === 'string' && id ? id : null;
}

function jobTitle(job: RivendellJob): string {
  const stem = (job.prompt || job.source_ref || job.skill || 'Job result').slice(0, 80);
  return `${job.skill} · ${stem}`;
}

function jobResultPreview(job: RivendellJob): { kind: 'html' | 'markdown' | 'text'; content: string } | null {
  if (job.result == null) return null;
  if (typeof job.result === 'string') {
    if (job.result.trim() === '') return null;
    const looksHtml = /<\/?\w+[\s>]/.test(job.result);
    return { kind: looksHtml ? 'html' : 'text', content: job.result };
  }
  if (typeof job.result === 'object') {
    const r = job.result as Record<string, unknown>;
    const output = typeof r.output === 'string' ? r.output : null;
    const summary = typeof r.summary === 'string' ? r.summary : null;
    const html = typeof r.html === 'string' ? r.html : null;
    const markdown = typeof r.markdown === 'string' ? r.markdown : null;
    if (html) return { kind: 'html', content: html };
    if (markdown) return { kind: 'markdown', content: markdown };
    if (output) return { kind: 'text', content: output };
    if (summary) return { kind: 'text', content: summary };
    return { kind: 'text', content: JSON.stringify(job.result, null, 2) };
  }
  return null;
}
