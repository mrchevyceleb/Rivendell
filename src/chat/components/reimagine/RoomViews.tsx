// Compact embedded views for the reimagined chat's Hall/Council/Forge/Files
// room tabs + the sidebar Chronicle pane. These mirror the prototype's visual
// design and pull real data from the shared TanStack caches (useTasks /
// useCronJobs / useWorkspaceTree / useChronicle) so an embedded view and the
// full room tab stay in sync. Council tap-advance and Forge pause/wake hit the
// same endpoints the real rooms use, then invalidate the shared cache.

import { useState } from 'react';
import type { CronJob, Task, FileTreeNode } from '../../../data/types';
import type { ChronicleEvent } from '../../data/mock';
import { useTasks, useCronJobs, useWorkspaceTree } from '../../../hooks/useRoomData';
import { useChronicle } from '../../hooks/useChronicle';
import { HUB_HOME, HUB_SPACES } from '../../../shell/studio/hubSpaces';
import { apiJson } from '../../../data/api';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Doc, Folder, Pause, Play } from './icons';

// ── chronicle ribbon (marquee ticker) ──────────────────────────────────────
export function RibbonTicker({ events }: { events: ChronicleEvent[] }) {
  if (!events.length) return null;
  const row = (e: ChronicleEvent, k: string) => (
    <span key={k}>
      {e.t} · {e.title} · {e.repo} · {e.status ?? ''}
    </span>
  );
  const sep = (k: string) => (
    <span key={k} className="gl">
      ✦
    </span>
  );
  // Two distinct copies (unique keys each) so the marquee loops seamlessly.
  const a: import('react').ReactNode[] = [];
  const b: import('react').ReactNode[] = [];
  events.forEach((e, i) => {
    a.push(row(e, `a${i}`), sep(`as${i}`));
    b.push(row(e, `b${i}`), sep(`bs${i}`));
  });
  return (
    <div className="ribbon">
      <div className="ribbon-track">
        {a}
        {b}
      </div>
    </div>
  );
}

// ── chronicle event rows (sidebar pane + mobile sheet) ─────────────────────
export function ChronicleRows({
  events,
  onPick,
}: {
  events: ChronicleEvent[];
  onPick?: (e: ChronicleEvent) => void;
}) {
  if (!events.length) {
    return <div className="evt ink" style={{ gridTemplateColumns: '14px 1fr' }}><span className="dot" /><span className="t" style={{ color: 'var(--faint)' }}>the book is quiet</span></div>;
  }
  return (
    <>
      {events.map((e) => (
        <button
          key={e.id}
          type="button"
          className={`evt ${e.kind}`}
          onClick={() => onPick?.(e)}
        >
          <span className="dot" />
          <span className="t">{e.title}</span>
          <span className="when">{e.t}</span>
          <span className="s">
            {e.repo} · {e.status ?? ''}
          </span>
        </button>
      ))}
    </>
  );
}

// ── hubs strip (sidebar) ───────────────────────────────────────────────────
const HUBS = [
  { n: 'Work', c: 4 },
  { n: 'Side projects', c: 2 },
  { n: 'The Shire', c: 1 },
];
export function HubsStrip() {
  return (
    <>
      {HUBS.map((h) => (
        <button key={h.n} type="button" className="hub">
          <span>{h.n}</span>
          <span className="n">{h.c}</span>
        </button>
      ))}
    </>
  );
}

// ── compact Hub file tree — §6.3 (read-only; reuses the shared tree cache) ─
export function HubTree({ onPick }: { onPick: (path: string) => void }) {
  const { data } = useWorkspaceTree();
  const tree = data?.tree;
  return (
    <div className="tree">
      <button type="button" className="node" onClick={() => onPick(HUB_HOME.path)} title="Home">
        <span style={{ width: 12, flex: 'none' }} />
        <span className="fico gold" style={{ fontSize: 12, display: 'grid', placeItems: 'center' }}>
          ✦
        </span>
        <span>{HUB_HOME.label}.md</span>
      </button>
      {HUB_SPACES.filter((s) => s.kind === 'dir').map((space) => {
        const node = tree?.children?.find((c) => c.name === space.path) ?? findChild(tree, space.path);
        return <FolderRow key={space.id} label={space.label} node={node} onPick={onPick} defaultOpen={space.id === 'projects'} />;
      })}
    </div>
  );
}

function findChild(root: FileTreeNode | undefined, name: string): FileTreeNode | undefined {
  if (!root) return undefined;
  return root.children?.find((c) => c.name === name);
}

function FolderRow({
  label,
  node,
  onPick,
  defaultOpen,
}: {
  label: string;
  node?: FileTreeNode;
  onPick: (path: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const children = node?.children ?? [];
  const files = children.filter((c) => c.type === 'file');
  return (
    <>
      <button
        type="button"
        className={`node${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className="tw" />
        <Folder className="fico" />
        <span>{label}</span>
        <span className="cnt2">{files.length || ''}</span>
      </button>
      <div className={`kids${open ? ' open' : ''}`}>
        {files.map((f) => (
          <button key={f.path} type="button" className="leaf" onClick={() => onPick(`${node?.path ?? label}/${f.name}`)}>
            <Doc className="fico" />
            <span>{f.name}</span>
          </button>
        ))}
        {!files.length && open ? (
          <div className="leaf" style={{ color: 'var(--faint)' }}>
            <Doc className="fico" />
            <span>empty</span>
          </div>
        ) : null}
      </div>
    </>
  );
}

// ── Council board — §4.3 / §5.3 ─────────────────────────────────────────────
const COUNCIL_COLS: Array<{ key: Task['status']; title: string }> = [
  { key: 'horizon', title: 'On the Horizon' },
  { key: 'in_hand', title: 'In Hand' },
  { key: 'in_progress', title: 'In Progress' },
  { key: 'delegated', title: "In Council's Care" },
  { key: 'done', title: 'Done' },
];
const ADVANCE: Task['status'][] = ['horizon', 'in_hand', 'in_progress', 'delegated', 'done'];

export function CouncilBoard({ stacked }: { stacked: boolean }) {
  const { data: tasks = [] } = useTasks();
  const qc = useQueryClient();

  const advance = async (task: Task) => {
    if (task.status === 'done') return;
    const idx = ADVANCE.indexOf(task.status);
    const next = ADVANCE[Math.min(idx + 1, ADVANCE.length - 1)];
    try {
      await apiJson<Task[]>('/api/tasks/move', {
        method: 'POST',
        body: JSON.stringify({ id: task.id, status: next, index: 0 }),
      });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch {
      /* network error — leave the shared cache untouched */
    }
  };

  if (stacked) {
    return (
      <div>
        {COUNCIL_COLS.map((c) => {
          const items = tasks.filter((t) => t.status === c.key);
          return (
            <div key={c.key}>
              <div className="colhead">
                <span>{c.title}</span>
                <span className="cn2">{items.length || '·'}</span>
              </div>
              {items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`task${t.status === 'done' ? ' done2' : ''}`}
                  onClick={() => advance(t)}
                >
                  <div className="tt">{t.title}</div>
                  <div className="tm">
                    <span className={`pdot ${t.priority}`} />
                    <span>{t.project}</span>
                    <span>{t.due}</span>
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="board">
      {COUNCIL_COLS.map((c) => {
        const items = tasks.filter((t) => t.status === c.key);
        return (
          <div key={c.key} className="col">
            <div className="colhead">
              <span>{c.title}</span>
              <span className="cn2">{items.length || '·'}</span>
            </div>
            {items.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`task${t.status === 'done' ? ' done2' : ''}`}
                onClick={() => advance(t)}
              >
                <div className="tt">{t.title}</div>
                <div className="tm">
                  <span className={`pdot ${t.priority}`} />
                  <span>{t.project}</span>
                  <span>{t.due}</span>
                </div>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Forge jobs — §4.4 / §5.3 ────────────────────────────────────────────────
type ForgeState = 'running' | 'ok' | 'failed' | 'asleep';
function forgeState(job: CronJob): ForgeState {
  if (job.paused ?? job.status === 'paused') return 'asleep';
  if (job.lastRunStatus === 'running') return 'running';
  if (job.status === 'failed' || job.lastRunStatus === 'failed') return 'failed';
  return 'ok';
}

export function ForgeJobs() {
  const { data: jobs = [] } = useCronJobs();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const togglePause = async (job: CronJob) => {
    const paused = job.paused ?? job.status === 'paused';
    try {
      await apiJson<CronJob>(`/api/cron/${encodeURIComponent(job.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: paused ? 'active' : 'paused' }),
      });
      await qc.invalidateQueries({ queryKey: ['cron'] });
    } catch {
      /* leave cache untouched on error */
    }
  };

  return (
    <div className="jobs">
      {jobs.map((job) => {
        const state = forgeState(job);
        const log = [job.lastRunStatus ? `last · ${job.lastRunStatus}` : null, job.lastRunError].filter(Boolean) as string[];
        const paused = state === 'asleep';
        return (
          <div key={job.id} className={`job${paused ? ' asleep' : ''}${openId === job.id ? ' open' : ''}`}>
            <div className="job-head">
              <button
                type="button"
                className="job-expand"
                onClick={() => setOpenId((id) => (id === job.id ? null : job.id))}
                aria-expanded={openId === job.id}
              >
                <span className={`jdot ${state}`} />
                <span className="job-title">
                  <span className="jt">{job.name}</span>
                  <br />
                  <span className="js">{job.engine ?? job.aiModel ?? 'cron'}</span>
                </span>
                <span className="jr">
                  <span>{job.schedule}</span>
                  <br />
                  <span>{job.lastRun ?? (paused ? 'paused by you' : '')}</span>
                </span>
              </button>
              <button
                type="button"
                className="jbtn"
                aria-label={paused ? 'Wake' : 'Rest'}
                onClick={(e) => {
                  e.stopPropagation();
                  void togglePause(job);
                }}
              >
                {paused ? <Play /> : <Pause />}
              </button>
            </div>
            <div className="job-log">
              <pre>{log.length ? log.join('\n') : paused ? 'paused by you' : 'no run history yet'}</pre>
            </div>
          </div>
        );
      })}
      {!jobs.length ? (
        <div className="job">
          <div className="job-head">
            <span className="jdot asleep" />
            <span>
              <span className="jt">the forge is cold</span>
              <br />
              <span className="js">no errands scheduled</span>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}


