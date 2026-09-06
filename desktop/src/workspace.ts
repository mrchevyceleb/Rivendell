// The local side of the workspace. The ship keeps the canonical copy under
// its ASSISTANT-HUB; this machine usually has a synced copy too. Links from
// companions open the local file with the machine's own apps, and when the
// file is not here yet the shell fetches a copy from the ship.
import { app, dialog, net, shell, type BrowserWindow } from 'electron';
import { createWriteStream, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { getSettings, saveSettings } from './settings.js';

export const WORKSPACE_LABEL = 'ASSISTANT-HUB';
export type LinkKind = 'doc' | 'folder';
export interface OpenResult {
  ok: boolean;
  where?: 'local' | 'fetched' | 'browser';
  error?: string;
}

// One download per workspace path at a time; a second click joins the first.
const inflight = new Map<string, Promise<OpenResult>>();

// A fetched copy is opened with the machine's default app, which for these
// types means running it. The ship is trusted, but a compromised page there
// must not be able to hand this machine a payload; the local synced copy is
// the user's own and stays unrestricted.
const NO_OPEN_FROM_SHIP = new Set([
  '.exe', '.msi', '.msix', '.appx', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl', '.hta', '.ps1', '.psm1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.jar', '.lnk', '.url', '.reg', '.inf', '.sct', '.msc',
  '.sh', '.command', '.app', '.dmg', '.pkg', '.run', '.bin', '.apk', '.deb', '.rpm', '.appimage', '.desktop',
]);

const FETCH_TIMEOUT_MS = 120_000;
// A fetched copy is buffered on disk, never in memory, and capped so one
// stray multi-gigabyte file cannot fill the drive.
const FETCH_MAX_BYTES = 512 * 1024 * 1024;

function isDir(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function subdirs(parent: string, pattern: RegExp): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((entry) => path.join(parent, entry.name));
  } catch {
    return [];
  }
}

/** Well-known places a synced workspace copy lives, most specific first. */
function candidates(): string[] {
  const home = os.homedir();
  const out: string[] = [];
  if (process.platform === 'win32') {
    out.push(`C:\\${WORKSPACE_LABEL}`, path.join(home, WORKSPACE_LABEL));
    for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
      const base = process.env[key];
      if (base) out.push(path.join(base, WORKSPACE_LABEL));
    }
    for (const dir of subdirs(home, /^OneDrive/i)) out.push(path.join(dir, WORKSPACE_LABEL));
  } else {
    out.push(path.join(home, WORKSPACE_LABEL), path.join(home, 'OneDrive', WORKSPACE_LABEL));
    for (const dir of subdirs(path.join(home, 'Library', 'CloudStorage'), /^OneDrive/i)) {
      out.push(path.join(dir, WORKSPACE_LABEL));
    }
  }
  return out;
}

/** The local workspace: the chosen folder (even while it is unavailable,
 *  so a missing drive never silently swaps in another copy), else the first
 *  well-known copy on this machine. */
export function workspaceRoot(): string | undefined {
  const saved = getSettings().workspaceRoot;
  if (saved) return isDir(saved) ? saved : undefined;
  const found = candidates().find(isDir);
  if (found) saveSettings({ workspaceRoot: found });
  return found;
}

function workspaceUnavailable(): string | undefined {
  const saved = getSettings().workspaceRoot;
  return saved && !isDir(saved) ? `The local workspace folder ${saved} is not available right now.` : undefined;
}

export async function chooseWorkspaceRoot(win: BrowserWindow | null): Promise<string | undefined> {
  const options: Electron.OpenDialogOptions = {
    title: 'Local workspace folder',
    message: `Pick this computer's copy of ${WORKSPACE_LABEL}`,
    defaultPath: workspaceRoot() ?? os.homedir(),
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = win && !win.isDestroyed()
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  const picked = result.canceled ? undefined : result.filePaths[0];
  if (!picked) return undefined;
  saveSettings({ workspaceRoot: picked });
  return picked;
}

/** Workspace-relative path to segments. Refuses traversal and absolute paths. */
function segmentsOf(rel: string): string[] | null {
  const parts = rel.replace(/\\/g, '/').split('/').filter((part) => part.length > 0);
  if (parts.some((part) => part === '.' || part === '..')) return null;
  if (parts[0] !== undefined && /^[A-Za-z]:$/.test(parts[0])) return null;
  return parts;
}

/** Real-path containment: a symlink or junction inside the workspace must not
 *  lead the shell to open something outside it. Both paths must exist. */
function insideRoot(root: string, target: string): boolean {
  try {
    const realRoot = realpathSync(root);
    const realTarget = realpathSync(target);
    const inside = path.relative(realRoot, realTarget);
    return inside === '' || (!inside.startsWith('..') && !path.isAbsolute(inside));
  } catch {
    return false;
  }
}

/** Fetched copies live per ship, so switching servers never mixes files. */
function cacheDir(serverUrl: string): string {
  const host = new URL(serverUrl).host.replace(/[^A-Za-z0-9.-]/g, '_');
  return path.join(app.getPath('userData'), 'ship-cache', host);
}

/** Forget every fetched copy (Ship → Clear Fetched Copies). Edits made to a
 *  copy live only there, so this asks first and moves the folder to the
 *  trash rather than deleting it. */
export async function clearFetchedCopies(win: BrowserWindow | null): Promise<void> {
  const dir = path.join(app.getPath('userData'), 'ship-cache');
  const options: Electron.MessageBoxOptions = inflight.size > 0
    ? { type: 'info', title: 'TARDIS', message: 'A file is still being fetched. Try again when it has finished.', buttons: ['OK'] }
    : !existsSync(dir)
      ? { type: 'info', title: 'TARDIS', message: 'There are no fetched copies.', buttons: ['OK'] }
      : {
          type: 'question',
          title: 'TARDIS',
          message: 'Move all fetched copies to the trash?',
          detail: 'Edits you made to fetched copies live only in them. The trash keeps them recoverable; the next click on a link fetches a fresh copy from the ship.',
          buttons: ['Move to Trash', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        };
  const result = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (options.type !== 'question' || result.response !== 0) return;
  try {
    await shell.trashItem(dir);
  } catch {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function openLocal(target: string): Promise<OpenResult> {
  const problem = await shell.openPath(target);
  return problem ? { ok: false, error: problem } : { ok: true, where: 'local' };
}

export async function openWorkspacePath(rel: string, kind: LinkKind, serverUrl: string | undefined): Promise<OpenResult> {
  const parts = segmentsOf(rel);
  if (parts === null) return { ok: false, error: 'That path is not inside the workspace.' };

  const root = workspaceRoot();
  if (root) {
    const target = parts.length ? path.join(root, ...parts) : root;
    if (insideRoot(root, target) && existsSync(target)) return openLocal(target);
  }

  if (kind === 'folder') {
    return {
      ok: false,
      error: workspaceUnavailable() ?? (root
        ? 'That folder is not synced to this computer.'
        : 'No local workspace folder is set. Use Ship → Local Workspace Folder….'),
    };
  }
  if (!serverUrl || parts.length === 0) return { ok: false, error: 'Not connected to a ship.' };
  if (NO_OPEN_FROM_SHIP.has(path.extname(parts[parts.length - 1]).toLowerCase())) {
    return { ok: false, error: 'Executable files are not opened from a fetched copy. Sync the workspace to this computer to use it.' };
  }

  // Not on this machine: open the copy fetched earlier, or fetch one now.
  // A fetched copy is never replaced automatically, so edits to it survive;
  // Ship → Clear Fetched Copies forgets them all.
  const relPath = parts.join('/');
  const cached = path.join(cacheDir(serverUrl), ...parts);
  if (existsSync(cached)) {
    const problem = await shell.openPath(cached);
    return problem ? { ok: false, error: problem } : { ok: true, where: 'fetched' };
  }
  const key = `${serverUrl}|${relPath}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = fetchAndOpen(serverUrl, relPath, cached).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function fetchAndOpen(serverUrl: string, relPath: string, cached: string): Promise<OpenResult> {
  const rawUrl = `${serverUrl}/api/files/raw?path=${encodeURIComponent(relPath)}`;
  const partial = `${cached}.${process.pid}.${Date.now().toString(36)}.part`;
  try {
    const response = await net.fetch(rawUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' });
    if (!response.ok) return { ok: false, error: `The ship answered ${response.status} for that file.` };
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > FETCH_MAX_BYTES) return openInBrowser(rawUrl);
    if (!response.body) return { ok: false, error: 'The ship sent an empty reply.' };
    mkdirSync(path.dirname(cached), { recursive: true });
    await streamToFile(response.body as unknown as NodeReadableStream<Uint8Array>, partial);
    renameSync(partial, cached);
    const problem = await shell.openPath(cached);
    return problem ? { ok: false, error: problem } : { ok: true, where: 'fetched' };
  } catch (error) {
    rmSync(partial, { force: true });
    if (error instanceof Error && error.message === TOO_LARGE) return openInBrowser(rawUrl);
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Could not fetch that file (${reason}).` };
  }
}

/** Too big to cache: let the browser stream it from the ship instead. */
async function openInBrowser(rawUrl: string): Promise<OpenResult> {
  try {
    await shell.openExternal(rawUrl);
    return { ok: true, where: 'browser' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const TOO_LARGE = 'file is larger than the fetch limit';

/** Web body → file through stream.pipeline, so every error (disk full,
 *  permissions, the size cap) rejects here instead of crashing the app. */
async function streamToFile(body: NodeReadableStream<Uint8Array>, target: string): Promise<void> {
  let written = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.byteLength;
      if (written > FETCH_MAX_BYTES) callback(new Error(TOO_LARGE));
      else callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(body), limiter, createWriteStream(target));
}

/** `rivendell://open?kind=doc|folder&winpath=…` or `?url=…`, as older console
 *  bundles and browser tabs fire them. Handled here so the Windows PowerShell
 *  helper is never needed inside the desktop app. */
export async function handleNativeScheme(url: string, serverUrl: string | undefined): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'rivendell:') return;

  const target = parsed.searchParams.get('url');
  if (target && /^https?:\/\//i.test(target)) {
    await shell.openExternal(target);
    return;
  }

  const winpath = parsed.searchParams.get('winpath');
  if (!winpath) return;
  const kind: LinkKind = parsed.searchParams.get('kind') === 'folder' ? 'folder' : 'doc';
  const normalized = winpath.replace(/\//g, '\\');
  const marker = normalized.toUpperCase().indexOf(`${WORKSPACE_LABEL}\\`);
  let rel: string | null = null;
  if (marker >= 0) rel = normalized.slice(marker + WORKSPACE_LABEL.length + 1);
  else if (normalized.toUpperCase().endsWith(WORKSPACE_LABEL)) rel = '';
  if (rel === null) return;
  const result = await openWorkspacePath(rel, kind, serverUrl);
  if (!result.ok) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'TARDIS',
      message: 'Could not open that workspace path.',
      detail: result.error ?? 'Unknown error.',
    });
  }
}
