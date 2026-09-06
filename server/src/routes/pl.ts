import { Router } from 'express';
import { callMcp } from '../lib/mcp.ts';
import { asyncHandler } from './helpers.ts';

export const plRouter = Router();

type PlTransactionsResponse = { transactions?: any[] };

async function listTransactions(): Promise<any[]> {
  const data = await callMcp<PlTransactionsResponse>('plTracker', { action: 'plt_list_transactions' });
  return data?.transactions ?? [];
}

function toPlEntry(row: any) {
  return {
    id: row.id,
    label: row.name ?? row.label ?? '(unnamed)',
    type: row.type,
    amount: row.amount,
    account: row.categories?.name ?? row.account ?? '',
    date: row.date,
  };
}

plRouter.get('/', asyncHandler(async (_req, res) => {
  // assistant-mcp's plTracker router uses prefixed action names
  // (plt_list_transactions etc.) and returns { transactions: [...] }.
  // Map to the frontend PlEntry shape so the Reckoning room renders labels.
  try {
    const rows = await listTransactions();
    res.json(rows.map(toPlEntry));
  } catch (err: any) {
    res.status(502).json({ error: `pl upstream failed: ${err?.message || 'unknown error'}` });
  }
}));

plRouter.post('/', asyncHandler(async (req, res) => {
  try {
    res.json(await callMcp('plTracker', { action: 'plt_create_transaction', ...req.body }));
  } catch (err: any) {
    res.status(502).json({ error: `pl create failed: ${err?.message || 'unknown error'}` });
  }
}));

plRouter.get('/export.csv', asyncHandler(async (_req, res) => {
  try {
    const rows = await listTransactions();
    const csv = [
      ['date', 'type', 'name', 'amount', 'notes'],
      ...rows.map((row: any) => [row.date, row.type, row.name, row.amount, row.notes]),
    ].map((row) => row.map(csvCell).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tardis-pl.csv"');
    res.send(`${csv}\n`);
  } catch (err: any) {
    res.status(502).json({ error: `pl export failed: ${err?.message || 'unknown error'}` });
  }
}));

plRouter.delete('/:id', asyncHandler(async (req, res) => {
  try {
    res.json(await callMcp('plTracker', { action: 'plt_delete_transaction', id: req.params.id }));
  } catch (err: any) {
    res.status(502).json({ error: `pl delete failed: ${err?.message || 'unknown error'}` });
  }
}));

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
