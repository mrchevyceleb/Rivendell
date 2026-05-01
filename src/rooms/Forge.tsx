import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Clock3,
  HelpCircle,
  Laptop,
  Pencil,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiJson } from '../data/api';
import type { CronJob, CronPermissionMode, CronRuntime } from '../data/types';
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
  runtime: CronRuntime;
  cwd: string;
  permissionMode: CronPermissionMode;
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
  runtime: 'railway',
  cwd: '',
  permissionMode: 'default',
};

const schedulePresets = [
  { label: 'Every 5 min', value: '*/5 * * * *' },
  { label: 'Every 15 min', value: '*/15 * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily 6 AM', value: '0 6 * * *' },
  { label: 'Weekdays 9 AM', value: '0 9 * * 1-5' },
  { label: 'M/F 7 AM', value: '0 7 * * 1,5' },
];

const permissionModes: { value: CronPermissionMode; label: string; hint: string }[] = [
  { value: 'default', label: 'default', hint: 'Honour your local settings.json' },
  { value: 'acceptEdits', label: 'acceptEdits', hint: 'Auto-accept edits, prompt on bash' },
  { value: 'bypassPermissions', label: 'bypassPermissions', hint: 'Unattended — no prompts' },
  { value: 'plan', label: 'plan', hint: 'Plan only, never execute' },
];

export function Forge() {
  const { data: jobs = [], refetch } = useCronJobs();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CronDraft>(emptyDraft);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [filterRuntime, setFilterRuntime] = useState<'all' | CronRuntime>('all');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const filteredJobs = useMemo(
    () => (filterRuntime === 'all' ? jobs : jobs.filter((job) => (job.runtime || 'railway') === filterRuntime)),
    [jobs, filterRuntime],
  );

  const selected = useMemo(() => {
    if (!filteredJobs.length) return null;
    return filteredJobs.find((job) => job.id === selectedId) ?? filteredJobs[0];
  }, [filteredJobs, selectedId]);

  const isCreating = editingId === 'new';
  const editing = isCreating ? null : jobs.find((job) => job.id === editingId) ?? null;
  const activeCount = jobs.filter((job) => job.status === 'active').length;
  const pausedCount = jobs.filter((job) => job.status === 'paused').length;
  const failedCount = jobs.filter((job) => job.status === 'failed').length;
  const localCount = jobs.filter((job) => job.runtime === 'local').length;
  const railwayCount = jobs.length - localCount;

  const draftIsLocalAi = draft.runtime === 'local' && draft.actionType === 'ai_prompt';
  const cwdMissing = draftIsLocalAi && !draft.cwd.trim();

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['cron'] });
  };

  const startCreate = () => {
    setDraft(emptyDraft);
    setEditingId('new');
    setSelectedId(null);
    setAdvancedOpen(false);
  };

  const startEdit = (job: CronJob) => {
    const next = draftFromJob(job);
    setDraft(next);
    setEditingId(job.id);
    setSelectedId(job.id);
    // Open Advanced automatically if this job uses any non-default knob, so
    // the user sees what's actually set instead of having to hunt for it.
    setAdvancedOpen(hasNonDefaultAdvanced(next));
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraft(emptyDraft);
    setAdvancedOpen(false);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    if (cwdMissing) return;
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
        subtitle={`${jobs.length} schedules · ${activeCount} active · ${pausedCount} paused${failedCount ? ` · ${failedCount} failed` : ''} · ${railwayCount} on Railway · ${localCount} on Bag End.`}
        actions={
          <>
            <Button tone="ghost" onClick={() => setShowGuide((value) => !value)} title="Which runtime should I pick?">
              <HelpCircle size={15} />
              {showGuide ? 'Hide tips' : 'Tips'}
            </Button>
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

      {showGuide ? <RuntimeGuide onClose={() => setShowGuide(false)} /> : null}

      <div className="forge-summary">
        <Metric label="Active" value={activeCount} tone="emerald" />
        <Metric label="Paused" value={pausedCount} tone="gold" />
        <Metric label="Failed" value={failedCount} tone="rose" />
        <Metric label="On Railway" value={railwayCount} tone="elf" />
        <Metric label="On Bag End" value={localCount} tone="gold" />
      </div>

      <div className="forge-studio">
        <section className="cron-list-panel">
          <div className="section-head">
            <div>
              <p className="r-eyebrow-gold">Schedules</p>
              <h2>Existing jobs</h2>
            </div>
            <div className="runtime-filter" role="tablist" aria-label="Filter by runtime">
              <button
                type="button"
                role="tab"
                aria-selected={filterRuntime === 'all'}
                className={filterRuntime === 'all' ? 'is-active' : ''}
                onClick={() => setFilterRuntime('all')}
              >
                All <em>{jobs.length}</em>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filterRuntime === 'railway'}
                className={filterRuntime === 'railway' ? 'is-active' : ''}
                onClick={() => setFilterRuntime('railway')}
                title="Always-on cloud scheduler"
              >
                <Cloud size={12} /> Railway <em>{railwayCount}</em>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filterRuntime === 'local'}
                className={filterRuntime === 'local' ? 'is-active' : ''}
                onClick={() => setFilterRuntime('local')}
                title="Bag End local launchd runner"
              >
                <Laptop size={12} /> Bag End <em>{localCount}</em>
              </button>
            </div>
          </div>
          <div className="cron-card-list">
            {filteredJobs.length ? (
              filteredJobs.map((job) => (
                <article
                  className={`cron-card status-${job.status} runtime-${job.runtime || 'railway'} ${selected?.id === job.id ? 'is-selected' : ''}`}
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
                    <RuntimeChip runtime={job.runtime} />
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
              <EmptyState
                title={filterRuntime === 'all' ? 'No cron jobs yet' : `No ${filterRuntime === 'local' ? 'Bag End' : 'Railway'} jobs yet`}
                body={filterRuntime === 'local'
                  ? 'Create a local schedule for jobs that need a real repo and Claude Code Opus.'
                  : 'Create a schedule to have Elrond run recurring work.'}
              />
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

              {/* Required basics — what most jobs actually need. */}
              <label className="cron-field">
                Name
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Morning brief"
                  autoFocus
                />
              </label>

              <label className="cron-field">
                Schedule
                <input
                  value={draft.schedule}
                  onChange={(event) => setDraft({ ...draft, schedule: event.target.value })}
                  placeholder="0 9 * * *"
                />
                <small className="muted">Pick a preset below or type a cron expression.</small>
              </label>

              <div className="cron-presets" aria-label="Schedule presets">
                {schedulePresets.map((preset) => (
                  <button
                    type="button"
                    key={preset.value}
                    className={draft.schedule === preset.value ? 'is-active' : ''}
                    onClick={() => setDraft({ ...draft, schedule: preset.value })}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <label className="cron-field">
                Prompt
                <textarea
                  value={draft.prompt}
                  onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                  placeholder="Describe the recurring work. Be specific about output format and length."
                  rows={7}
                />
              </label>

              <label className="cron-field">
                Delivery <span className="cron-optional">optional</span>
                <select value={draft.deliveryChannel} onChange={(event) => setDraft({ ...draft, deliveryChannel: event.target.value })}>
                  <option value="log_only">Just log it — silent, no message</option>
                  <option value="telegram">Telegram — DM Matt</option>
                  <option value="email">Email — send to Matt</option>
                </select>
              </label>

              <label className="cron-toggle">
                <input
                  type="checkbox"
                  checked={draft.status === 'active'}
                  onChange={(event) => setDraft({ ...draft, status: event.target.checked ? 'active' : 'paused' })}
                />
                Turn on immediately
              </label>

              {/* Advanced — collapsed by default. Most jobs never touch any of this. */}
              <div className="cron-advanced">
                <button
                  type="button"
                  className="cron-advanced-toggle"
                  onClick={() => setAdvancedOpen((value) => !value)}
                  aria-expanded={advancedOpen}
                >
                  {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>Advanced</span>
                  <small>runtime, action type, permissions — usually leave alone</small>
                </button>

                {advancedOpen ? (
                  <div className="cron-advanced-body">
                    <label className="cron-field">
                      Description <span className="cron-optional">optional</span>
                      <input
                        value={draft.description}
                        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                        placeholder="What this job does"
                      />
                    </label>

                    <div className="runtime-toggle-row">
                      <div>
                        <p className="r-eyebrow-gold">Runtime</p>
                        <p className="muted small">Where this schedule fires. Default: Railway.</p>
                      </div>
                      <RuntimeToggle
                        value={draft.runtime}
                        onChange={(runtime) => setDraft({ ...draft, runtime })}
                      />
                      <button
                        type="button"
                        className="r-icon-button"
                        onClick={() => setShowGuide(true)}
                        title="Which runtime should I pick?"
                        aria-label="Runtime help"
                      >
                        <HelpCircle size={14} />
                      </button>
                    </div>

                    {draftIsLocalAi ? (
                      <p className="runtime-hint">
                        <Sparkles size={12} /> Bag End jobs run <code>claude -p</code> in <code>{draft.cwd || '<cwd>'}</code> with full Opus + repo access.
                      </p>
                    ) : draft.runtime === 'railway' ? (
                      <p className="runtime-hint">
                        <Cloud size={12} /> Railway jobs run in-process on the always-on Railway server. Best for time-critical and stateless work.
                      </p>
                    ) : null}

                    <div className="cron-form-grid">
                      <label>
                        Action type
                        <select value={draft.actionType} onChange={(event) => setDraft({ ...draft, actionType: event.target.value })}>
                          <option value="ai_prompt">ai_prompt — Claude does the work</option>
                          <option value="tool_call">tool_call — call an MCP tool directly</option>
                          <option value="webhook">webhook — POST to a URL</option>
                        </select>
                      </label>
                      <label>
                        Tool name <span className="cron-optional">optional</span>
                        <input
                          value={draft.toolName}
                          onChange={(event) => setDraft({ ...draft, toolName: event.target.value })}
                          placeholder={draft.actionType === 'tool_call' ? 'gmail_send' : 'Optional MCP tool'}
                          disabled={draft.actionType === 'webhook'}
                        />
                      </label>
                      <label>
                        Max tokens
                        <input
                          type="number"
                          min={256}
                          step={128}
                          value={draft.maxTokens}
                          onChange={(event) => setDraft({ ...draft, maxTokens: Number(event.target.value) })}
                        />
                      </label>
                    </div>

                    {draftIsLocalAi ? (
                      <div className="cron-local-fields">
                        <label className="cron-field">
                          Working directory
                          <input
                            value={draft.cwd}
                            onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
                            placeholder="/Users/mjohnst/samwise/KG-Apps/operly"
                          />
                          <small className="muted">
                            Required for Bag End ai_prompt jobs. Absolute path where <code>claude -p</code> will run.
                          </small>
                        </label>
                        <label className="cron-field">
                          Permission mode
                          <select
                            value={draft.permissionMode}
                            onChange={(event) => setDraft({ ...draft, permissionMode: event.target.value as CronPermissionMode })}
                          >
                            {permissionModes.map((mode) => (
                              <option key={mode.value} value={mode.value}>
                                {mode.label} — {mode.hint}
                              </option>
                            ))}
                          </select>
                          {draft.permissionMode === 'bypassPermissions' ? (
                            <small className="warn">
                              <ShieldAlert size={11} /> Unattended bypass. The CLI will run any tool/command without prompting. Only use for jobs you trust completely.
                            </small>
                          ) : (
                            <small className="muted">Unattended jobs that need to edit + run shell usually want <code>bypassPermissions</code>.</small>
                          )}
                        </label>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {cwdMissing ? (
                <p className="form-error">
                  <ShieldAlert size={12} /> Bag End ai_prompt jobs need a working directory. Open <strong>Advanced</strong> to set it.
                </p>
              ) : null}
              <div className="cron-editor-actions">
                <Button tone="ghost" type="button" onClick={closeEditor}>Cancel</Button>
                <Button tone="gold" type="submit" disabled={cwdMissing}>
                  <Save size={14} />
                  Save job
                </Button>
              </div>
            </form>
          ) : selected ? (
            <CronDetails
              job={selected}
              onEdit={() => startEdit(selected)}
              onRun={() => runNow(selected)}
              onToggle={() => toggle(selected)}
              busy={busyId === selected.id}
            />
          ) : (
            <RuntimeGuide variant="empty" onClose={() => setShowGuide(false)} />
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
        <div className="cron-detail-chips">
          <Chip tone={job.status === 'active' ? 'emerald' : job.status === 'failed' ? 'rose' : 'neutral'}>{job.status}</Chip>
          <RuntimeChip runtime={job.runtime} />
        </div>
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
        {job.runtime === 'local' && job.cwd ? (
          <div>
            <dt>Working dir</dt>
            <dd><code>{job.cwd}</code></dd>
          </div>
        ) : null}
        {job.runtime === 'local' && job.permissionMode ? (
          <div>
            <dt>Permissions</dt>
            <dd><code>{job.permissionMode}</code></dd>
          </div>
        ) : null}
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

function RuntimeToggle({ value, onChange }: { value: CronRuntime; onChange: (value: CronRuntime) => void }) {
  return (
    <div className={`runtime-toggle runtime-${value}`} role="radiogroup" aria-label="Runtime">
      <button
        type="button"
        role="radio"
        aria-checked={value === 'railway'}
        className={value === 'railway' ? 'is-active' : ''}
        onClick={() => onChange('railway')}
      >
        <Cloud size={14} />
        <span>
          <strong>Railway</strong>
          <small>always-on cloud</small>
        </span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'local'}
        className={value === 'local' ? 'is-active' : ''}
        onClick={() => onChange('local')}
      >
        <Laptop size={14} />
        <span>
          <strong>Bag End</strong>
          <small>local Mac · Claude CLI</small>
        </span>
      </button>
    </div>
  );
}

function RuntimeChip({ runtime }: { runtime?: CronRuntime }) {
  const value = runtime || 'railway';
  if (value === 'local') {
    return (
      <span className="runtime-chip runtime-local" title="Runs on Bag End via launchd. Uses Claude Code CLI.">
        <Laptop size={12} /> Bag End
      </span>
    );
  }
  return (
    <span className="runtime-chip runtime-railway" title="Runs in-process on the Railway scheduler.">
      <Cloud size={12} /> Railway
    </span>
  );
}

function RuntimeGuide({ variant, onClose }: { variant?: 'empty' | 'banner'; onClose: () => void }) {
  return (
    <Surface className={`runtime-guide ${variant === 'empty' ? 'runtime-guide-empty' : 'runtime-guide-banner'}`}>
      <div className="section-head">
        <div>
          <p className="r-eyebrow-gold">How to choose a runtime</p>
          <h2>Railway vs Bag End</h2>
        </div>
        {variant !== 'empty' ? (
          <button type="button" className="r-icon-button" onClick={onClose} title="Hide tips">
            <X size={14} />
          </button>
        ) : null}
      </div>
      <p className="muted runtime-guide-lede">
        Default to Railway. Move a job to Bag End only when one of the local-only powers actually changes the outcome.
      </p>
      <div className="runtime-guide-grid">
        <div className="runtime-guide-card">
          <header>
            <Cloud size={14} />
            <strong>Pick Railway when…</strong>
          </header>
          <ul>
            <li>Job is time-critical (every X min, can't miss a fire).</li>
            <li>It's a pure tool call or webhook — no reasoning.</li>
            <li>It handles inbound user data (SMS, webhooks, polls).</li>
            <li>A 4-hour Mac outage would break something.</li>
          </ul>
        </div>
        <div className="runtime-guide-card">
          <header>
            <Laptop size={14} />
            <strong>Pick Bag End when…</strong>
          </header>
          <ul>
            <li>Job needs a real checkout — git, gh, npm test, edit files.</li>
            <li>Heavy reasoning that benefits from local Opus.</li>
            <li>Needs MCP servers only configured locally (Codex, etc.).</li>
            <li>Misses are tolerable if the Mac sleeps.</li>
          </ul>
        </div>
      </div>
      <p className="runtime-guide-rule">
        <Sparkles size={12} /> Gut check: <em>"Could a 4-hour Mac outage break this?"</em> → Railway.&nbsp;
        <em>"Does this need a real repo or smart reasoning?"</em> → Bag End.
      </p>
    </Surface>
  );
}

function hasNonDefaultAdvanced(draft: CronDraft): boolean {
  return (
    draft.runtime !== emptyDraft.runtime ||
    draft.actionType !== emptyDraft.actionType ||
    Boolean(draft.toolName) ||
    draft.maxTokens !== emptyDraft.maxTokens ||
    Boolean(draft.cwd) ||
    draft.permissionMode !== emptyDraft.permissionMode ||
    Boolean(draft.description)
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
    runtime: job.runtime || 'railway',
    cwd: job.cwd || '',
    permissionMode: job.permissionMode || 'default',
  };
}

function normalizeDraft(draft: CronDraft): Partial<CronJob> {
  const isLocalAi = draft.runtime === 'local' && draft.actionType === 'ai_prompt';
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
    runtime: draft.runtime,
    cwd: isLocalAi ? draft.cwd.trim() : undefined,
    permissionMode: isLocalAi ? draft.permissionMode : undefined,
  };
}
