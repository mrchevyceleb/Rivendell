import { Router } from 'express';
import { createAdminFamilyTodo, fetchAdminFamily, updateAdminFamilyItem } from '../lib/assistantData.ts';
import { familyStore } from '../lib/roomStores.ts';
import { asyncHandler } from './helpers.ts';

export const familyRouter = Router();

familyRouter.get('/', asyncHandler(async (_req, res) => {
  try {
    res.json(await fetchAdminFamily());
  } catch {
    res.json(await familyStore.list());
  }
}));

familyRouter.post('/', asyncHandler(async (req, res) => {
  try {
    const item = await createAdminFamilyTodo({
      title: req.body.title,
      assignee: req.body.owner || req.body.assignee || 'Matt',
      category: req.body.category || 'home',
      due_date: req.body.due_date,
      notes: req.body.notes,
    });
    res.status(201).json(item);
  } catch {
    const item = await familyStore.create({
      area: 'todo',
      owner: 'Matt',
      due: 'today',
      completed: false,
      ...req.body,
    });
    res.status(201).json(item);
  }
}));

familyRouter.patch('/:id', asyncHandler(async (req, res) => {
  let item: unknown;
  try {
    item = await updateAdminFamilyItem(String(req.params.id), req.body);
  } catch {
    item = await familyStore.update(String(req.params.id), req.body);
  }
  if (!item) {
    res.status(404).json({ error: 'family item not found' });
    return;
  }
  res.json(item);
}));

familyRouter.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await familyStore.delete(String(req.params.id));
  if (!deleted) {
    res.status(404).json({ error: 'family item not found' });
    return;
  }
  res.status(204).end();
}));
