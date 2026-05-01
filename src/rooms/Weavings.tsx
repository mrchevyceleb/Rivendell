import { Play, Plus, RotateCcw, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiJson } from '../data/api';
import type { RivendellJob, RivendellJobStatus } from '../data/types';
import { useWeavings } from '../hooks/useRoomData';
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
              {(grouped[status] ?? []).map((job) => (
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
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
