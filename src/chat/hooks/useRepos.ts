import { useEffect, useState } from 'react';
import type { Repo } from '../data/types';

type State =
  | { status: 'loading'; repos: Repo[] }
  | { status: 'ready'; repos: Repo[] }
  | { status: 'error'; repos: Repo[]; message: string };

export function useRepos(): State & { reload: () => void } {
  const [state, setState] = useState<State>({ status: 'loading', repos: [] });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/repos')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { repos: Repo[] }) => {
        if (cancelled) return;
        setState({ status: 'ready', repos: data.repos });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setState({ status: 'error', repos: [], message: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
