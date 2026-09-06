// Who decides what an agent may do on this computer: the person sitting at
// it. The ship can only ask. Every command is put in front of the user unless
// they have said "always allow" for that exact command, and reads and writes
// outside the workspace copy ask too. Credential stores are refused outright,
// approval or not, so a compromised ship cannot talk this machine into handing
// over its keys.
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { getSettings, saveSettings } from './settings.js';

export type Decision = 'allow' | 'deny';

// Path segments (and file names) that never leave this machine.
const SECRET_SEGMENTS = new Set([
  '.ssh', '.aws', '.gnupg', '.gpg', '.kube', '.docker', '.azure', '.gcloud',
  '.password-store', '.rivendell', 'keychains', '.mozilla', '.putty',
]);
const SECRET_FILES = new Set([
  '.npmrc', '.netrc', '_netrc', '.git-credentials', '.pgpass', '.env',
  'credentials', 'login data', 'key3.db', 'key4.db', 'logins.json', 'shadow',
]);
const SECRET_PREFIXES = ['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'];

/** A path this machine will not read or write for anyone. */
export function isSecretPath(target: string): boolean {
  const parts = target.split(/[\\/]+/).filter(Boolean);
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (SECRET_SEGMENTS.has(lower)) return true;
  }
  const leaf = (parts[parts.length - 1] ?? '').toLowerCase();
  if (SECRET_FILES.has(leaf)) return true;
  return SECRET_PREFIXES.some((prefix) => leaf.startsWith(prefix));
}

export function bridgeEnabled(): boolean {
  return getSettings().bridgeEnabled !== false;
}

export function setBridgeEnabled(on: boolean): void {
  saveSettings({ bridgeEnabled: on });
}

function isInside(root: string | undefined, target: string): boolean {
  if (!root) return false;
  const inside = path.relative(root, target);
  return inside === '' || (!inside.startsWith('..') && !path.isAbsolute(inside));
}

function allowedCommands(): string[] {
  return getSettings().allowedCommands ?? [];
}

function allowedPaths(): string[] {
  return getSettings().allowedPaths ?? [];
}

function remember(key: 'allowedCommands' | 'allowedPaths', value: string): void {
  const current = key === 'allowedCommands' ? allowedCommands() : allowedPaths();
  if (current.includes(value)) return;
  saveSettings({ [key]: [...current, value].slice(-200) } as never);
}

/** Clear every standing "always allow" (Ship → Forget Approvals). */
export function forgetApprovals(): void {
  saveSettings({ allowedCommands: [], allowedPaths: [] });
}

// One question at a time: a burst of tool calls must not stack dialogs.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

function ask(options: Electron.MessageBoxOptions): Promise<number> {
  return serialize(async () => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
    }
    app.focus({ steal: true });
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return result.response;
  });
}

/** Ask before running a command. `deadline` is when the ship stops waiting;
 *  an answer that arrives after it is treated as a refusal. */
export async function approveCommand(command: string, cwd: string, deadline: number): Promise<Decision> {
  if (allowedCommands().includes(command)) return 'allow';
  const answer = await ask({
    type: 'warning',
    title: 'TARDIS',
    message: 'Run this on your computer?',
    detail: `${command}\n\nin ${cwd}\n\nAn agent on your TARDIS asked for this. If you did not just ask for something like it, say no.`,
    buttons: ['Run once', 'Always allow this exact command', 'No'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (Date.now() > deadline) return 'deny';
  if (answer === 1) {
    remember('allowedCommands', command);
    return 'allow';
  }
  return answer === 0 ? 'allow' : 'deny';
}

/** Ask before touching a path. Inside the workspace copy needs no question. */
export async function approvePath(
  target: string,
  mode: 'read' | 'write' | 'open',
  workspaceRoot: string | undefined,
  deadline: number,
): Promise<Decision> {
  if (isSecretPath(target)) return 'deny';
  if (isInside(workspaceRoot, target)) return 'allow';
  if (allowedPaths().some((allowed) => isInside(allowed, target))) return 'allow';

  const folder = path.dirname(target);
  const verb = mode === 'read' ? 'Read' : mode === 'write' ? 'Write' : 'Open';
  const answer = await ask({
    type: 'warning',
    title: 'TARDIS',
    message: `${verb} this file on your computer?`,
    detail: `${target}\n\nThis is outside your workspace folder. An agent on your TARDIS asked for it.`,
    buttons: [`${verb} once`, `Always allow ${folder}`, 'No'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (Date.now() > deadline) return 'deny';
  if (answer === 1) {
    remember('allowedPaths', folder);
    return 'allow';
  }
  return answer === 0 ? 'allow' : 'deny';
}
