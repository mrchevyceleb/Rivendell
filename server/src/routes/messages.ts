import { Router } from 'express';
import { callMcp } from '../lib/mcp.ts';
import { messageStore } from '../lib/roomStores.ts';
import { asyncHandler } from './helpers.ts';

export const messagesRouter = Router();

messagesRouter.get('/', asyncHandler(async (_req, res) => {
  // Ravens unified-inbox tool isn't built in assistant-mcp yet. Return 502
  // with a clear error rather than mock messages — the room should be
  // honestly empty/errored until the upstream tool exists.
  try {
    res.json(await callMcp('messages', { action: 'list_unified' }));
  } catch (err: any) {
    res.status(502).json({
      error: `messages upstream failed: ${err?.message || 'unknown error'}`,
      hint: 'A unified messages tool (slack + telegram + twilio) is not yet exposed by assistant-mcp.',
    });
  }
}));

messagesRouter.post('/draft', asyncHandler(async (req, res) => {
  const id = typeof req.body.id === 'string' ? req.body.id : '';
  const text = String(req.body.text || req.body.draftText || '').trim();
  if (id) await messageStore.update(id, { status: 'drafted', draftText: text } as any);
  try {
    res.json(await callMcp('messages', { action: 'draft', ...req.body }));
  } catch (err: any) {
    res.status(502).json({ error: `messages draft failed: ${err?.message || 'unknown error'}` });
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
