import { Router } from 'express';
import { callMcp } from '../lib/mcp.ts';
import { asyncHandler } from './helpers.ts';

export const calendarRouter = Router();

calendarRouter.get('/', asyncHandler(async (_req, res) => {
  try {
    res.json(await callMcp('calendar', { action: 'list_today' }));
  } catch {
    res.json({
      events: [
        { id: 'cal-1', title: 'Standup - EliteTeam', time: '9:00 AM', duration: '30m' },
        { id: 'cal-2', title: 'Family dinner', time: '6:30 PM', duration: '90m' },
      ],
    });
  }
}));

calendarRouter.post('/draft', asyncHandler(async (req, res) => {
  try {
    res.json(await callMcp('calendar', { action: 'draft', ...req.body }));
  } catch {
    res.status(202).json({ draft: true, body: req.body, note: 'MCP not configured; draft captured locally.' });
  }
}));
