import { homedir } from 'node:os';
import { join } from 'node:path';

export const PORT = Number(process.env.PORT) || 8091;

// Where to scan for repos. Each entry is a parent directory; first-level
// children that contain a .git folder are treated as repos.
export const REPO_SCAN_PATHS: string[] = [
  join(homedir(), 'code'),
  join(homedir(), 'Documents', 'PERSONAL-PROJECTS'),
];

// Two-level scan paths: for each entry, look at every subfolder (except
// IGNORED_HUBS), then scan THAT for repos. Lets ~/samwise act as a workspace
// containing hubs (Personal-Apps, KG-Apps, YPP-Apps, Elite-Apps) that each
// hold many repos.
export const REPO_SCAN_HUB_PATHS: string[] = [
  join(homedir(), 'samwise'),
];

// Hub-level subfolders to skip when walking REPO_SCAN_HUB_PATHS.
export const IGNORED_HUB_NAMES = new Set<string>(['worktrees', 'node_modules']);

// The Assistant Hub — surfaced as the "Assistant" companion's repo.
// Moved off OneDrive to a Syncthing-managed local folder. Env override lets
// Windows (where ASSISTANT-HUB lives at C:\ASSISTANT-HUB) point at its real
// location without code changes.
export const ASSISTANT_HUB_PATH =
  process.env.ELROND_WORKSPACE_PATH || join(homedir(), 'ASSISTANT-HUB');

export const CROSS_COMPUTER_SHARE_PATH = join(
  homedir(),
  'Library',
  'CloudStorage',
  'OneDrive-Personal',
  'Documents',
  'CROSS-COMPUTER-SHARE',
);

export const CLAUDE_COMMANDS_DIR = join(CROSS_COMPUTER_SHARE_PATH, 'claude-commands');
export const CODEX_SKILLS_DIR = join(CROSS_COMPUTER_SHARE_PATH, 'skills');
export const BANANA_DIR = join(CROSS_COMPUTER_SHARE_PATH, 'bananacode');
export const BANANA_COMMANDS_DIR = join(BANANA_DIR, 'Commands');
export const BANANA_GLOBAL_INSTRUCTIONS_FILE = join(BANANA_DIR, '.banana.md');

// Where Claude Code persists its session JSONL files.
export const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

// Where Rivendell persists its (repo,cli) -> claude session_id map.
export const STATE_DIR = join(homedir(), '.rivendell');
export const SESSIONS_FILE = join(STATE_DIR, 'chat-sessions.json');
