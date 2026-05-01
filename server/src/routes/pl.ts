import { Router } from 'express';
import { callMcp } from '../lib/mcp.ts';
import { plStore } from '../lib/roomStores.ts';
import { asyncHandler } from './helpers.ts';

export const plRouter = Router();

plRouter.get('/', asyncHandler(async (_req, res) => {
  try {
    res.json(await callMcp('plTracker', { action: 'list' }));
  } catch {
    res.json(await plStore.list());
  }
}));

plRouter.post('/', asyncHandler(async (req, res) => {
  try {
    res.json(await callMcp('plTracker', { action: 'create', ...req.body }));
  } catch {
    const entry = await plStore.create({ date: new Date().toISOString().slice(0, 10), ...req.body });
    res.status(201).json(entry);
  }
}));

plRouter.get('/export.csv', asyncHandler(async (_req, res) => {
  const rows = await plStore.list();
  const csv = [
    ['date', 'type', 'account', 'label', 'amount'],
    ...rows.map((row: any) => [row.date, row.type, row.account, row.label, row.amount]),
  ].map((row) => row.map(csvCell).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rivendell-pl.csv"');
  res.send(`${csv}\n`);
}));

plRouter.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await plStore.delete(String(req.params.id));
  if (!deleted) {
    res.status(404).json({ error: 'entry not found' });
    return;
  }
  res.status(204).end();
}));

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
