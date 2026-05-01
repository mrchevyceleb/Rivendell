import { Router } from 'express';
import { latestEvents } from '../worker/scribe.ts';
import { asyncHandler } from './helpers.ts';

export const scribeRouter = Router();

scribeRouter.get('/events', asyncHandler(async (_req, res) => {
  res.json(latestEvents());
}));
