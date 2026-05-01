import { Router } from 'express';
import { assistantAdminJson } from '../lib/assistantAdmin.ts';
import { type StoredPin } from '../lib/pinStore.ts';
import { asyncHandler } from './helpers.ts';

type AdminPin = {
  id: string;
  title?: string | null;
  content?: string | null;
  category?: string | null;
  pinned?: boolean | null;
  is_pinned?: boolean | null;
  color?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const pinsRouter = Router();

pinsRouter.get('/', asyncHandler(async (req, res) => {
  const search = stringQuery(req.query.search);
  const category = stringQuery(req.query.category);
  try {
    res.json(await fetchAdminPins(search, category));
  } catch (err: any) {
    res.status(502).json({ error: `pins upstream failed: ${err?.message || 'unknown error'}` });
  }
}));

pinsRouter.post('/', asyncHandler(async (req, res) => {
  const input = readPinInput(req.body);
  try {
    const created = await createAdminPin(input);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(502).json({ error: `pins create failed: ${err?.message || 'unknown error'}` });
  }
}));

pinsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const input = readPinInput(req.body, true);
  try {
    res.json(await updateAdminPin(id, input));
  } catch (err: any) {
    res.status(502).json({ error: `pins update failed: ${err?.message || 'unknown error'}` });
  }
}));

pinsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  try {
    await assistantAdminJson(`/admin/api/pins/${encodeURIComponent(id)}`, { method: 'DELETE' });
    res.status(204).end();
  } catch (err: any) {
    res.status(502).json({ error: `pins delete failed: ${err?.message || 'unknown error'}` });
  }
}));

async function fetchAdminPins(search = '', category = ''): Promise<StoredPin[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (category && category !== 'all') params.set('category', category);
  const suffix = params.size ? `?${params}` : '';
  const data = await assistantAdminJson<{ pins?: AdminPin[] }>(`/admin/api/pins${suffix}`);
  return sortPins((data.pins ?? []).map(mapAdminPin));
}

async function createAdminPin(input: Partial<StoredPin>): Promise<StoredPin> {
  const data = await assistantAdminJson<{ pin: AdminPin }>('/admin/api/pins', {
    method: 'POST',
    body: JSON.stringify(toAdminPayload(input)),
  });
  return mapAdminPin(data.pin);
}

async function updateAdminPin(id: string, input: Partial<StoredPin>): Promise<StoredPin> {
  const data = await assistantAdminJson<{ pin: AdminPin }>(`/admin/api/pins/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(toAdminPayload(input)),
  });
  return mapAdminPin(data.pin);
}

function mapAdminPin(pin: AdminPin): StoredPin {
  const now = new Date().toISOString();
  return {
    id: pin.id,
    title: cleanTitle(pin.title, pin.content),
    content: pin.content || '',
    category: cleanCategory(pin.category),
    pinned: Boolean(pin.pinned ?? pin.is_pinned),
    color: pin.color || null,
    createdAt: pin.createdAt || pin.created_at || now,
    updatedAt: pin.updatedAt || pin.updated_at || pin.createdAt || pin.created_at || now,
  };
}

function toAdminPayload(input: Partial<StoredPin>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload.title = cleanTitle(input.title, input.content);
  if (input.content !== undefined) payload.content = input.content;
  if (input.category !== undefined) payload.category = cleanCategory(input.category);
  if (input.pinned !== undefined) payload.pinned = Boolean(input.pinned);
  if (input.color !== undefined) payload.color = input.color || null;
  return payload;
}

function readPinInput(body: unknown, partial = false): Partial<StoredPin> {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const input: Partial<StoredPin> = {};
  if (!partial || typeof source.title === 'string') input.title = typeof source.title === 'string' ? source.title : '';
  if (!partial || typeof source.content === 'string') input.content = typeof source.content === 'string' ? source.content : '';
  if (!partial || typeof source.category === 'string') input.category = typeof source.category === 'string' ? source.category : 'general';
  if (!partial || typeof source.pinned === 'boolean') input.pinned = Boolean(source.pinned);
  if (source.color === null || typeof source.color === 'string') input.color = source.color;
  return input;
}

function sortPins(pins: StoredPin[]): StoredPin[] {
  return [...pins].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function cleanTitle(title?: string | null, content?: string | null): string {
  const value = title?.trim() || content?.trim().split('\n')[0]?.trim() || 'Untitled pin';
  return value.slice(0, 120);
}

function cleanCategory(category?: string | null): string {
  return (category?.trim() || 'general').slice(0, 40);
}

function stringQuery(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
