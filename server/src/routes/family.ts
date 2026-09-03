import { Router } from 'express';
import {
  createAdminFamilyTodo,
  fetchAdminFamily,
  updateAdminFamilyItem,
} from '../lib/assistantData.ts';
import { asyncHandler } from './helpers.ts';

export const familyRouter = Router();

familyRouter.get('/', asyncHandler(async (_req, res) => {
  try {
    res.json(await fetchAdminFamily());
  } catch (err: any) {
    res.status(502).json({ error: `family upstream failed: ${err?.message || 'unknown error'}` });
  }
}));

familyRouter.post('/', asyncHandler(async (req, res) => {
  try {
    const item = await createAdminFamilyTodo({
      title: req.body.title,
      assignee: req.body.owner || req.body.assignee || 'Owner',
      category: req.body.category || 'home',
      due_date: req.body.due_date,
      notes: req.body.notes,
    });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(502).json({ error: `family create failed: ${err?.message || 'unknown error'}` });
  }
}));

familyRouter.patch('/:id', asyncHandler(async (req, res) => {
  try {
    const item = await updateAdminFamilyItem(String(req.params.id), req.body);
    if (!item) {
      res.status(404).json({ error: 'family item not found' });
      return;
    }
    res.json(item);
  } catch (err: any) {
    res.status(502).json({ error: `family update failed: ${err?.message || 'unknown error'}` });
  }
}));

familyRouter.delete('/:id', asyncHandler(async (_req, res) => {
  // Hearth deletes must round-trip through the assistant-mcp admin API so the
  // canonical Supabase tables stay authoritative. Local-only delete removed.
  res.status(501).json({ error: 'family delete not yet wired through assistant-mcp admin API' });
}));
