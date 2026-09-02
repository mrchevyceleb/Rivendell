// Client hook for the Grok-style sidebar conversation list.
// Fetches /api/chat/history (the server's read-only index over the durable
// event logs) and groups items Grok-style: Today / Yesterday / Previous 7
// days / Older. Polls lightly so a title appears after a first message lands.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson } from '../data/api';

export type HistoryItem = {
  chatId: string;
  cli: string;
  repo: string;
  title: string;
  preview?: string;
  updatedAt: number;
};

export type HistoryGroup = { label: string; items: HistoryItem[] };

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function groupHistory(items: HistoryItem[]): HistoryGroup[] {
  // Calendar-day math via setDate so DST transitions can't skew boundaries.
  const today = startOfDay(Date.now());
  const y = new Date(today); y.setDate(y.getDate() - 1);
  const w = new Date(today); w.setDate(w.getDate() - 7);
  const yesterday = y.getTime();
  const week = w.getTime();
  const groups: HistoryGroup[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ];
  for (const it of items) {
    if (it.updatedAt >= today) groups[0].items.push(it);
    else if (it.updatedAt >= yesterday) groups[1].items.push(it);
    else if (it.updatedAt >= week) groups[2].items.push(it);
    else groups[3].items.push(it);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function useChatHistory(): { items: HistoryItem[]; groups: HistoryGroup[]; reload: () => void } {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const requestSeq = useRef(0);

  const reload = useCallback(() => {
    const request = ++requestSeq.current;
    apiJson<{ items: HistoryItem[] }>('/api/chat/history')
      .then((r) => { if (request === requestSeq.current) setItems(r.items ?? []); })
      .catch(() => { /* history is best-effort */ });
  }, []);

  useEffect(() => {
    reload();
    let settleTimer: number | null = null;
    const onChanged = () => {
      reload();
      // Event-log appends are queued just behind the live WS event. Recheck once
      // after the disk write lands; result-cache revision prevents stale reuse.
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(reload, 350);
    };
    window.addEventListener('rivendell:history-changed', onChanged);
    // Semantic writes invalidate the server cache and active turns signal us
    // above. This slower poll only catches out-of-process filesystem changes.
    const iv = window.setInterval(reload, 15_000);
    return () => {
      window.clearInterval(iv);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      window.removeEventListener('rivendell:history-changed', onChanged);
    };
  }, [reload]);

  const groups = useMemo(() => groupHistory(items), [items]);
  return { items, groups, reload };
}
