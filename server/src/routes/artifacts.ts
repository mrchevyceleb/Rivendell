import { Router } from 'express';
import {
  CONTENT_TYPES,
  createArtifact,
  deleteArtifact,
  getArtifact,
  listArtifacts,
  readArtifactContent,
  type ArtifactKind,
  type ArtifactSource,
} from '../lib/artifactStore.ts';
import { asyncHandler } from './helpers.ts';

export const artifactsRouter = Router();

const KINDS: ArtifactKind[] = ['html', 'markdown', 'text'];

artifactsRouter.get('/', asyncHandler(async (_req, res) => {
  res.json(await listArtifacts());
}));

artifactsRouter.post('/', asyncHandler(async (req, res) => {
  const kind = req.body?.kind;
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content : '';

  if (!KINDS.includes(kind)) {
    res.status(400).json({ error: `kind must be one of ${KINDS.join(', ')}` });
    return;
  }
  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  const source = sanitizeSource(req.body?.source);
  const record = await createArtifact({ kind, title, content, source });
  res.json(record);
}));

artifactsRouter.get('/:id', asyncHandler(async (req, res) => {
  const record = await getArtifact(String(req.params.id));
  if (!record) {
    res.status(404).json({ error: 'artifact not found' });
    return;
  }
  res.json(record);
}));

artifactsRouter.get('/:id/content', asyncHandler(async (req, res) => {
  const result = await readArtifactContent(String(req.params.id));
  if (!result) {
    res.status(404).json({ error: 'artifact not found' });
    return;
  }
  res.setHeader('Content-Type', CONTENT_TYPES[result.record.kind]);
  res.setHeader('Cache-Control', 'no-store');
  res.send(result.content);
}));

artifactsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const ok = await deleteArtifact(String(req.params.id));
  if (!ok) {
    res.status(404).json({ error: 'artifact not found' });
    return;
  }
  res.status(204).end();
}));

function sanitizeSource(input: unknown): ArtifactSource | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const source = input as Record<string, unknown>;
  const kind = source.kind;
  if (kind !== 'chat' && kind !== 'job' && kind !== 'email' && kind !== 'manual') return undefined;
  const ref = typeof source.ref === 'string' ? source.ref : undefined;
  return ref ? { kind, ref } : { kind };
}
