import { Router } from 'express';
import { fetchAdminDocs } from '../lib/assistantData.ts';
import { hasSupabase, readTable } from '../lib/supabase.ts';
import { readWorkspaceChildren, readWorkspaceFile, readWorkspaceTree, WORKSPACE_DISPLAY_LABEL, WORKSPACE_DISPLAY_PATH } from '../lib/workspace.ts';
import { asyncHandler } from './helpers.ts';

export const docsRouter = Router();

docsRouter.get('/', asyncHandler(async (_req, res) => {
  // Prefer direct Supabase if configured locally, otherwise the assistant-mcp
  // admin endpoint. No mock fallback — real data or 502.
  try {
    if (hasSupabase()) {
      res.json(await readTable('mobile_docs', []));
      return;
    }
    res.json(await fetchAdminDocs());
  } catch (err: any) {
    res.status(502).json({ error: `docs upstream failed: ${err?.message || 'unknown error'}` });
  }
}));

docsRouter.get('/workspace', asyncHandler(async (_req, res) => {
  res.json({ root: WORKSPACE_DISPLAY_LABEL, displayPath: WORKSPACE_DISPLAY_PATH });
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

docsRouter.post('/', asyncHandler(async (_req, res) => {
  // Local-only doc creation removed: docs are managed in the
  // assistant-mcp/Supabase mobile_docs table. Use that route to add docs.
  res.status(501).json({ error: 'doc creation must go through the assistant-mcp admin API' });
}));
