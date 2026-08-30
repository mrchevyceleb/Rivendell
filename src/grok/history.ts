// Client hook for the Grok-style sidebar conversation list.
// Fetches /api/chat/history (the server's read-only index over the durable
// event logs) and groups items Grok-style: Today / Yesterday / Previous 7
// days / Older. Polls lightly so a title appears after a first message lands.

import { useCallback, useEffect, useMemo, useState } from 'react';
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

  const reload = useCallback(() => {
    apiJson<{ items: HistoryItem[] }>('/api/chat/history')
      .then((r) => setItems(r.items ?? []))
      .catch(() => { /* history is best-effort */ });
  }, []);

  useEffect(() => {
    reload();
    const iv = window.setInterval(reload, 15_000);
    return () => window.clearInterval(iv);
  }, [reload]);

  const groups = useMemo(() => groupHistory(items), [items]);
  return { items, groups, reload };
}
