export type RoomKey =
  | '/'
  | '/dashboard'
  | '/council'
  | '/tidings'
  | '/hearth'
  | '/library'
  | '/pins'
  | '/reckoning'
  | '/forge'
  | '/weavings'
  | '/annals'
  | '/scribe';

export type Room = {
  key: RoomKey;
  name: string;
  role: string;
  icon: string;
};

export type Task = {
  id: string;
  title: string;
  project: string;
  status: 'in_hand' | 'horizon' | 'delegated' | 'done';
  due: string;
  dueDate?: string | null;
  priority: 'low' | 'medium' | 'high';
  repo?: string;
  order?: number;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
};

export type EmailItem = {
  id: string;
  from: string;
  subject: string;
  account: string;
  age: string;
  unread: boolean;
  status: 'needs_reply' | 'drafted' | 'filed' | 'watching';
  draftBody?: string;
  artifactId?: string;
  updatedAt?: string;
};

export type MessageItem = {
  id: string;
  channel: string;
  sender: string;
  text: string;
  age: string;
  source: 'slack' | 'telegram' | 'twilio';
  status: 'needs_reply' | 'drafted' | 'watching' | 'filed';
  draftText?: string;
  updatedAt?: string;
};

export type FamilyItem = {
  id: string;
  title: string;
  area: 'todo' | 'bill' | 'debt' | 'budget' | 'meal';
  owner: string;
  due: string;
  amount?: string;
  completed?: boolean;
  updatedAt?: string;
};

export type LibraryDoc = {
  id: string;
  title: string;
  kind: 'doc' | 'note' | 'reference';
  updated: string;
  tags: string[];
};

export type PinItem = {
  id: string;
  title: string;
  content: string;
  category: string;
  pinned: boolean;
  color?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type FileTreeNode = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size?: number;
  modifiedAt?: string;
  children?: FileTreeNode[];
  deferred?: boolean;
  error?: string;
};

export type WorkspaceTreeResponse = {
  root: string;
  displayPath: string;
  tree: FileTreeNode;
  fileCount: number;
  dirCount: number;
};

export type WorkspaceChildrenResponse = {
  root: string;
  path: string;
  children: FileTreeNode[];
};

export type WorkspaceFileResponse = {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  language: string;
  content: string;
  tooLarge: boolean;
};

export type PlEntry = {
  id: string;
  label: string;
  type: 'income' | 'expense';
  amount: number;
  account: string;
  date: string;
};

export type CronRuntime = 'railway' | 'local';
export type CronPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'auto'
  | 'bypassPermissions'
  | 'dontAsk'
  | 'plan';

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
  status: 'active' | 'paused' | 'failed';
  runtime: CronRuntime;
  cwd?: string;
  permissionMode?: CronPermissionMode;
  lastRun: string;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastRunError?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type RivendellJobStatus =
  | 'queued'
  | 'running'
  | 'needs_review'
  | 'done'
  | 'failed'
  | 'cancelled';

export type RivendellJob = {
  id: string;
  created_at: string;
  status: RivendellJobStatus;
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

export type ScribeEvent = {
  id: string | number;
  job_id?: string;
  ts: string;
  level: 'thinking' | 'tool' | 'note' | 'system' | 'error';
  text: string;
  payload?: unknown;
};

export type ChronicleEntry = {
  id: string;
  title: string;
  cwd: string;
  repoName: string;
  ts: number;
  running: boolean;
  busy: boolean;
};

export type HallSummary = {
  tasksDue: number;
  unreadEmail: number;
  pendingMessages: number;
  queuedJobs: number;
  runningJobs: number;
  needsReview: number;
};
