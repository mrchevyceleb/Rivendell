// /api/team — agent-to-agent messaging surface (backs the rivendell-team MCP).

import { Router } from 'express';
import { asyncHandler } from './helpers.ts';
import { deliverTeamMessage, teamRoster, teamRecent } from '../chat/teamBus.ts';

export const teamRouter = Router();

teamRouter.get('/', asyncHandler(async (_req, res) => {
  res.json({ agents: teamRoster() });
}));

teamRouter.post('/message', asyncHandler(async (req, res) => {
  const { from, to, text, hop, wait } = req.body ?? {};
  if (typeof to !== 'string' || typeof text !== 'string' || typeof from !== 'string') {
    res.status(400).json({ error: 'from, to and text are required' });
    return;
  }
  const result = await deliverTeamMessage({ from, to, text, hop, wait });
  res.status(result.delivered ? 200 : 422).json(result);
}));

teamRouter.get('/recent', asyncHandler(async (req, res) => {
  const name = String(req.query.name ?? '');
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));
  res.json({ messages: await teamRecent(name, limit) });
}));
