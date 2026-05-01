import { Router } from 'express';
import { fetchAdminCalendarEvents } from '../lib/assistantData.ts';
import { callMcp } from '../lib/mcp.ts';
import { asyncHandler } from './helpers.ts';

export const calendarRouter = Router();

calendarRouter.get('/', asyncHandler(async (_req, res) => {
  // Real upstream only — no hardcoded events. Errors surface as 502 so the
  // UI can show "couldn't reach calendar" instead of fake meetings.
  try {
    res.json(await fetchAdminCalendarEvents());
  } catch (err: any) {
    res.status(502).json({ error: `calendar upstream failed: ${err?.message || 'unknown error'}` });
  }
}));

calendarRouter.post('/draft', asyncHandler(async (req, res) => {
  try {
    res.json(await callMcp('calendar', { action: 'draft', ...req.body }));
  } catch (err: any) {
    res.status(502).json({ error: `calendar draft failed: ${err?.message || 'unknown error'}` });
  }
}));
