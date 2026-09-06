// Who decides what an agent may do on this computer: the person sitting at
// it. The ship can only ask. Every command is put in front of the user unless
// they have said "always allow" for that exact command in that exact folder,
// and reads, writes and opens outside the workspace copy ask too. Credential
// stores are refused outright, approval or not, so a compromised ship cannot
// talk this machine into handing over its keys.
//
// Two rules keep the layer honest:
//   - Callers pass CANONICAL paths (symlinks already resolved). A lexical
//     check would let `workspace/link -> ~/.ssh` walk straight out.
//   - A grant covers one mode. Allowing a folder for reading never silently
//     allows writing to it or launching things from it.
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { getSettings, saveSettings } from './settings.js';

export type Decision = 'allow' | 'deny';
export type PathMode = 'read' | 'write' | 'open';

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

/** Types the operating system RUNS when you "open" them. Writing one still
 *  asks, and opening one is refused, so an agent can never write a script and
 *  then launch it without the user ever seeing a command. */
export const LAUNCHABLE = new Set([
  '.exe', '.msi', '.msix', '.appx', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl', '.hta',
  '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.jar', '.lnk', '.url',
  '.reg', '.inf', '.sct', '.msc', '.sh', '.command', '.app', '.dmg', '.pkg', '.run', '.bin',
  '.apk', '.deb', '.rpm', '.appimage', '.desktop', '.scpt', '.applescript', '.py', '.rb', '.pl',
]);

export function isLaunchable(target: string): boolean {
  return LAUNCHABLE.has(path.extname(target).toLowerCase());
}

/** A path this machine will not read, write, or run for anyone. */
export function isSecretPath(target: string): boolean {
  const parts = target.split(/[\\/]+/).filter(Boolean);
  for (const part of parts) {
    if (SECRET_SEGMENTS.has(part.toLowerCase())) return true;
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
  if (!on) cancelPendingApprovals();
}

function isInside(root: string | undefined, target: string): boolean {
  if (!root) return false;
  const inside = path.relative(root, target);
  return inside === '' || (!inside.startsWith('..') && !path.isAbsolute(inside));
}

// A standing grant is keyed by what it covers, so nothing widens by accident:
// commands by (folder, command line), paths by (mode, folder).
const SEP = '\u0000';

function commandKey(command: string, cwd: string): string {
  return `${cwd}${SEP}${command}`;
}

function pathKey(mode: PathMode, folder: string): string {
  return `${mode}${SEP}${folder}`;
}

function grants(key: 'allowedCommands' | 'allowedPaths'): string[] {
  return getSettings()[key] ?? [];
}

function remember(key: 'allowedCommands' | 'allowedPaths', value: string): void {
  const current = grants(key);
  if (current.includes(value)) return;
  saveSettings({ [key]: [...current, value].slice(-200) } as never);
}

/** Clear every standing "always allow" (Ship → Forget Approvals). */
export function forgetApprovals(): void {
  saveSettings({ allowedCommands: [], allowedPaths: [] });
}

// One question at a time, a hard cap on how many can be waiting, and a
// generation that lets a disconnect or the master switch throw the queue away:
// a misbehaving ship must not be able to bury the user in dialogs.
const MAX_WAITING = 3;
let waiting = 0;
let generation = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Drop every queued and open approval (link lost, or the switch went off). */
export function cancelPendingApprovals(): void {
  generation += 1;
}

async function ask(options: Electron.MessageBoxOptions, deadline: number): Promise<number> {
  if (waiting >= MAX_WAITING) return -1;
  const mine = generation;
  waiting += 1;
  try {
    const run = async (): Promise<number> => {
      // Nothing is worth asking about once the ship has stopped waiting, or
      // once this batch has been cancelled.
      if (Date.now() > deadline || mine !== generation || !bridgeEnabled()) return -1;
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
      }
      app.focus({ steal: true });
      const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      if (Date.now() > deadline || mine !== generation) return -1;
      return result.response;
    };
    const next = queue.then(run, run);
    queue = next.then(() => undefined, () => undefined);
    return await next;
  } finally {
    waiting -= 1;
  }
}

/** Ask before running a command. A standing grant covers one command line in
 *  one folder: approving `./deploy` in a project must not authorise the same
 *  words somewhere the user never looked. */
export async function approveCommand(command: string, cwd: string, deadline: number): Promise<Decision> {
  if (isSecretPath(cwd)) return 'deny';
  if (grants('allowedCommands').includes(commandKey(command, cwd))) return 'allow';
  const answer = await ask({
    type: 'warning',
    title: 'TARDIS',
    message: 'Run this on your computer?',
    detail: `${command}\n\nin ${cwd}\n\nAn agent on your TARDIS asked for this. If you did not just ask for something like it, say no.`,
    buttons: ['Run once', 'Always allow this exact command here', 'No'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }, deadline);
  if (answer === 1) {
    remember('allowedCommands', commandKey(command, cwd));
    return 'allow';
  }
  return answer === 0 ? 'allow' : 'deny';
}

/** Ask before touching a path. Inside the workspace copy needs no question,
 *  except for writing something the system would later run. */
export async function approvePath(
  target: string,
  mode: PathMode,
  workspaceRoot: string | undefined,
  deadline: number,
): Promise<Decision> {
  if (isSecretPath(target)) return 'deny';
  // Opening runs some file types. Those are never opened from here at all:
  // otherwise "write a file" plus "open it" adds up to running a command
  // without ever showing one.
  if (mode === 'open' && isLaunchable(target)) return 'deny';

  const quiet = mode !== 'write' || !isLaunchable(target);
  if (quiet && isInside(workspaceRoot, target)) return 'allow';
  const folder = path.dirname(target);
  if (quiet && grants('allowedPaths').includes(pathKey(mode, folder))) return 'allow';

  const verb = mode === 'read' ? 'Read' : mode === 'write' ? 'Write' : 'Open';
  const scary = mode === 'write' && isLaunchable(target)
    ? '\n\nThis is a file your computer would RUN if it were opened.'
    : '\n\nThis is outside your workspace folder.';
  const answer = await ask({
    type: 'warning',
    title: 'TARDIS',
    message: `${verb} this file on your computer?`,
    detail: `${target}${scary}\n\nAn agent on your TARDIS asked for it.`,
    buttons: [`${verb} once`, `Always allow ${verb.toLowerCase()} in ${folder}`, 'No'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }, deadline);
  if (answer === 1) {
    remember('allowedPaths', pathKey(mode, folder));
    return 'allow';
  }
  return answer === 0 ? 'allow' : 'deny';
}
