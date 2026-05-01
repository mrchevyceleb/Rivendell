import { Router } from 'express';
import { callMcp } from '../lib/mcp.ts';
import { fetchAdminEmails } from '../lib/assistantData.ts';
import { emailStore } from '../lib/roomStores.ts';
import { asyncHandler } from './helpers.ts';

export const emailRouter = Router();

emailRouter.get('/', asyncHandler(async (_req, res) => {
  // Real upstream only. Admin endpoint first; fall through to MCP gmail tool
  // if admin path 404s, then surface the error. emailStore is no longer a
  // fallback — it stayed mock-polluted on disk.
  try {
    res.json(await fetchAdminEmails());
    return;
  } catch (adminErr: any) {
    try {
      res.json(await callMcp('gmail', { action: 'list_unified' }));
      return;
    } catch (mcpErr: any) {
      res.status(502).json({
        error: `email upstream failed (admin: ${adminErr?.message || 'n/a'} | mcp: ${mcpErr?.message || 'n/a'})`,
      });
    }
  }
}));

emailRouter.post('/draft', asyncHandler(async (req, res) => {
  // Local emailStore mirror is kept for write-back/draft state only — the
  // canonical source remains gmail upstream.
  const id = typeof req.body.id === 'string' ? req.body.id : '';
  const body = String(req.body.body || req.body.draftBody || '').trim();
  const artifactId = typeof req.body.artifactId === 'string' ? req.body.artifactId : undefined;
  if (id) {
    await emailStore.update(id, {
      status: 'drafted',
      unread: false,
      draftBody: body,
      ...(artifactId ? { artifactId } : {}),
    } as any);
  }
  try {
    res.json(await callMcp('gmail', { action: 'draft', ...req.body }));
  } catch (err: any) {
    res.status(502).json({ error: `email draft failed: ${err?.message || 'unknown error'}` });
  }
}));

emailRouter.patch('/:id', asyncHandler(async (req, res) => {
  const item = await emailStore.update(String(req.params.id), req.body);
  if (!item) {
    res.status(404).json({ error: 'email not found' });
    return;
  }
  res.json(item);
}));
