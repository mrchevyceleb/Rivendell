import { Router } from 'express';
import { docs } from '../data/mock.ts';
import { readTable } from '../lib/supabase.ts';
import { readWorkspaceChildren, readWorkspaceFile, readWorkspaceTree, workspaceRoot } from '../lib/workspace.ts';
import { asyncHandler } from './helpers.ts';

export const docsRouter = Router();

docsRouter.get('/', asyncHandler(async (_req, res) => {
  res.json(await readTable('mobile_docs', docs));
}));

docsRouter.get('/workspace', asyncHandler(async (_req, res) => {
  res.json({ root: workspaceRoot() });
}));

docsRouter.get('/tree', asyncHandler(async (_req, res) => {
  res.json(await readWorkspaceTree());
}));

docsRouter.get('/children', asyncHandler(async (req, res) => {
  const path = String(req.query.path || '');
  res.json(await readWorkspaceChildren(path));
}));

docsRouter.get('/file', asyncHandler(async (req, res) => {
  const path = String(req.query.path || '');
  if (!path) {
    res.status(400).json({ error: 'path is required' });
    return;
  }
  res.json(await readWorkspaceFile(path));
}));

docsRouter.post('/', asyncHandler(async (req, res) => {
  const doc = { id: crypto.randomUUID(), kind: 'note', updated: 'now', tags: [], ...req.body };
  docs.unshift(doc);
  res.status(201).json(doc);
}));
