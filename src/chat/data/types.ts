// Shared types between mock + real-backend data shapes.

export type CompanionId = 'claude' | 'codex' | 'assistant' | 'banana';

// A live session reported by /api/live — used to mark "running now" entries
// in the chronicle ribbon.
export type LiveSession = {
  cli: CompanionId;
  cwd: string;
  chatId: string;
  repoName: string;
  busy: boolean;
  sessionId: string | null;
  lastActivityAt: number;
};

export type Repo = {
  path: string;        // absolute filesystem path
  name: string;        // display name (basename of path)
  branch?: string;
  hub?: string;        // grouping label (e.g., "Personal-Apps", "The Hub")
  pinned?: boolean;
  isAssistantHub?: boolean;
  // Mock/UI-only flags below — synthesized from chronicle data later.
  recent?: string;
  awaits?: boolean;
  italic?: boolean;
};

export type CommandEntry = {
  name: string;
  title?: string;
  description?: string;
};

export type CommandCatalog = {
  claude: CommandEntry[];
  codex: CommandEntry[];
  banana: CommandEntry[];
};

export type ChatImagePreview = {
  mediaType: string;
  dataUrl: string;
};

// Re-export for places that use it — kept here since it's a UI-facing type.

// Conversation block — the renderable unit in the chat thread.
// `turnId` + `cbIndex` correlate a block back to claude's content_block_*
// stream events so the reducer stays pure (no out-of-band Maps).
export type ChatBlock =
  | { kind: 'user'; id: string; text: string; ts: number; images?: ChatImagePreview[]; imageCount?: number }
  | {
      kind: 'text';
      id: string;
      text: string;
      ts: number;
      folio?: string;
      turnId?: string;
      cbIndex?: number;
      open?: boolean;
    }
  | {
      kind: 'tool';
      id: string;
      toolUseId: string;
      tool: string;
      args: string;
      result?: string;
      running: boolean;
      ts: number;
      turnId?: string;
      cbIndex?: number;
      open?: boolean;
    }
  | {
      kind: 'doc-link';
      id: string;
      ts: number;
      path: string;
      title?: string;
      turnId?: string;
      cbIndex?: number;
    }
  | {
      kind: 'folder-link';
      id: string;
      ts: number;
      path: string;
      title?: string;
      turnId?: string;
      cbIndex?: number;
    }
  | {
      kind: 'artifact';
      id: string;
      ts: number;
      artifactId: string;
      artifactKind: 'html' | 'markdown' | 'text';
      title: string;
      turnId?: string;
      cbIndex?: number;
    };
