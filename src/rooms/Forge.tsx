import {
  CalendarClock,
  Check,
  Clock3,
  Pencil,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiJson } from '../data/api';
import type { CronJob } from '../data/types';
import { Button, Chip, EmptyState, Metric, Surface } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import { useCronJobs } from '../hooks/useRoomData';
import { timeAgo } from '../utils/format';

type CronDraft = {
  name: string;
  description: string;
  schedule: string;
  actionType: string;
  prompt: string;
  toolName: string;
  deliveryChannel: string;
  maxTokens: number;
  status: CronJob['status'];
};

const emptyDraft: CronDraft = {
  name: '',
  description: '',
  schedule: '0 9 * * *',
  actionType: 'ai_prompt',
  prompt: '',
  toolName: '',
  deliveryChannel: 'log_only',
  maxTokens: 1024,
  status: 'paused',
};

const schedulePresets = [
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily 6 AM', value: '0 6 * * *' },
  { label: 'Weekdays 9 AM', value: '0 9 * * 1-5' },
  { label: 'Mon/Fri 7 AM', value: '0 7 * * 1,5' },
];

export function Forge() {
  const { data: jobs = [], refetch } = useCronJobs();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CronDraft>(emptyDraft);
  const [busyId, setBusyId] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (!jobs.length) return null;
    return jobs.find((job) => job.id === selectedId) ?? jobs[0];
  }, [jobs, selectedId]);

  const isCreating = editingId === 'new';
  const editing = isCreating ? null : jobs.find((job) => job.id === editingId) ?? null;
  const activeCount = jobs.filter((job) => job.status === 'active').length;
  const pausedCount = jobs.filter((job) => job.status === 'paused').length;
  const failedCount = jobs.filter((job) => job.status === 'failed').length;

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['cron'] });
  };

  const startCreate = () => {
    setDraft(emptyDraft);
    setEditingId('new');
    setSelectedId(null);
  };

  const startEdit = (job: CronJob) => {
    setDraft(draftFromJob(job));
    setEditingId(job.id);
    setSelectedId(job.id);
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraft(emptyDraft);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    const payload = normalizeDraft(draft);
    const saved = await apiJson<CronJob>(isCreating ? '/api/cron' : `/api/cron/${encodeURIComponent(editingId || '')}`, {
      method: isCreating ? 'POST' : 'PATCH',
      body: JSON.stringify(payload),
    });
    setSelectedId(saved.id);
    closeEditor();
    await invalidate();
  };

  const toggle = async (job: CronJob) => {
    setBusyId(job.id);
    try {
      await apiJson<CronJob>(`/api/cron/${encodeURIComponent(job.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: job.status === 'active' ? 'paused' : 'active' }),
      });
      await invalidate();
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (job: CronJob) => {
    setBusyId(job.id);
    try {
      await apiJson(`/api/cron/${encodeURIComponent(job.id)}/run-now`, { method: 'POST' });
      await invalidate();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (job: CronJob) => {
    if (!window.confirm(`Delete "${job.name}"?`)) return;
    setBusyId(job.id);
    try {
      await apiJson<void>(`/api/cron/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      if (selectedId === job.id) setSelectedId(null);
      if (editingId === job.id) closeEditor();
      await invalidate();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="room-scroll r-scroll forge-room">
      <RoomHeader
        eyebrow="The Forge"
        title="Cron jobs"
        subtitle={`${jobs.length} schedules · ${activeCount} active · ${pausedCount} paused${failedCount ? ` · ${failedCount} failed` : ''}.`}
        actions={
          <>
            <Button tone="ghost" onClick={() => refetch()}>
              <RotateCcw size={15} />
              Refresh
            </Button>
            <Button tone="gold" onClick={startCreate}>
              <Plus size={15} />
              New cron job
            </Button>
          </>
        }
      />

      <div className="forge-summary">
        <Metric label="Active" value={activeCount} tone="emerald" />
        <Metric label="Paused" value={pausedCount} tone="gold" />
        <Metric label="Failed" value={failedCount} tone="rose" />
      </div>

      <div className="forge-studio">
        <section className="cron-list-panel">
          <div className="section-head">
            <div>
              <p className="r-eyebrow-gold">Schedules</p>
              <h2>Existing jobs</h2>
            </div>
            <span>{jobs.length}</span>
          </div>
          <div className="cron-card-list">
            {jobs.length ? (
              jobs.map((job) => (
                <article
                  className={`cron-card status-${job.status} ${selected?.id === job.id ? 'is-selected' : ''}`}
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                >
                  <div className="cron-card-main">
                    <span className={`status-pin status-${job.status}`} />
                    <div>
                      <h3>{job.name}</h3>
                      <p>{job.description || job.prompt || 'No description yet.'}</p>
                    </div>
                  </div>
                  <div className="cron-card-meta">
                    <Chip tone={job.status === 'active' ? 'emerald' : job.status === 'failed' ? 'rose' : 'neutral'}>
                      {job.status}
                    </Chip>
                    <span>
                      <CalendarClock size={13} />
                      {job.schedule}
                    </span>
                    <span>
                      <Clock3 size={13} />
                      {job.lastRun}
                    </span>
                  </div>
                  <div className="cron-card-actions" onClick={(event) => event.stopPropagation()}>
                    <button type="button" onClick={() => runNow(job)} disabled={busyId === job.id} title="Run now">
                      <Play size={14} />
                    </button>
                    <button type="button" onClick={() => toggle(job)} disabled={busyId === job.id} title={job.status === 'active' ? 'Pause' : 'Resume'}>
                      {job.status === 'active' ? <Pause size={14} /> : <Check size={14} />}
                    </button>
                    <button type="button" onClick={() => startEdit(job)} title="Edit">
                      <Pencil size={14} />
                    </button>
                    <button type="button" onClick={() => remove(job)} disabled={busyId === job.id} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <EmptyState title="No cron jobs yet" body="Create a schedule to have Elrond run recurring work." />
            )}
          </div>
        </section>

        <aside className="cron-detail-panel">
          {editingId ? (
            <form className="cron-editor" onSubmit={save}>
              <div className="section-head">
                <div>
                  <p className="r-eyebrow-gold">{isCreating ? 'New schedule' : 'Edit schedule'}</p>
                  <h2>{isCreating ? 'Create cron job' : editing?.name}</h2>
                </div>
                <button type="button" onClick={closeEditor} title="Close editor">
                  <X size={16} />
                </button>
              </div>

              <div className="cron-form-grid">
                <label>
                  Name
                  <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Morning brief" autoFocus />
                </label>
                <label>
                  Cron expression
                  <input value={draft.schedule} onChange={(event) => setDraft({ ...draft, schedule: event.target.value })} placeholder="0 9 * * *" />
                </label>
                <label>
                  Action type
                  <input value={draft.actionType} onChange={(event) => setDraft({ ...draft, actionType: event.target.value })} placeholder="ai_prompt" />
                </label>
                <label>
                  Tool name
                  <input value={draft.toolName} onChange={(event) => setDraft({ ...draft, toolName: event.target.value })} placeholder="Optional MCP tool" />
                </label>
                <label>
                  Delivery
                  <input value={draft.deliveryChannel} onChange={(event) => setDraft({ ...draft, deliveryChannel: event.target.value })} placeholder="log_only" />
                </label>
                <label>
                  Max tokens
                  <input type="number" min={256} step={128} value={draft.maxTokens} onChange={(event) => setDraft({ ...draft, maxTokens: Number(event.target.value) })} />
                </label>
              </div>

              <div className="cron-presets" aria-label="Schedule presets">
                {schedulePresets.map((preset) => (
                  <button type="button" key={preset.value} onClick={() => setDraft({ ...draft, schedule: preset.value })}>
                    {preset.label}
                  </button>
                ))}
              </div>

              <label className="cron-field">
                Description
                <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="What this job does" />
              </label>
              <label className="cron-field">
                Prompt or payload
                <textarea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} placeholder="Describe the recurring work." rows={7} />
              </label>
              <label className="cron-toggle">
                <input
                  type="checkbox"
                  checked={draft.status === 'active'}
                  onChange={(event) => setDraft({ ...draft, status: event.target.checked ? 'active' : 'paused' })}
                />
                Active immediately
              </label>
              <div className="cron-editor-actions">
                <Button tone="ghost" type="button" onClick={closeEditor}>Cancel</Button>
                <Button tone="gold" type="submit">
                  <Save size={14} />
                  Save job
                </Button>
              </div>
            </form>
          ) : selected ? (
            <CronDetails job={selected} onEdit={() => startEdit(selected)} onRun={() => runNow(selected)} onToggle={() => toggle(selected)} busy={busyId === selected.id} />
          ) : (
            <Surface className="cron-empty-detail">
              <p className="r-eyebrow-gold">Launchd</p>
              <h2>24/7 local service</h2>
              <p className="muted">
                Rivendell runs locally on this Mac at <code>:8091</code>. The cron jobs above are the recurring work
                layer behind the assistant-mcp system.
              </p>
              <pre className="code-block">launchctl list | grep rivendell</pre>
            </Surface>
          )}
        </aside>
      </div>
    </div>
  );
}

function CronDetails({ job, onEdit, onRun, onToggle, busy }: {
  job: CronJob;
  onEdit: () => void;
  onRun: () => void;
  onToggle: () => void;
  busy: boolean;
}) {
  return (
    <Surface className="cron-detail-card">
      <div className="section-head">
        <div>
          <p className="r-eyebrow-gold">Selected job</p>
          <h2>{job.name}</h2>
        </div>
        <Chip tone={job.status === 'active' ? 'emerald' : job.status === 'failed' ? 'rose' : 'neutral'}>{job.status}</Chip>
      </div>
      <p className="cron-description">{job.description || 'No description saved.'}</p>
      <dl className="cron-facts">
        <div>
          <dt>Schedule</dt>
          <dd><code>{job.schedule}</code></dd>
        </div>
        <div>
          <dt>Action</dt>
          <dd>{job.target}</dd>
        </div>
        <div>
          <dt>Action type</dt>
          <dd>{job.actionType || 'ai_prompt'}</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>{job.deliveryChannel || 'log_only'}</dd>
        </div>
        <div>
          <dt>Last run</dt>
          <dd>{job.lastRunAt ? `${timeAgo(job.lastRunAt)} ago` : job.lastRun}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{job.updatedAt ? `${timeAgo(job.updatedAt)} ago` : 'unknown'}</dd>
        </div>
      </dl>
      {job.prompt ? (
        <div className="cron-prompt-preview">
          <p className="r-eyebrow">Prompt</p>
          <pre>{job.prompt}</pre>
        </div>
      ) : null}
      {job.lastRunError ? (
        <div className="cron-error">
          <p className="r-eyebrow">Last error</p>
          <pre>{job.lastRunError}</pre>
        </div>
      ) : null}
      <div className="cron-detail-actions">
        <Button tone="elf" onClick={onRun} disabled={busy}>
          <Play size={14} />
          Run now
        </Button>
        <Button tone="ghost" onClick={onToggle} disabled={busy}>
          {job.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
          {job.status === 'active' ? 'Pause' : 'Resume'}
        </Button>
        <Button tone="gold" onClick={onEdit}>
          <Pencil size={14} />
          Edit
        </Button>
      </div>
    </Surface>
  );
}

function draftFromJob(job: CronJob): CronDraft {
  return {
    name: job.name,
    description: job.description || '',
    schedule: job.schedule,
    actionType: job.actionType || 'ai_prompt',
    prompt: job.prompt || '',
    toolName: job.toolName || (job.actionType === 'mcp_tool' ? job.target : ''),
    deliveryChannel: job.deliveryChannel || 'log_only',
    maxTokens: job.maxTokens || 1024,
    status: job.status === 'failed' ? 'paused' : job.status,
  };
}

function normalizeDraft(draft: CronDraft): Partial<CronJob> {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    schedule: draft.schedule.trim() || '0 9 * * *',
    target: draft.toolName.trim() || draft.actionType.trim() || 'ai_prompt',
    actionType: draft.actionType.trim() || 'ai_prompt',
    prompt: draft.prompt.trim(),
    toolName: draft.toolName.trim(),
    deliveryChannel: draft.deliveryChannel.trim() || 'log_only',
    maxTokens: Number(draft.maxTokens) || 1024,
    status: draft.status,
  };
}
