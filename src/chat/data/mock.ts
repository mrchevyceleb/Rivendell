// Mock data — used for chronicle/stats/hubs until those are wired to live data.
// Repos and chat blocks come from the real backend (see useRepos / useChat).

import type { CompanionId, Repo } from './types';

export type { CompanionId, Repo };

export type Companion = {
  id: CompanionId;
  name: string;
  sub: string;
};

export const COMPANIONS: Companion[] = [
  { id: 'claude', name: 'Claude Code', sub: 'full-bodied · tools · 200k window' },
  { id: 'codex', name: 'Codex', sub: 'quick of foot · OpenAI' },
  { id: 'assistant', name: 'Assistant', sub: 'tends the hub itself' },
];

// Used as a placeholder before /api/repos resolves, and for the mobile SETUP fallback.
export const ASSISTANT_HUB: Repo = {
  path: '/Users/mjohnst/Library/CloudStorage/OneDrive-Personal/Documents/ASSISTANT-HUB',
  name: 'ASSISTANT-HUB',
  branch: 'master',
  hub: 'The Hub',
  pinned: true,
  isAssistantHub: true,
};

export const SPECIAL_REPOS: Repo[] = [
  { path: '__resume__', name: 'resume an errand…', italic: true },
  { path: '__just-chat__', name: 'no repository, just chat', italic: true },
];

export type Hub = { name: string; count: number; cozy?: boolean };

export const HUBS: Hub[] = [
  { name: 'Work', count: 4 },
  { name: 'Side projects', count: 2 },
  { name: 'The Shire', count: 1, cozy: true },
];

export type ChronicleEventKind = 'ember' | 'gold' | 'moss' | 'ink';

export type ChronicleEvent = {
  id: string;
  t: string;
  title: string;
  repo: string;
  kind: ChronicleEventKind;
  running?: boolean;
  busy?: boolean;
  asleep?: boolean;
  awaits?: boolean;
  done?: boolean;
  status?: string;
};

export const CHRONICLE: ChronicleEvent[] = [
  {
    id: 'evt-1',
    t: '9:43',
    title: 'sundering sidebar',
    repo: 'orchard-ui',
    kind: 'ember',
    running: true,
    status: 'reading 4 files',
  },
  {
    id: 'evt-2',
    t: '9:32',
    title: 'failing migration',
    repo: 'inkwell',
    kind: 'gold',
    awaits: true,
    status: 'awaits leave to rebase',
  },
  {
    id: 'evt-3',
    t: '9:21',
    title: 'prior sidebar pass',
    repo: 'orchard-ui',
    kind: 'moss',
    done: true,
    status: 'finished, branch saved',
  },
  {
    id: 'evt-4',
    t: '8:04',
    title: 'markdown autolinker',
    repo: 'inkwell',
    kind: 'moss',
    done: true,
    status: 'merged into main',
  },
  {
    id: 'evt-5',
    t: 'yest',
    title: 'weekly digest',
    repo: 'mossbank',
    kind: 'ink',
    done: true,
    status: 'rendered to letter',
  },
];

export type Stats = { underway: number; awaits: number; finished: number };
export const STATS: Stats = { underway: 0, awaits: 0, finished: 0 };
