// Grok Bot right info pane: the agent's "screen" (latest artifact it made,
// live preview when it's HTML/an image — honest empty state otherwise), the
// Routines card (real cron jobs from /api/cron with status + schedule), and a
// Session card with the live context meter + compaction state.

import { X, Play, Pause, Trash2, Pin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CheckCircle2, PauseCircle, Plus } from 'lucide-react';
import { apiJson } from '../data/api';
import { useCronJobs } from '../hooks/useRoomData';
import { useProxyViewer } from '../hooks/useProxyViewer';
import { scrollToPinnedMessage, useAgentMessagePins } from './messagePins';

type ArtifactMeta = { id: string; title?: string; kind?: string; createdAt?: number };

// Light cron humanizer for the Routines card — the reference shows
// "Every hour on weekdays, 8:29 AM – 7:29 PM", not raw cron. Handles the
// common shapes; anything exotic falls through untouched.
function humanizeRoutine(schedule: string): string {
  const m = /^every:(\d+)(m|h)$/.exec(schedule);
  if (m) return `Every ${m[1]}${m[2] === 'h' ? 'h' : 'm'}`;
  const d = /^(weekdays|daily):(\d{1,2}):(\d{2})$/.exec(schedule);
  if (d) {
    const hh = parseInt(d[2], 10);
    const mm = d[3];
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 || 12;
    return `${d[1] === 'weekdays' ? 'Weekdays' : 'Daily'} · ${h12}:${mm} ${ampm}`;
  }
  if (schedule.startsWith('cron:')) return `Cron ${schedule.slice(5)}`;
  return schedule;
}

export function humanizeCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;
  const [min, hour, dom, mon, dow] = parts;
  const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const atDay = dow === '1-5' ? 'weekdays'
    : /^[0-6]$/.test(dow) ? DAYS[Number(dow)] ?? DAYS[0]
    : dow === '7' ? 'Sundays'
    : null;
  const fmtHour = (h: number, m: number) => {
    const ap = h >= 12 ? 'PM' : 'AM';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
  };
  if (min.startsWith('*/') && hour === '*') return `Every ${min.slice(2)} min`;
  if (min.startsWith('*/') && hour.includes('-')) {
    // */15 8-19 * * 1-5 = every N MINUTES inside the hour window
    const [a, b] = hour.split('-').map(Number);
    const day = atDay ? (atDay === 'weekdays' ? 'on weekdays' : `on ${atDay}`) : '';
    return `Every ${min.slice(2)} min${day ? ` ${day}` : ''}, ${fmtHour(a, 0)} – ${fmtHour(b, 59)}`;
  }
  // 29 8-19 * * 1-5 = hourly at :29 past, inside the window
  if (!min.includes('*') && hour.includes('-')) {
    const m = Number(min);
    const [a, b] = hour.split('-').map(Number);
    if (!Number.isNaN(m) && !Number.isNaN(a) && !Number.isNaN(b)) {
      const day = atDay ? (atDay === 'weekdays' ? 'on weekdays' : `on ${atDay}`) : '';
      return `Every hour at :${String(m).padStart(2, '0')}${day ? ` ${day}` : ''}, ${fmtHour(a, m)} – ${fmtHour(b, m)}`;
    }
  }
  if (!min.startsWith('*') && !hour.startsWith('*')) {
    const m = Number(min); const h = Number(hour);
    if (!Number.isNaN(m) && !Number.isNaN(h)) {
      if (dom === '*' && mon === '*' && atDay) {
        const day = atDay === 'weekdays' ? 'weekday' : atDay.replace(/s$/, '');
        return `Every ${day} at ${fmtHour(h, m)}`;
      }
      if (dom === '*' && mon === '*' && dow === '*') return `Every day at ${fmtHour(h, m)}`;
      if (dom !== '*' && mon === '*') return `On the ${ordinal(Number(dom))} of every month at ${fmtHour(h, m)}`;
    }
  }
  return schedule;
}

function ordinal(n: number): string {
  const s = n % 10;
  return `${n}${s === 1 && n !== 11 ? 'st' : s === 2 && n !== 12 ? 'nd' : s === 3 && n !== 13 ? 'rd' : 'th'}`;
}

export type ChatMeta = {
  agentLabel: string;
  model?: string | null;
  status: string;
  /** Context window fullness 0..1 when known. */
  fraction?: number;
  compacting?: boolean;
};

export function BotPanel({ meta, onOpenForge, onClose, className = '', agent }: { meta: ChatMeta | null; onOpenForge: () => void; onClose?: () => void; className?: string; agent?: import('./agents').Agent | null }) {
  const viewer = useProxyViewer();
  const { data: cronJobs } = useCronJobs();
  const messagePins = useAgentMessagePins(agent?.id);
  const visiblePins = agent ? messagePins.pins.filter((p) => p.agentId === agent.id) : [];
  const [latest, setLatest] = useState<ArtifactMeta | null>(null);
  const [routines, setRoutines] = useState<Array<{ id: string; name: string; agentName: string; agentId: string; schedule: string; prompt: string; paused?: boolean; lastRunAt?: number }>>([]);
  const [routineForm, setRoutineForm] = useState(false);
  const [rtName, setRtName] = useState('');
  const [rtSchedule, setRtSchedule] = useState('daily:09:00');
  const [rtPrompt, setRtPrompt] = useState('');
  const [rtBusy, setRtBusy] = useState(false);

  const reloadRoutines = () => {
    apiJson<{ routines: typeof routines }>('/api/routines')
      .then((r) => setRoutines(r.routines ?? []))
      .catch(() => {});
  };
  useEffect(() => {
    reloadRoutines();
    const iv = window.setInterval(reloadRoutines, 20_000);
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => {
    let alive = true;
    apiJson<ArtifactMeta[]>('/api/artifacts')
      .then((rows) => { if (alive) setLatest(Array.isArray(rows) && rows.length ? rows[0] : null); })
      .catch(() => { /* desk is best-effort */ });
    const iv = window.setInterval(() => {
      apiJson<ArtifactMeta[]>('/api/artifacts')
        .then((rows) => { if (alive) setLatest(Array.isArray(rows) && rows.length ? rows[0] : null); })
        .catch(() => {});
    }, 20_000);
    return () => { alive = false; window.clearInterval(iv); };
  }, []);

  const isHtml = (latest?.kind ?? '').includes('html');
  const isImage = (latest?.kind ?? '').includes('image') || /\.(png|jpe?g|gif|webp|svg)$/i.test(latest?.title ?? '');
  const jobs = (cronJobs ?? []).slice(0, 8);
  const frac = meta?.fraction;

  return (
    <aside className={`bt-pane ${className}`.trim()}>
      <section className="bt-pane-sec">
        <div className="bt-pane-title-row">
          <div className="bt-pane-title">{meta?.agentLabel ?? 'Agent'}&apos;s desk</div>
          {onClose ? (
            <button className="bt-iconbtn bt-pane-close" onClick={onClose} aria-label="Close panel" title="Close panel">
              <X size={16} />
            </button>
          ) : null}
        </div>
        <div className="bt-screen">
          {latest ? (
            <>
              {isHtml ? (
                <button
                  className="bt-screen-preview"
                  onClick={() => viewer.open({ source: 'artifact', id: latest.id, title: latest.title })}
                  title="Open artifact"
                >
                  <iframe title="artifact preview" sandbox="" src={`/api/artifacts/${encodeURIComponent(latest.id)}/content`} />
                </button>
              ) : isImage ? (
                <button
                  className="bt-screen-preview"
                  onClick={() => viewer.open({ source: 'artifact', id: latest.id, title: latest.title })}
                  title="Open artifact"
                >
                  <img src={`/api/artifacts/${encodeURIComponent(latest.id)}/content`} alt={latest.title ?? 'artifact'} />
                </button>
              ) : (
                <button
                  className="bt-screen-preview"
                  onClick={() => viewer.open({ source: 'artifact', id: latest.id, title: latest.title })}
                  title="Open artifact"
                >
                  <span className="bt-screen-idle">▤</span>
                </button>
              )}
              <div className="bt-screen-meta">{latest.title ?? 'Latest artifact'}</div>
            </>
          ) : (
            <>
              <div className="bt-screen-idle">·</div>
              <div className="bt-screen-meta">Nothing on the desk yet — ask {meta?.agentLabel ?? 'the agent'} to build something.</div>
            </>
          )}
        </div>
      </section>

      <section className="bt-pane-sec">
        <div className="bt-pane-title">
          Automations{agent ? ` · ${agent.name}` : ''}
          <button
            className="bt-iconbtn"
            onClick={() => { setRoutineForm((f) => !f); setRtName(''); setRtPrompt(''); setRtSchedule(agent ? 'daily:09:00' : 'every:30m'); }}
            title={agent ? `New automation for ${agent.name}` : 'New automation'}
            aria-label="New automation"
          >
            <Plus size={16} />
          </button>
        </div>
        {routineForm ? (
          <div className="bt-rt-form">
            <input className="bt-rt-input" placeholder="Name (Morning brief)" value={rtName} onChange={(e) => setRtName(e.target.value)} maxLength={80} />
            <select className="bt-rt-input" value={rtSchedule} onChange={(e) => setRtSchedule(e.target.value)}>
              <option value="every:30m">Every 30 minutes</option>
              <option value="every:2h">Every 2 hours</option>
              <option value="daily:09:00">Daily · 9:00 AM</option>
              <option value="daily:17:00">Daily · 5:00 PM</option>
              <option value="weekdays:09:00">Weekdays · 9:00 AM</option>
              <option value="cron:0 * * * *">Hourly (cron)</option>
            </select>
            <textarea
              className="bt-rt-input"
              placeholder={agent ? `What ${agent.name} should do each run…` : 'What the agent should do each run…'}
              value={rtPrompt}
              onChange={(e) => setRtPrompt(e.target.value)}
              rows={4}
            />
            <div className="bt-rt-actions">
              <button
                className="bt-rt-btn primary"
                disabled={rtBusy || !rtPrompt.trim() || !agent}
                onClick={async () => {
                  setRtBusy(true);
                  try {
                    await apiJson('/api/routines', {
                      method: 'POST',
                      body: JSON.stringify({ name: rtName || 'Routine', agentId: agent?.id, schedule: rtSchedule, prompt: rtPrompt }),
                    });
                    setRoutineForm(false);
                    reloadRoutines();
                  } finally { setRtBusy(false); }
                }}
              >
                {agent ? `Add for ${agent.name}` : 'Pick an agent first'}
              </button>
            </div>
          </div>
        ) : null}
        {routines.filter((r) => !agent || r.agentId === agent.id).map((r) => (
          <div key={r.id} className={`bt-routine ${r.paused ? 'off' : 'on'}`}>
            {r.paused ? <PauseCircle size={16} /> : <CheckCircle2 size={16} />}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="bt-routine-name">{r.name}</span>
              <span className="bt-routine-sched" style={{ display: 'block' }}>{humanizeRoutine(r.schedule)}</span>
              {!agent ? <span className="bt-routine-sched" style={{ display: 'block' }}>→ {r.agentName}</span> : null}
              {r.paused ? <span className="bt-routine-paused" style={{ display: 'block' }}>Paused</span> : null}
            </span>
            <span className="bt-rt-rowbtns">
              <button className="bt-iconbtn" title="Run now" aria-label="Run now"
                onClick={() => { void apiJson(`/api/routines/${encodeURIComponent(r.id)}/run`, { method: 'POST' }).then(reloadRoutines); }}>
                <Play size={13} />
              </button>
              <button className="bt-iconbtn" title={r.paused ? 'Resume' : 'Pause'} aria-label={r.paused ? 'Resume' : 'Pause'}
                onClick={() => { void apiJson(`/api/routines/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: JSON.stringify({ paused: !r.paused }) }).then(reloadRoutines); }}>
                {r.paused ? <Play size={13} /> : <Pause size={13} />}
              </button>
              <button className="bt-iconbtn" title="Delete" aria-label="Delete routine"
                onClick={() => { if (window.confirm(`Delete routine "${r.name}"?`)) { void apiJson(`/api/routines/${encodeURIComponent(r.id)}`, { method: 'DELETE' }).then(reloadRoutines); } }}>
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
        {!routines.length && !routineForm ? (
          <div className="bt-pane-empty">{agent ? `No automations for ${agent.name} yet — + to schedule one.` : 'No automations yet.'}</div>
        ) : null}
      </section>

      {agent ? (
        <section className="bt-pane-sec">
          <div className="bt-pane-title">Pinned from {agent.name}</div>
          {messagePins.loadError && !visiblePins.length ? (
            <div className="bt-pane-empty">Pins hid for a second — I’ll try again in a moment.</div>
          ) : visiblePins.length ? visiblePins.map((p) => (
            <div key={p.id} className="bt-msgpin">
              <button
                type="button"
                className="bt-msgpin-body"
                title="Jump to this message"
                onClick={() => scrollToPinnedMessage(p.blockId)}
              >
                <span className="bt-msgpin-text">{(p.text ?? '').trim() || 'Empty bubble'}</span>
              </button>
              <button
                type="button"
                className="bt-iconbtn bt-msgpin-unpin"
                title="Unpin"
                aria-label="Unpin"
                onClick={() => { void messagePins.unpin(p.id); }}
              >
                <X size={13} />
              </button>
            </div>
          )) : (
            <div className="bt-msgpin-empty">
              <Pin size={16} className="bt-msgpin-idle" />
              <span>Nothing pocketed yet. Hover a bubble, tap pin, and I’ll hold it here.</span>
            </div>
          )}
        </section>
      ) : null}

      <section className="bt-pane-sec">
        <div className="bt-pane-title">
          System cron
          <button className="bt-iconbtn" onClick={onOpenForge} title="Manage in Forge" aria-label="Manage in Forge">
            <Plus size={16} />
          </button>
        </div>
        {jobs.length ? jobs.map((j) => (
          <button key={j.id} className={`bt-routine ${j.status === 'active' ? 'on' : 'off'}`} onClick={onOpenForge} title="Open in Forge">
            {j.status === 'active' ? <CheckCircle2 size={16} /> : <PauseCircle size={16} />}
            <span>
              <span className="bt-routine-name">{j.name}</span>
              <span className="bt-routine-sched" style={{ display: 'block' }}>{humanizeCron(j.schedule)}</span>
              {j.status !== 'active' ? <span className="bt-routine-paused" style={{ display: 'block' }}>Paused</span> : null}
            </span>
          </button>
        )) : (
          <div className="bt-pane-empty">No routines yet. Forge can schedule one.</div>
        )}
      </section>

      {meta ? (
        <section className="bt-pane-sec">
          <div className="bt-pane-title">Session</div>
          <div className="bt-session">
            <div className="bt-session-row"><span>Agent</span><b>{meta.agentLabel}</b></div>
            {meta.model ? <div className="bt-session-row"><span>Model</span><b>{meta.model}</b></div> : null}
            <div className="bt-session-row"><span>State</span><b>{meta.compacting ? 'Compacting…' : meta.status}</b></div>
            {typeof frac === 'number' ? (
              <>
                <div className={`bt-meter${frac > 0.8 ? ' hot' : ''}`}>
                  <i style={{ width: `${Math.min(100, Math.round(frac * 100))}%` }} />
                </div>
                <div className="bt-session-cap">Context {Math.round(frac * 100)}%{meta.compacting ? ' — compacting to keep the thread alive' : ''}</div>
              </>
            ) : null}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
