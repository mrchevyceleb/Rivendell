// Who decides what an agent may do on this computer: the person sitting at
// it. The ship can only ask.
//
// Three rules keep the layer honest:
//   - Callers pass CANONICAL paths (symlinks already resolved). A lexical
//     check would let `workspace/link -> ~/.ssh` walk straight out.
//   - A grant covers one mode. Allowing a folder for reading never silently
//     allows writing to it or launching things from it.
//   - There is no permanent grant for a command. The same words can run
//     different code once a file changes, and the ship can change files in
//     the workspace without asking; so "allow" is either this once, or every
//     command for a short, stated window the user can see ending.
import { app, BrowserWindow, dialog } from 'electron';
import { statSync } from 'node:fs';
import path from 'node:path';
import { getSettings, saveSettings } from './settings.js';

export type Decision = 'allow' | 'deny';
export type PathMode = 'read' | 'write' | 'open';

// Folders whose contents are secrets, wherever they sit.
const SECRET_SEGMENTS = new Set([
  '.ssh', '.aws', '.gnupg', '.gpg', '.kube', '.docker', '.azure', '.gcloud', '.config/gh',
  '.password-store', '.rivendell', '.putty', '.subversion', '.cert', '.pki', '.keys',
  'keychains', 'keyrings', '.mozilla', '.thunderbird', '.netscape',
  'user data', 'profiles', '.secrets', 'secrets',
]);
// Exact file names that are secrets.
const SECRET_FILES = new Set([
  '.npmrc', '.netrc', '_netrc', '.git-credentials', '.pgpass', '.my.cnf', '.dockercfg',
  'credentials', 'credentials.json', 'client_secret.json', 'service-account.json',
  'login data', 'key3.db', 'key4.db', 'logins.json', 'signons.sqlite', 'cookies.sqlite',
  'shadow', 'master.key', 'secring.gpg', 'id_rsa', 'authorized_keys', 'known_hosts',
]);
// Name prefixes and suffixes that are secrets.
const SECRET_PREFIXES = ['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa', '.env', '.masterkey'];
const SECRET_SUFFIXES = [
  '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.ppk', '.asc', '.gpg', '.kdbx',
  '.p8', '.der', '.crt.key', '_rsa', '.secrets.json',
];

/** Types the operating system RUNS when you "open" them. Writing one still
 *  asks, and opening one is refused, so an agent can never write a script and
 *  then launch it without the user ever seeing a command. */
export const LAUNCHABLE = new Set([
  '.exe', '.msi', '.msix', '.appx', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl', '.hta',
  '.ps1', '.psm1', '.psd1', '.vbs', '.vbe', '.wsf', '.wsh', '.js', '.jse', '.mjs', '.cjs',
  '.jar', '.lnk', '.url', '.reg', '.inf', '.sct', '.msc', '.gadget', '.chm',
  '.sh', '.bash', '.zsh', '.fish', '.command', '.tool', '.app', '.dmg', '.pkg', '.mpkg',
  '.run', '.bin', '.out', '.apk', '.deb', '.rpm', '.appimage', '.flatpakref', '.snap',
  '.desktop', '.service', '.scpt', '.applescript', '.workflow', '.action',
  '.py', '.pyw', '.rb', '.pl', '.php', '.lua', '.tcl', '.ahk', '.jsp',
]);

export function isLaunchable(target: string): boolean {
  return LAUNCHABLE.has(path.extname(target).toLowerCase());
}

/** A path this machine will not read, write, or run for anyone. */
export function isSecretPath(target: string): boolean {
  const normalized = target.replace(/\\/g, '/').toLowerCase();
  for (const segment of SECRET_SEGMENTS) {
    if (normalized.includes(`/${segment}/`) || normalized.endsWith(`/${segment}`)) return true;
  }
  const leaf = normalized.split('/').filter(Boolean).pop() ?? '';
  if (SECRET_FILES.has(leaf)) return true;
  if (SECRET_PREFIXES.some((prefix) => leaf.startsWith(prefix))) return true;
  return SECRET_SUFFIXES.some((suffix) => leaf.endsWith(suffix));
}

/** True when the system would run this rather than display it: a known
 *  launchable type, something with no extension at all, or (on macOS and
 *  Linux) a file carrying the execute bit. */
export function wouldRun(target: string): boolean {
  if (isLaunchable(target)) return true;
  if (!path.extname(target)) return true;
  if (process.platform === 'win32') return false;
  try {
    const info = statSync(target);
    return info.isFile() && (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function bridgeEnabled(): boolean {
  return getSettings().bridgeEnabled !== false;
}

export function setBridgeEnabled(on: boolean): void {
  saveSettings({ bridgeEnabled: on });
  if (!on) {
    trustUntil = 0;
    cancelPendingApprovals();
  }
}

function isInside(root: string | undefined, target: string): boolean {
  if (!root) return false;
  const inside = path.relative(root, target);
  return inside === '' || (!inside.startsWith('..') && !path.isAbsolute(inside));
}

// Blanket permission for commands, in minutes rather than forever, and only
// in memory: quitting the app ends it.
const TRUST_MS = 15 * 60 * 1000;
let trustUntil = 0;

export function commandTrustRemainingMs(): number {
  return Math.max(0, trustUntil - Date.now());
}

// A standing path grant is keyed by mode and folder, so nothing widens by
// accident. A NUL cannot appear in a path, so no two grants can be confused.
const SEP = '\u0000';

function pathKey(mode: PathMode, folder: string): string {
  return `${mode}${SEP}${folder}`;
}

function pathGrants(): string[] {
  return getSettings().allowedPaths ?? [];
}

/** Clear every standing allowance (Ship → Forget Approvals). */
export function forgetApprovals(): void {
  trustUntil = 0;
  saveSettings({ allowedPaths: [] });
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

/** Ask before running a command. Either this once, or everything for the next
 *  fifteen minutes: an "always allow this command" would be a permanent
 *  capability that later edits to a script or a package file could quietly
 *  turn into something else. */
export async function approveCommand(command: string, cwd: string, deadline: number): Promise<Decision> {
  if (isSecretPath(cwd)) return 'deny';
  if (Date.now() < trustUntil) return 'allow';
  const answer = await ask({
    type: 'warning',
    title: 'TARDIS',
    message: 'Run this on your computer?',
    detail: `${command}\n\nin ${cwd}\n\nAn agent on your TARDIS asked for this. If you did not just ask for something like it, say no.`,
    buttons: ['Run once', 'Allow all commands for 15 minutes', 'No'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }, deadline);
  if (answer === 1) {
    trustUntil = Date.now() + TRUST_MS;
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
  // Opening runs some files. Those are never opened from here at all:
  // otherwise "write a file" plus "open it" adds up to running a command
  // without ever showing one.
  if (mode === 'open' && wouldRun(target)) return 'deny';

  const risky = mode === 'write' && isLaunchable(target);
  if (!risky) {
    if (isInside(workspaceRoot, target)) return 'allow';
    if (pathGrants().includes(pathKey(mode, path.dirname(target)))) return 'allow';
  }

  const folder = path.dirname(target);
  const verb = mode === 'read' ? 'Read' : mode === 'write' ? 'Write' : 'Open';
  const why = risky
    ? '\n\nThis is a file your computer would RUN if it were opened.'
    : '\n\nThis is outside your workspace folder.';
  const buttons = risky
    ? [`${verb} once`, 'No']
    : [`${verb} once`, `Always allow ${verb.toLowerCase()} in ${folder}`, 'No'];
  const answer = await ask({
    type: 'warning',
    title: 'TARDIS',
    message: `${verb} this file on your computer?`,
    detail: `${target}${why}\n\nAn agent on your TARDIS asked for it.`,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true,
  }, deadline);
  if (!risky && answer === 1) {
    const current = pathGrants();
    const key = pathKey(mode, folder);
    if (!current.includes(key)) saveSettings({ allowedPaths: [...current, key].slice(-200) });
    return 'allow';
  }
  return answer === 0 ? 'allow' : 'deny';
}
