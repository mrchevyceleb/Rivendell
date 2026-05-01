import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATE_DIR } from '../config.ts';
import { tasks as seedTasks } from '../data/mock.ts';

export type TaskStatus = 'in_hand' | 'horizon' | 'delegated' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export type StoredTask = {
  id: string;
  title: string;
  project: string;
  status: TaskStatus;
  due: string;
  priority: TaskPriority;
  repo?: string;
  order?: number;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
};

const TASKS_FILE = join(STATE_DIR, 'tasks.json');
const STATUS_ORDER: TaskStatus[] = ['in_hand', 'horizon', 'delegated', 'done'];

export async function listTasks(): Promise<StoredTask[]> {
  return sortTasks(await readTasks());
}

export async function createTask(input: Partial<StoredTask> & { title?: string }): Promise<StoredTask> {
  const title = input.title?.trim();
  if (!title) throw new Error('Task title is required');

  const tasks = await readTasks();
  const now = new Date().toISOString();
  const task: StoredTask = {
    id: randomUUID(),
    title,
    project: input.project?.trim() || 'Personal',
    status: input.status ?? 'in_hand',
    due: input.due?.trim() || 'today',
    priority: input.priority ?? 'medium',
    repo: input.repo,
    createdAt: now,
    updatedAt: now,
    completedAt: input.status === 'done' ? now : null,
  };

  const next = normalizeOrders([task, ...tasks]);
  await writeTasks(next);
  return next.find((item) => item.id === task.id) ?? task;
}

export async function updateTask(id: string, patch: Partial<StoredTask>): Promise<StoredTask | null> {
  const tasks = await readTasks();
  const index = tasks.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const previous = tasks[index];
  const status = patch.status ?? previous.status;
  const now = new Date().toISOString();
  const nextTask: StoredTask = {
    ...previous,
    ...patch,
    id: previous.id,
    status,
    updatedAt: now,
    completedAt: status === 'done' ? previous.completedAt ?? now : null,
  };
  const next = normalizeOrders(tasks.map((item) => (item.id === id ? nextTask : item)));
  await writeTasks(next);
  return next.find((item) => item.id === id) ?? nextTask;
}

export async function moveTask(id: string, status: TaskStatus, index: number): Promise<StoredTask[]> {
  const tasks = await readTasks();
  const moving = tasks.find((item) => item.id === id);
  if (!moving) throw new Error('task not found');

  const now = new Date().toISOString();
  const updatedMoving: StoredTask = {
    ...moving,
    status,
    updatedAt: now,
    completedAt: status === 'done' ? moving.completedAt ?? now : null,
  };
  const rest = tasks.filter((item) => item.id !== id);
  const beforeTarget = rest.filter((item) => item.status !== status);
  const target = rest.filter((item) => item.status === status);
  const boundedIndex = Math.max(0, Math.min(index, target.length));
  target.splice(boundedIndex, 0, updatedMoving);

  const next = normalizeOrders([...beforeTarget, ...target]);
  await writeTasks(next);
  return sortTasks(next);
}

export async function deleteTask(id: string): Promise<boolean> {
  const tasks = await readTasks();
  const next = tasks.filter((item) => item.id !== id);
  if (next.length === tasks.length) return false;
  await writeTasks(normalizeOrders(next));
  return true;
}

async function readTasks(): Promise<StoredTask[]> {
  try {
    const raw = await readFile(TASKS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeOrders(parsed);
  } catch {
    // Fall through to seed state.
  }
  const seeded = normalizeOrders(seedTasks.map((task) => ({ ...task, completedAt: null } as StoredTask)));
  await writeTasks(seeded);
  return seeded;
}

async function writeTasks(tasks: StoredTask[]): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(TASKS_FILE, `${JSON.stringify(normalizeOrders(tasks), null, 2)}\n`, 'utf8');
}

function normalizeOrders(tasks: StoredTask[]): StoredTask[] {
  const now = new Date().toISOString();
  return STATUS_ORDER.flatMap((status) =>
    tasks
      .filter((task) => task.status === status)
      .map((task, order) => ({
        ...task,
        order,
        createdAt: task.createdAt ?? now,
        updatedAt: task.updatedAt ?? now,
      })),
  );
}

function sortTasks(tasks: StoredTask[]): StoredTask[] {
  return [...tasks].sort((a, b) => {
    const statusDelta = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (statusDelta) return statusDelta;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}
