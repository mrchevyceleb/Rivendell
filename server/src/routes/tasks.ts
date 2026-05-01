import { Router } from 'express';
import {
  createAdminTask,
  deleteAdminTask,
  fetchAdminTasks,
  updateAdminTask,
  type RivendellTask,
} from '../lib/assistantData.ts';
import { type TaskPriority, type TaskStatus } from '../lib/taskStore.ts';
import { asyncHandler } from './helpers.ts';

export const tasksRouter = Router();

tasksRouter.get('/', asyncHandler(async (_req, res) => {
  try {
    res.json(await fetchAdminTasks());
  } catch (err: any) {
    res.status(502).json({ error: `tasks upstream failed: ${err?.message || 'unknown error'}` });
  }
}));

tasksRouter.post('/', asyncHandler(async (req, res) => {
  try {
    const task = await createAdminTask({
      title: req.body.title,
      project: req.body.project,
      due: req.body.due,
      priority: req.body.priority,
      status: asStatus(req.body.status),
    });
    res.status(201).json(task);
  } catch (err: any) {
    res.status(502).json({ error: `tasks create failed: ${err?.message || 'unknown error'}` });
  }
}));

tasksRouter.post('/move', asyncHandler(async (req, res) => {
  const status = asStatus(req.body.status);
  if (!req.body.id || !status) {
    res.status(400).json({ error: 'id and valid status are required' });
    return;
  }
  try {
    await updateAdminTask(String(req.body.id), { status });
    res.json(await fetchAdminTasks());
  } catch (err: any) {
    res.status(502).json({ error: `tasks move failed: ${err?.message || 'unknown error'}` });
  }
}));

tasksRouter.patch('/:id', asyncHandler(async (req, res) => {
  const updates = {
    title: typeof req.body.title === 'string' ? req.body.title : undefined,
    project: typeof req.body.project === 'string' ? req.body.project : undefined,
    due: typeof req.body.due === 'string' ? req.body.due : undefined,
    priority: asPriority(req.body.priority),
    status: asStatus(req.body.status),
  } satisfies Partial<RivendellTask>;
  try {
    const task = await updateAdminTask(String(req.params.id), updates);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    res.json(task);
  } catch (err: any) {
    res.status(502).json({ error: `tasks update failed: ${err?.message || 'unknown error'}` });
  }
}));

tasksRouter.delete('/:id', asyncHandler(async (req, res) => {
  try {
    await deleteAdminTask(String(req.params.id));
    res.status(204).end();
  } catch (err: any) {
    res.status(502).json({ error: `tasks delete failed: ${err?.message || 'unknown error'}` });
  }
}));

function asStatus(value: unknown): TaskStatus | undefined {
  return value === 'in_hand' || value === 'horizon' || value === 'delegated' || value === 'done' ? value : undefined;
}

function asPriority(value: unknown): TaskPriority | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}
