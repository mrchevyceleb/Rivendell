import { useEffect, useState } from 'react';
import type { LiveSession } from '../data/types';

// Polls /api/live every few seconds so the chronicle ribbon can show which
// (cli, repo) sessions are running right now and which one is currently
// "tending" (busy mid-turn).

const POLL_MS = 4000;

export function useLive(): LiveSession[] {
  const [sessions, setSessions] = useState<LiveSession[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const r = await fetch('/api/live');
        if (!r.ok) return;
        const data = (await r.json()) as { sessions: LiveSession[] };
        if (cancelled) return;
        setSessions(data.sessions);
      } catch {
        // Ignore — server might be bouncing.
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, POLL_MS);
      }
    };

    tick();

    // setTimeout in background tabs is throttled (often to once per minute),
    // so on tab refocus the "tending" indicator can be stale by minutes.
    // Force a fresh poll the moment we're visible again.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  return sessions;
}
