// Client agent model — the team Matt curates, served from /api/agents.
// One agent = one persistent forever-thread + a scope document + an engine.

import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '../data/api';
import type { ReactNode } from 'react';

export type Agent = {
  id: string;
  name: string;
  role: string;
  /** WORKSPACE_COMPANIONS lane id ('claude-kim', 'xai', …). */
  engine: string;
  /** home thread chatId (bot-<id>). */
  home: string;
  createdAt: number;
  /** Avatar version stamp — cache-buster for /api/agents/:id/avatar. */
  avatar?: number;
  /** Manual sidebar position — the list is fixed unless the user drags. */
  order?: number;
  /** xAI realtime voice id for calls. */
  voice?: string;
  /** Replies waiting since your last visit (server-computed). */
  unread?: number;
  /** Pinned to the top bubble strip (user choice). */
  pinned?: boolean;
};

export function useAgents(): { agents: Agent[]; reload: () => void } {
  const [agents, setAgents] = useState<Agent[]>([]);
  const reload = useCallback(() => {
    apiJson<{ agents: Agent[] }>('/api/agents')
      .then((r) => setAgents(r.agents ?? []))
      .catch(() => { /* agents are best-effort until the server answers */ });
  }, []);
  useEffect(() => {
    // Optimistic badge clear: a successful markAgentRead zeroes the pin NOW,
    // not at the next 10s poll. The server independently refuses to badge
    // watched lanes (threadWatch), so this mostly covers the mark race.
    const onRead = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, unread: 0 } : a)));
    };
    window.addEventListener('rivendell:agent-read', onRead);
    return () => window.removeEventListener('rivendell:agent-read', onRead);
  }, []);
  useEffect(() => {
    reload();
    const iv = window.setInterval(reload, 10_000);
    return () => window.clearInterval(iv);
  }, [reload]);
  return { agents, reload };
}

export async function createAgent(input: { name: string; role?: string; engine?: string; voice?: string; scope?: string }): Promise<Agent> {
  const r = await apiJson<{ agent: Agent }>('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return r.agent;
}

export async function updateAgentReq(id: string, patch: { name?: string; role?: string; engine?: string; voice?: string; pinned?: boolean; scope?: string }): Promise<Agent> {
  const r = await apiJson<{ agent: Agent }>(`/api/agents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return r.agent;
}

export async function reorderAgentIds(ids: string[]): Promise<Agent[]> {
  const r = await apiJson<{ agents: Agent[] }>('/api/agents/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return r.agents ?? [];
}

/** Report the focused thread as read (clears the unread badge). */
export async function markAgentRead(id: string): Promise<void> {
  try {
    await apiJson(`/api/agents/${encodeURIComponent(id)}/read`, { method: 'POST' });
    window.dispatchEvent(new CustomEvent('rivendell:agent-read', { detail: id }));
  } catch { /* best-effort */ }
}

export async function deleteAgentReq(id: string): Promise<void> {
  await apiJson<{ deleted: boolean }>(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Avatar URL (version-stamped) or null when the agent has none. */
export function agentAvatarUrl(a: Agent): string | null {
  return a.avatar ? `/api/agents/${encodeURIComponent(a.id)}/avatar?v=${a.avatar}` : null;
}

/** Center-crop + downscale to a 256px square webp (small files, round discs). */
async function squareCrop(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
  if (!blob) throw new Error('could not process image');
  return blob;
}

export async function uploadAgentAvatar(id: string, file: File): Promise<Agent> {
  const blob = await squareCrop(file);
  const res = await fetch(`/api/agents/${encodeURIComponent(id)}/avatar`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/webp' },
    body: blob,
  });
  if (!res.ok) throw new Error((await res.text()) || `upload failed (${res.status})`);
  const r = await res.json() as { agent: Agent };
  return r.agent;
}

export async function removeAgentAvatar(id: string): Promise<Agent> {
  return apiJson<Agent & { agent: Agent }>(`/api/agents/${encodeURIComponent(id)}/avatar`, { method: 'DELETE' })
    .then((r) => (r as { agent: Agent }).agent ?? (r as Agent));
}

// Deterministic disc color per agent name — a calm sand-palette rotation.
const DISC_COLORS = ['#8A8F98', '#7FA6A0', '#A6937F', '#8F7FA6', '#A67F93', '#7F92A6', '#9AA67F'];
export function agentColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return DISC_COLORS[h % DISC_COLORS.length];
}

/** Disc content: the agent's initial (dynamic team — no fixed glyphs). */
export function agentMark(a: Agent | undefined, fallback = '?'): ReactNode {
  return a?.name?.trim().slice(0, 1).toUpperCase() ?? fallback;
}

/** chatId equality ignoring the account suffix (history rows carry it; the
    open view holds the base — useChat re-appends it from the lane). */
export function sameChatId(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/__acct__[a-z]+$/i, '');
  return strip(a) === strip(b);
}
