import { Router } from 'express';
import { fetchAdminDocs } from '../lib/assistantData.ts';
import { hasSupabase, readTable } from '../lib/supabase.ts';
import {
  OUTSIDE_WORKSPACE,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  readWorkspaceChildren,
  readWorkspaceFile,
  readWorkspaceFileForEdit,
  readWorkspaceTree,
  renameWorkspaceEntry,
  writeWorkspaceFile,
  WORKSPACE_DISPLAY_LABEL,
  WORKSPACE_DISPLAY_PATH,
} from '../lib/workspace.ts';
import { emitScribe } from '../worker/scribe.ts';
import { asyncHandler } from './helpers.ts';

function mapWorkspaceError(err: any): { status: number; message: string } {
  const code: string = err?.code ?? '';
  const msg: string = err?.message ?? 'unknown error';
  if (code === 'ENOENT') return { status: 404, message: msg };
  if (code === 'EEXIST') return { status: 409, message: msg };
  if (code === 'EISDIR' || code === 'ENOTDIR') return { status: 400, message: msg };
  if (code === 'EACCES' || code === 'EPERM' || code === 'EHUBPOLICY') return { status: 403, message: msg };
  if (code === 'ECONFLICT') return { status: 409, message: msg };
  if (code === 'E2BIG') return { status: 413, message: msg };
  if (msg.includes(OUTSIDE_WORKSPACE)) return { status: 400, message: msg };
  return { status: 500, message: msg };
}

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

docsRouter.get('/tree', asyncHandler(async (req, res) => {
  const hideLegacy = String(req.query.hideLegacy ?? 'true') !== 'false';
  res.json(await readWorkspaceTree({ hideLegacy }));
}));

docsRouter.get('/children', asyncHandler(async (req, res) => {
  const path = String(req.query.path || '');
  const hideLegacy = String(req.query.hideLegacy ?? 'true') !== 'false';
  res.json(await readWorkspaceChildren(path, { hideLegacy }));
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
  res.status(501).json({ error: 'doc creation must go through the assistant-mcp admin API' });
}));

// --- Workspace write endpoints ---

docsRouter.get('/file/edit', asyncHandler(async (req, res) => {
  const path = String(req.query.path || '');
  if (!path) { res.status(400).json({ error: 'path is required' }); return; }
  try {
    res.json(await readWorkspaceFileForEdit(path));
  } catch (err) {
    const { status, message } = mapWorkspaceError(err);
    res.status(status).json({ error: message });
  }
}));

docsRouter.put('/file', asyncHandler(async (req, res) => {
  const { path, content, expectedModifiedAt } = req.body ?? {};
  if (!path || typeof content !== 'string') { res.status(400).json({ error: 'path and content are required' }); return; }
  try {
    const result = await writeWorkspaceFile(path, content, { expectedModifiedAt });
    await emitScribe({ level: 'system', text: `Workspace: saved ${result.path}`, payload: { kind: 'workspace-change', op: 'change', path: result.path, by: 'human' } });
    res.json(result);
  } catch (err) {
    const { status, message } = mapWorkspaceError(err);
    res.status(status).json({ error: message });
  }
}));

docsRouter.post('/file', asyncHandler(async (req, res) => {
  const { path, kind } = req.body ?? {};
  if (!path || (kind !== 'file' && kind !== 'directory')) { res.status(400).json({ error: 'path and kind (file|directory) are required' }); return; }
  try {
    const node = await createWorkspaceEntry(path, kind);
    await emitScribe({ level: 'system', text: `Workspace: created ${path}`, payload: { kind: 'workspace-change', op: kind === 'directory' ? 'addDir' : 'add', path, by: 'human' } });
    res.status(201).json({ node });
  } catch (err) {
    const { status, message } = mapWorkspaceError(err);
    res.status(status).json({ error: message });
  }
}));

docsRouter.post('/rename', asyncHandler(async (req, res) => {
  const { from, to } = req.body ?? {};
  if (!from || !to) { res.status(400).json({ error: 'from and to are required' }); return; }
  try {
    const result = await renameWorkspaceEntry(from, to);
    await emitScribe({ level: 'system', text: `Workspace: renamed ${from} → ${to}`, payload: { kind: 'workspace-change', op: 'unlink', path: from, by: 'human' } });
    res.json(result);
  } catch (err) {
    const { status, message } = mapWorkspaceError(err);
    res.status(status).json({ error: message });
  }
}));

docsRouter.delete('/file', asyncHandler(async (req, res) => {
  const path = String(req.query.path || '');
  if (!path) { res.status(400).json({ error: 'path is required' }); return; }
  try {
    const result = await deleteWorkspaceEntry(path);
    await emitScribe({ level: 'system', text: `Workspace: deleted ${result.path}`, payload: { kind: 'workspace-change', op: 'unlink', path: result.path, by: 'human' } });
    res.json(result);
  } catch (err) {
    const { status, message } = mapWorkspaceError(err);
    res.status(status).json({ error: message });
  }
}));
