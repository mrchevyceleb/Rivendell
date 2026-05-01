import { assistantAdminJson } from './assistantAdmin.ts';

export type RivendellTask = {
  id: string;
  title: string;
  project: string;
  status: 'in_hand' | 'horizon' | 'delegated' | 'done';
  due: string;
  priority: 'low' | 'medium' | 'high';
  repo?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
};

export type RivendellEmail = {
  id: string;
  from: string;
  subject: string;
  account: string;
  age: string;
  unread: boolean;
  status: 'needs_reply' | 'drafted' | 'filed' | 'watching';
  draftBody?: string;
  updatedAt?: string;
};

export type RivendellFamilyItem = {
  id: string;
  title: string;
  area: 'todo' | 'bill' | 'debt' | 'budget' | 'meal';
  owner: string;
  due: string;
  amount?: string;
  completed?: boolean;
  updatedAt?: string;
};

export type RivendellCronJob = {
  id: string;
  name: string;
  description?: string;
  schedule: string;
  target: string;
  actionType?: string;
  prompt?: string;
  toolName?: string;
  deliveryChannel?: string;
  maxTokens?: number;
  status: 'active' | 'paused' | 'failed';
  lastRun: string;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastRunError?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type RivendellQueueJob = {
  id: string;
  created_at: string;
  status: 'queued' | 'running' | 'needs_review' | 'done' | 'failed' | 'cancelled';
  skill: string;
  source?: string;
  source_ref?: string;
  repo?: string;
  prompt?: string;
  result?: unknown;
  error?: string;
  needs_review_reason?: string;
  completed_at?: string;
};

type AdminTask = {
  id: string;
  project?: string | null;
  title?: string | null;
  status?: string | null;
  priority?: string | null;
  due_date?: string | null;
  file_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
};

type AdminEmail = {
  id: string;
  threadId?: string;
  account?: string;
  from?: string;
  subject?: string;
  date?: string;
  snippet?: string;
  labelIds?: string[];
  isUnread?: boolean;
};

type AdminCron = {
  id: string;
  name?: string | null;
  description?: string | null;
  cron_expression?: string | null;
  action_type?: string | null;
  action_config?: Record<string, unknown> | null;
  enabled?: boolean | null;
  last_run_at?: string | null;
  last_run_status?: string | null;
  last_run_error?: string | null;
  delivery_channel?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SamQueueTask = {
  id: string;
  title?: string | null;
  project?: string | null;
  status?: string | null;
  priority?: string | null;
  pr_url?: string | null;
  failure_reason?: string | null;
  auto_merge_blocked_reason?: string | null;
  origin_system?: string | null;
  origin_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export async function fetchAdminTasks(): Promise<RivendellTask[]> {
  const data = await assistantAdminJson<{ tasks?: AdminTask[] }>('/admin/api/tasks');
  return (data.tasks ?? []).map(mapTask).sort(sortTasks);
}

export async function createAdminTask(input: {
  title?: string;
  project?: string;
  due?: string;
  priority?: string;
  status?: RivendellTask['status'];
}): Promise<RivendellTask> {
  const payload = {
    title: input.title || 'New task',
    project: input.project || 'Personal',
    due_date: normalizeDueDate(input.due),
    priority: normalizePriority(input.priority),
  };
  const created = await assistantAdminJson<{ task: AdminTask }>('/admin/api/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (input.status && input.status !== 'horizon') {
    return updateAdminTask(created.task.id, { status: input.status });
  }
  return mapTask(created.task);
}

export async function updateAdminTask(
  id: string,
  updates: Partial<RivendellTask>,
): Promise<RivendellTask> {
  const payload: Record<string, unknown> = {};
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.project !== undefined) payload.project = updates.project;
  if (updates.priority !== undefined) payload.priority = normalizePriority(updates.priority);
  if (updates.due !== undefined) payload.due_date = normalizeDueDate(updates.due);
  if (updates.status !== undefined) payload.status = toAdminTaskStatus(updates.status);

  const data = await assistantAdminJson<{ task: AdminTask }>(`/admin/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return mapTask(data.task);
}

export async function deleteAdminTask(id: string): Promise<void> {
  await assistantAdminJson(`/admin/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchAdminEmails(): Promise<RivendellEmail[]> {
  const params = new URLSearchParams({
    maxResults: '50',
    query: 'in:inbox',
  });
  const data = await assistantAdminJson<{ messages?: AdminEmail[] }>(`/admin/api/email/messages?${params}`);
  return (data.messages ?? []).map(mapEmail);
}

export async function fetchAdminFamily(): Promise<RivendellFamilyItem[]> {
  const [todos, bills, debts, budget, meals] = await Promise.allSettled([
    assistantAdminJson<{ todos?: any[] }>('/admin/api/family/todos'),
    assistantAdminJson<{ bills?: any[] }>('/admin/api/family/bills'),
    assistantAdminJson<{ debts?: any[] }>('/admin/api/family/debts'),
    assistantAdminJson<{ budget?: any }>('/admin/api/family/budget'),
    assistantAdminJson<{ meals?: any[] }>('/admin/api/family/meals'),
  ]);

  const items: RivendellFamilyItem[] = [];
  if (todos.status === 'fulfilled') {
    items.push(...(todos.value.todos ?? []).map((todo) => ({
      id: `todo:${todo.id}`,
      title: todo.title || 'Family task',
      area: 'todo' as const,
      owner: todo.assignee || 'Family',
      due: todo.due_date ? dueLabel(todo.due_date) : todo.recurring_day || 'open',
      completed: Boolean(todo.completed),
      updatedAt: todo.updated_at || todo.created_at,
    })));
  }
  if (bills.status === 'fulfilled') {
    items.push(...(bills.value.bills ?? []).map((bill) => ({
      id: `bill:${bill.id}`,
      title: bill.name || 'Bill',
      area: 'bill' as const,
      owner: bill.category || 'Home',
      due: bill.period || 'recurring',
      amount: money(bill.amount),
      updatedAt: bill.updated_at || bill.created_at,
    })));
  }
  if (debts.status === 'fulfilled') {
    items.push(...(debts.value.debts ?? []).map((debt) => ({
      id: `debt:${debt.id}`,
      title: debt.account_name || 'Debt',
      area: 'debt' as const,
      owner: debt.who || 'Family',
      due: debt.status || `priority ${debt.priority ?? ''}`.trim(),
      amount: money(debt.balance),
      updatedAt: debt.updated_at || debt.created_at,
    })));
  }
  if (budget.status === 'fulfilled' && budget.value.budget) {
    const row = budget.value.budget;
    items.push({
      id: `budget:${row.id || row.month || 'current'}`,
      title: `Budget ${row.month || 'current month'}`,
      area: 'budget',
      owner: 'Family',
      due: row.month || 'current',
      amount: money(row.surplus),
      updatedAt: row.updated_at || row.created_at,
    });
  }
  if (meals.status === 'fulfilled') {
    items.push(...(meals.value.meals ?? []).slice(0, 12).map((meal) => ({
      id: `meal:${meal.id}`,
      title: meal.name || 'Meal',
      area: 'meal' as const,
      owner: meal.meal_type || 'Meal',
      due: meal.day_of_week || meal.week_start || 'planned',
      updatedAt: meal.updated_at || meal.created_at,
    })));
  }

  return items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function updateAdminFamilyItem(id: string, body: Record<string, unknown>): Promise<RivendellFamilyItem> {
  const [kind, rawId] = splitTypedId(id);
  if (kind !== 'todo') throw new Error(`${kind} items are read-only in this room for now`);
  const data = await assistantAdminJson<{ todo: any }>(`/admin/api/family/todos/${encodeURIComponent(rawId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return {
    id: `todo:${data.todo.id}`,
    title: data.todo.title || 'Family task',
    area: 'todo',
    owner: data.todo.assignee || 'Family',
    due: data.todo.due_date ? dueLabel(data.todo.due_date) : data.todo.recurring_day || 'open',
    completed: Boolean(data.todo.completed),
    updatedAt: data.todo.updated_at || data.todo.created_at,
  };
}

export async function createAdminFamilyTodo(input: Record<string, unknown>): Promise<RivendellFamilyItem> {
  const data = await assistantAdminJson<{ todo: any }>('/admin/api/family/todos', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return {
    id: `todo:${data.todo.id}`,
    title: data.todo.title || 'Family task',
    area: 'todo',
    owner: data.todo.assignee || 'Family',
    due: data.todo.due_date ? dueLabel(data.todo.due_date) : data.todo.recurring_day || 'open',
    completed: Boolean(data.todo.completed),
    updatedAt: data.todo.updated_at || data.todo.created_at,
  };
}

export async function fetchAdminCronJobs(): Promise<RivendellCronJob[]> {
  const data = await assistantAdminJson<{ jobs?: AdminCron[] }>('/admin/api/cron/jobs');
  return (data.jobs ?? []).map(mapCron);
}

export async function updateAdminCronJob(id: string, updates: Partial<RivendellCronJob>): Promise<RivendellCronJob> {
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.schedule !== undefined) payload.cron_expression = updates.schedule;
  if (updates.actionType !== undefined) payload.action_type = updates.actionType;
  if (updates.deliveryChannel !== undefined) payload.delivery_channel = updates.deliveryChannel;
  if (updates.status !== undefined) payload.enabled = updates.status === 'active';
  const actionConfig = actionConfigFromCron(updates);
  if (actionConfig) payload.action_config = actionConfig;

  const data = await assistantAdminJson<{ job: AdminCron }>(`/admin/api/cron/jobs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return mapCron(data.job);
}

export async function createAdminCronJob(input: Partial<RivendellCronJob>): Promise<RivendellCronJob> {
  const data = await assistantAdminJson<{ job: AdminCron }>('/admin/api/cron/jobs', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name || 'Rivendell schedule',
      description: input.description || '',
      cron_expression: input.schedule || '0 9 * * *',
      action_type: input.actionType || 'ai_prompt',
      action_config: actionConfigFromCron(input) || { prompt: 'Rivendell scheduled task', max_tokens: 1024 },
      delivery_channel: input.deliveryChannel || 'log_only',
      enabled: input.status !== 'paused',
    }),
  });
  return mapCron(data.job);
}

export async function deleteAdminCronJob(id: string): Promise<void> {
  await assistantAdminJson(`/admin/api/cron/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function runAdminCronJob(id: string): Promise<unknown> {
  return assistantAdminJson(`/admin/api/cron/jobs/${encodeURIComponent(id)}/run`, { method: 'POST' });
}

export async function fetchAdminQueueJobs(): Promise<RivendellQueueJob[]> {
  const data = await assistantAdminJson<{
    ready_to_merge?: SamQueueTask[];
    deploy_failed?: SamQueueTask[];
    failed_early?: SamQueueTask[];
    other?: SamQueueTask[];
  }>('/admin/api/sam-queue');

  return [
    ...(data.ready_to_merge ?? []).map((task) => mapSamQueue(task, 'needs_review', 'ready-to-merge')),
    ...(data.deploy_failed ?? []).map((task) => mapSamQueue(task, 'failed', 'deploy-failed')),
    ...(data.failed_early ?? []).map((task) => mapSamQueue(task, 'failed', 'failed-early')),
    ...(data.other ?? []).map((task) => mapSamQueue(task, mapQueueStatus(task.status), 'samwise')),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function mapTask(task: AdminTask): RivendellTask {
  return {
    id: task.id,
    title: task.title || 'Untitled task',
    project: task.project || 'Personal',
    status: fromAdminTaskStatus(task.status),
    due: dueLabel(task.due_date),
    priority: fromAdminPriority(task.priority),
    repo: task.file_path || undefined,
    createdAt: task.created_at || undefined,
    updatedAt: task.updated_at || undefined,
    completedAt: task.completed_at || null,
  };
}

function fromAdminTaskStatus(status?: string | null): RivendellTask['status'] {
  if (status === 'completed' || status === 'cancelled') return 'done';
  if (status === 'blocked') return 'delegated';
  if (status === 'not_started' || status === 'pending') return 'horizon';
  return 'in_hand';
}

function toAdminTaskStatus(status: RivendellTask['status']): string {
  if (status === 'done') return 'completed';
  if (status === 'delegated') return 'blocked';
  if (status === 'horizon') return 'not_started';
  return 'in_progress';
}

function fromAdminPriority(priority?: string | null): RivendellTask['priority'] {
  if (priority === 'urgent' || priority === 'high') return 'high';
  if (priority === 'low') return 'low';
  return 'medium';
}

function normalizePriority(priority?: string): 'low' | 'medium' | 'high' | 'urgent' {
  if (priority === 'high') return 'high';
  if (priority === 'low') return 'low';
  return 'medium';
}

function sortTasks(a: RivendellTask, b: RivendellTask): number {
  const order = ['in_hand', 'horizon', 'delegated', 'done'];
  const statusDelta = order.indexOf(a.status) - order.indexOf(b.status);
  if (statusDelta) return statusDelta;
  return dueRank(a.due) - dueRank(b.due);
}

function mapEmail(email: AdminEmail): RivendellEmail {
  const unread = Boolean(email.isUnread);
  return {
    id: email.id || email.threadId || `${email.account}:${email.subject}`,
    from: fromName(email.from || ''),
    subject: email.subject || '(no subject)',
    account: email.account || 'mail',
    age: email.date ? timeAgo(email.date) : 'unknown',
    unread,
    status: email.labelIds?.includes('DRAFT') ? 'drafted' : unread ? 'needs_reply' : 'filed',
    updatedAt: email.date,
  };
}

function mapCron(job: AdminCron): RivendellCronJob {
  const actionType = job.action_type || 'ai_prompt';
  const prompt = typeof job.action_config?.prompt === 'string' ? job.action_config.prompt : undefined;
  const toolName = typeof job.action_config?.tool_name === 'string' ? job.action_config.tool_name : undefined;
  const maxTokens = typeof job.action_config?.max_tokens === 'number' ? job.action_config.max_tokens : undefined;
  const toolTarget =
    toolName || (actionType === 'ai_prompt' && prompt ? 'AI prompt' : actionType || 'scheduled job');
  return {
    id: job.id,
    name: job.name || 'Scheduled job',
    description: job.description || undefined,
    schedule: job.cron_expression || 'manual',
    target: toolTarget,
    actionType,
    prompt,
    toolName,
    deliveryChannel: job.delivery_channel || undefined,
    maxTokens,
    status: job.last_run_status === 'failed' ? 'failed' : job.enabled === false ? 'paused' : 'active',
    lastRun: job.last_run_at ? timeAgo(job.last_run_at) : 'never',
    lastRunAt: job.last_run_at || null,
    lastRunStatus: job.last_run_status || null,
    lastRunError: job.last_run_error || null,
    createdAt: job.created_at || undefined,
    updatedAt: job.updated_at || undefined,
  };
}

function actionConfigFromCron(input: Partial<RivendellCronJob>): Record<string, unknown> | null {
  const config: Record<string, unknown> = {};
  if (input.prompt !== undefined) config.prompt = input.prompt;
  if (input.toolName !== undefined) config.tool_name = input.toolName;
  if (input.maxTokens !== undefined) config.max_tokens = Number(input.maxTokens) || 1024;
  return Object.keys(config).length ? config : null;
}

function mapSamQueue(task: SamQueueTask, status: RivendellQueueJob['status'], skill: string): RivendellQueueJob {
  return {
    id: `sam:${task.id}`,
    created_at: task.updated_at || task.created_at || new Date().toISOString(),
    status,
    skill,
    source: task.origin_system || 'samwise',
    source_ref: task.pr_url || task.origin_url || task.id,
    repo: task.project || undefined,
    prompt: task.title || 'Samwise task',
    error: task.failure_reason || undefined,
    needs_review_reason: task.auto_merge_blocked_reason || (status === 'needs_review' ? 'Ready for Matt review.' : undefined),
  };
}

function mapQueueStatus(status?: string | null): RivendellQueueJob['status'] {
  if (status === 'running' || status === 'in_progress') return 'running';
  if (status === 'failed') return 'failed';
  if (status === 'done' || status === 'completed') return 'done';
  if (status === 'cancelled' || status === 'archived') return 'cancelled';
  return 'queued';
}

function splitTypedId(id: string): [string, string] {
  const index = id.indexOf(':');
  if (index === -1) return ['todo', id];
  return [id.slice(0, index), id.slice(index + 1)];
}

function normalizeDueDate(value?: string): string {
  const raw = (value || '').trim().toLowerCase();
  const today = startOfToday();
  if (!raw || raw === 'today' || raw === 'overdue') return isoDay(today);
  if (raw === 'tomorrow') return isoDay(addDays(today, 1));
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return isoDay(today);
}

function dueLabel(value?: string | null): string {
  if (!value) return 'unscheduled';
  const day = parseDay(value);
  if (!day) return value;
  const diff = Math.round((day.getTime() - startOfToday().getTime()) / 86_400_000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return new Intl.DateTimeFormat([], { weekday: 'long' }).format(day);
  return new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' }).format(day);
}

function dueRank(label: string): number {
  if (label === 'overdue') return -1;
  if (label === 'today') return 0;
  if (label === 'tomorrow') return 1;
  return 10;
}

function parseDay(value: string): Date | null {
  const match = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fromName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*<?/);
  return match ? match[1].trim().replace(/"/g, '') : from.split('@')[0] || 'Unknown';
}

function timeAgo(value: string): string {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return value;
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' }).format(new Date(ts));
}

function money(value: unknown): string | undefined {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return undefined;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
}
