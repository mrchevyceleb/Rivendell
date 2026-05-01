import { Router } from 'express';
import { callMcp } from '../lib/mcp.ts';
import { messageStore } from '../lib/roomStores.ts';
import { asyncHandler } from './helpers.ts';

export const messagesRouter = Router();

messagesRouter.get('/', asyncHandler(async (_req, res) => {
  try {
    res.json(await callMcp('messages', { action: 'list_unified' }));
  } catch {
    res.json(await messageStore.list());
  }
}));

messagesRouter.post('/draft', asyncHandler(async (req, res) => {
  const id = typeof req.body.id === 'string' ? req.body.id : '';
  const text = String(req.body.text || req.body.draftText || '').trim();
  if (id) await messageStore.update(id, { status: 'drafted', draftText: text } as any);
  try {
    res.json(await callMcp('messages', { action: 'draft', ...req.body }));
  } catch {
    res.status(202).json({ draft: true, body: req.body, note: 'MCP not configured; draft captured locally.' });
  }
}));

messagesRouter.patch('/:id', asyncHandler(async (req, res) => {
  const item = await messageStore.update(String(req.params.id), req.body);
  if (!item) {
    res.status(404).json({ error: 'message not found' });
    return;
  }
  res.json(item);
}));
