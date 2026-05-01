import { useEffect, useState } from 'react';
import type { ChronicleEvent } from '../data/mock';

type ServerEntry = {
  id: string;
  title: string;
  cwd: string;
  repoName: string;
  ts: number;
  running: boolean;
  busy: boolean;
};

const CHRONICLE_POLL_MS = 15000;

function timeLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'yest';
  const days = Math.round((now.getTime() - ms) / (24 * 60 * 60 * 1000));
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toEvent(e: ServerEntry): ChronicleEvent {
  return {
    id: e.id,
    t: timeLabel(e.ts),
    title: e.title,
    repo: e.repoName,
    kind: e.busy ? 'ember' : e.running ? 'gold' : 'ink',
    running: e.running || undefined,
    busy: e.busy || undefined,
    asleep: !e.running || undefined,
    status: e.busy ? 'tending now' : e.running ? 'warm, idle' : 'asleep',
  };
}

type State = {
  events: ChronicleEvent[];
  loading: boolean;
  error: string | null;
};

export function useChronicle(refreshKey: number = 0): State & { reload: () => void } {
  const [state, setState] = useState<State>({ events: [], loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), CHRONICLE_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: s.events.length === 0 }));
    fetch('/api/chronicle')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { events: ServerEntry[] }) => {
        if (cancelled) return;
        setState({
          events: data.events.map(toEvent),
          loading: false,
          error: null,
        });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setState({ events: [], loading: false, error: e.message });
      });
    return () => { cancelled = true; };
  }, [tick, refreshKey]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
