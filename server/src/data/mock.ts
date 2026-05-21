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
  aiModel?: 'claude' | 'codex' | 'mandrill';
  repo?: string;
  toolName?: string;
  deliveryChannel?: string;
  maxTokens?: number;
  status: string;
  runtime?: 'railway' | 'local';
  cwd?: string;
  permissionMode?: string;
  source?: 'assistant-mcp' | 'autosam';
  sourceLabel?: string;
  readOnly?: boolean;
  lastRun: string;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastRunError?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

// All seeds intentionally empty. Rivendell rooms must reflect real upstream
// data (assistant-mcp admin API on Railway, MCP /tools/call, or local
// Supabase). When upstream is unreachable the client gets [] / 502 and shows
// an empty-or-error state — never fabricated content.
export const tasks: any[] = [];
export const emails: any[] = [];
export const messages: any[] = [];
export const family: any[] = [];
export const docs: any[] = [];
export const plEntries: any[] = [];
export const cronJobs: CronJob[] = [];
export const jobs: RivendellJob[] = [];
export const events: ScribeEvent[] = [];

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
