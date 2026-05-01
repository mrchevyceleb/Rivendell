import { Router } from 'express';
import {
  createAdminTask,
  deleteAdminTask,
  fetchAdminTasks,
  updateAdminTask,
  type RivendellTask,
} from '../lib/assistantData.ts';
import { createTask, deleteTask, listTasks, moveTask, updateTask, type TaskPriority, type TaskStatus } from '../lib/taskStore.ts';
import { asyncHandler } from './helpers.ts';

export const tasksRouter = Router();

tasksRouter.get('/', asyncHandler(async (_req, res) => {
  try {
    res.json(await fetchAdminTasks());
  } catch {
    res.json(await listTasks());
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
  } catch {
    const task = await createTask({
      title: req.body.title,
      project: req.body.project,
      due: req.body.due,
      priority: asPriority(req.body.priority) ?? 'medium',
      status: asStatus(req.body.status) ?? 'in_hand',
    });
    res.status(201).json(task);
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
  } catch {
    res.json(await moveTask(String(req.body.id), status, Number(req.body.index) || 0));
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
  let task: unknown;
  try {
    task = await updateAdminTask(String(req.params.id), updates);
  } catch {
    task = await updateTask(String(req.params.id), updates);
  }
  if (!task) {
    res.status(404).json({ error: 'task not found' });
    return;
  }
  res.json(task);
}));

tasksRouter.delete('/:id', asyncHandler(async (req, res) => {
  try {
    await deleteAdminTask(String(req.params.id));
  } catch {
    const deleted = await deleteTask(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
  }
  res.status(204).end();
}));

function asStatus(value: unknown): TaskStatus | undefined {
  return value === 'in_hand' || value === 'horizon' || value === 'delegated' || value === 'done' ? value : undefined;
}

function asPriority(value: unknown): TaskPriority | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}
