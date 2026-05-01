import { randomUUID } from 'node:crypto';

export type JobStatus = 'queued' | 'running' | 'needs_review' | 'done' | 'failed' | 'cancelled';

export type RivendellJob = {
  id: string;
  created_at: string;
  status: JobStatus;
  skill: string;
  source?: string;
  source_ref?: string;
  repo?: string;
  prompt?: string;
  result?: unknown;
  error?: string;
  needs_review_reason?: string;
  approved_at?: string;
  completed_at?: string;
};

export type ScribeEvent = {
  id: string | number;
  job_id?: string;
  ts: string;
  level: 'thinking' | 'tool' | 'note' | 'system' | 'error';
  text: string;
  payload?: unknown;
};

export type CronJob = {
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
  status: string;
  lastRun: string;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastRunError?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export const tasks = [
  { id: 'T-101', title: 'Review Kim funnel copy revision', project: 'KG-KimGarst', status: 'in_hand', due: 'today', priority: 'high', repo: '/Users/mjohnst/samwise/KG-Apps/kim-garst' },
  { id: 'T-102', title: 'Sign EliteTeam Q2 partnership memo', project: 'EliteTeam', status: 'in_hand', due: 'today', priority: 'high', repo: '/Users/mjohnst/samwise/Elite-Apps/elite-dashboard' },
  { id: 'T-103', title: 'Draft YPP Q2 retro deck outline', project: 'YPP', status: 'horizon', due: 'Friday', priority: 'medium' },
  { id: 'T-104', title: 'Renew mattjohnston.io domain', project: 'Personal', status: 'delegated', due: 'overdue', priority: 'high' },
  { id: 'T-105', title: 'CrossFit Threefold programming export review', project: 'Threefold', status: 'delegated', due: 'tomorrow', priority: 'medium' },
];

export const emails = [
  { id: 'E-1', from: 'Kim Garst', subject: 'Re: Funnel V3 - small change', account: 'matt@your-profit-partners.com', age: '14m', unread: true, status: 'needs_reply' },
  { id: 'E-2', from: 'Stripe', subject: 'Receipt for $2,940.00', account: 'matt@eliteteam.ai', age: '1h', unread: false, status: 'filed' },
  { id: 'E-3', from: 'Jess', subject: 'school pickup tomorrow?', account: 'mjohnst@gmail.com', age: '2h', unread: true, status: 'drafted' },
  { id: 'E-4', from: 'Anthropic', subject: 'Your monthly invoice', account: 'matt@mattjohnston.io', age: '3h', unread: false, status: 'watching' },
];

export const messages = [
  { id: 'M-1', channel: '#operly-support', sender: 'Kim', text: 'Can we confirm the ticket response went out?', age: '9m', source: 'slack', status: 'needs_reply' },
  { id: 'M-2', channel: 'Telegram', sender: 'Mom', text: 'What time is Em pickup?', age: '31m', source: 'telegram', status: 'drafted' },
  { id: 'M-3', channel: 'Twilio', sender: 'Threefold lead', text: 'Interested in the 6am Foundations class.', age: '1h', source: 'twilio', status: 'watching' },
  { id: 'M-4', channel: '#deploys', sender: 'Railway', text: 'assistant-mcp deployment completed.', age: '2h', source: 'slack', status: 'filed' },
];

export const family = [
  { id: 'F-1', title: 'Pick up Em from soccer', area: 'todo', owner: 'Matt', due: 'today 5:30 PM' },
  { id: 'F-2', title: 'Order birthday cake for Saturday', area: 'todo', owner: 'Jess', due: 'today' },
  { id: 'F-3', title: 'Amex autopay check', area: 'bill', owner: 'Matt', due: 'May 3', amount: '$1,482' },
  { id: 'F-4', title: 'Grocery plan', area: 'meal', owner: 'Both', due: 'Sunday' },
];

export const docs = [
  { id: 'D-1', title: 'Annual review draft', kind: 'doc', updated: 'yesterday', tags: ['personal', 'planning'] },
  { id: 'D-2', title: 'Programming framework v3', kind: 'reference', updated: 'Monday', tags: ['threefold', 'coaching'] },
  { id: 'D-3', title: 'YPP Q2 retro research', kind: 'note', updated: 'today', tags: ['ypp', 'research'] },
  { id: 'D-4', title: 'EliteTeam memo redline', kind: 'doc', updated: 'today', tags: ['eliteteam', 'legal'] },
];

export const plEntries = [
  { id: 'P-1', label: 'EliteTeam retainer', type: 'income', amount: 6000, account: 'EliteTeam', date: '2026-05-01' },
  { id: 'P-2', label: 'KG funnel project', type: 'income', amount: 2940, account: 'YPP', date: '2026-04-30' },
  { id: 'P-3', label: 'Claude API usage', type: 'expense', amount: 183, account: 'AI tools', date: '2026-04-30' },
  { id: 'P-4', label: 'Railway services', type: 'expense', amount: 96, account: 'Infrastructure', date: '2026-04-29' },
];

export const cronJobs: CronJob[] = [
  { id: 'C-1', name: 'Kim dashboard prep', schedule: 'Mon/Fri 6:00 AM', target: 'pull-dashboard-data', status: 'active', lastRun: 'today 6:00 AM' },
  { id: 'C-2', name: 'Threefold dashboard prep', schedule: 'Mon/Thu 6:00 AM', target: 'pull-dashboard-data', status: 'active', lastRun: 'Thu 6:00 AM' },
  { id: 'C-3', name: 'Morning briefing', schedule: 'daily 7:00 AM', target: 'draft-email', status: 'active', lastRun: 'today 7:00 AM' },
  { id: 'C-4', name: 'Operly support triage', schedule: 'hourly', target: 'triage-feedback-ticket', status: 'paused', lastRun: 'yesterday' },
];

export const jobs: RivendellJob[] = [
  { id: 'J-1', created_at: new Date(Date.now() - 42 * 60_000).toISOString(), status: 'needs_review', skill: 'draft-customer-reply', source: 'email', source_ref: 'kim-funnel-v3', prompt: 'Draft a customer reply. Do not send.', needs_review_reason: 'Draft email requires approval before sending.' },
  { id: 'J-2', created_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), status: 'done', skill: 'pull-dashboard-data', source: 'cron', completed_at: new Date(Date.now() - 90 * 60_000).toISOString() },
];

export const events: ScribeEvent[] = [
  { id: 1, ts: new Date(Date.now() - 48 * 60_000).toISOString(), level: 'system', text: 'Rivendell awakened on :8091.' },
  { id: 2, ts: new Date(Date.now() - 18 * 60_000).toISOString(), level: 'thinking', text: 'Watching the employee queue for runnable work.' },
];

export function newJob(input: Partial<RivendellJob> & { skill: string }): RivendellJob {
  return {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    status: 'queued',
    source: 'manual',
    ...input,
  };
}

export function newEvent(input: Omit<ScribeEvent, 'id' | 'ts'> & { ts?: string }): ScribeEvent {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: input.ts ?? new Date().toISOString(),
    ...input,
  };
}
