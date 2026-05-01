import { Router } from 'express';
import { callMcp } from '../lib/mcp.ts';
import { fetchAdminEmails } from '../lib/assistantData.ts';
import { emailStore } from '../lib/roomStores.ts';
import { asyncHandler } from './helpers.ts';

export const emailRouter = Router();

emailRouter.get('/', asyncHandler(async (_req, res) => {
  try {
    res.json(await fetchAdminEmails());
  } catch {
    try {
      const data = await callMcp('gmail', { action: 'list_unified' });
      res.json(data);
    } catch {
      res.json(await emailStore.list());
    }
  }
}));

emailRouter.post('/draft', asyncHandler(async (req, res) => {
  const id = typeof req.body.id === 'string' ? req.body.id : '';
  const body = String(req.body.body || req.body.draftBody || '').trim();
  if (id) await emailStore.update(id, { status: 'drafted', unread: false, draftBody: body } as any);
  try {
    res.json(await callMcp('gmail', { action: 'draft', ...req.body }));
  } catch {
    res.status(202).json({ draft: true, body: req.body, note: 'MCP not configured; draft captured locally.' });
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
