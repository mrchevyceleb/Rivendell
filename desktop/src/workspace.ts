// The local side of the workspace. The ship keeps the canonical copy under
// its ASSISTANT-HUB; this machine usually has a synced copy too. Links from
// companions open the local file with the machine's own apps, and when the
// file is not here yet the shell fetches a copy from the ship.
import { app, dialog, net, shell, type BrowserWindow } from 'electron';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSettings, saveSettings } from './settings.js';

export const WORKSPACE_LABEL = 'ASSISTANT-HUB';
export type LinkKind = 'doc' | 'folder';
export interface OpenResult {
  ok: boolean;
  where?: 'local' | 'fetched';
  error?: string;
}

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

/** The local workspace: the saved choice, else the first well-known copy. */
export function workspaceRoot(): string | undefined {
  const saved = getSettings().workspaceRoot;
  if (saved && isDir(saved)) return saved;
  const found = candidates().find(isDir);
  if (found) saveSettings({ workspaceRoot: found });
  return found;
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

function insideRoot(root: string, target: string): boolean {
  const inside = path.relative(root, target);
  return inside === '' || (!inside.startsWith('..') && !path.isAbsolute(inside));
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
      error: root
        ? 'That folder is not synced to this computer.'
        : 'No local workspace folder is set. Use Ship → Local Workspace Folder….',
    };
  }
  if (!serverUrl || parts.length === 0) return { ok: false, error: 'Not connected to a ship.' };

  // Not on this machine: fetch a copy from the ship and open that.
  const relPath = parts.join('/');
  const cached = path.join(app.getPath('userData'), 'ship-cache', ...parts);
  const partial = `${cached}.part`;
  try {
    const response = await net.fetch(`${serverUrl}/api/files/raw?path=${encodeURIComponent(relPath)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, error: `The ship answered ${response.status} for that file.` };
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > FETCH_MAX_BYTES) return { ok: false, error: 'That file is too large to fetch a copy of.' };
    if (!response.body) return { ok: false, error: 'The ship sent an empty reply.' };
    mkdirSync(path.dirname(cached), { recursive: true });
    await streamToFile(response.body, partial);
    renameSync(partial, cached);
    const problem = await shell.openPath(cached);
    return problem ? { ok: false, error: problem } : { ok: true, where: 'fetched' };
  } catch (error) {
    rmSync(partial, { force: true });
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Could not fetch that file (${reason}).` };
  }
}

async function streamToFile(body: ReadableStream<Uint8Array>, target: string): Promise<void> {
  const out = createWriteStream(target);
  let written = 0;
  try {
    for await (const chunk of body) {
      written += chunk.byteLength;
      if (written > FETCH_MAX_BYTES) throw new Error('file is larger than the fetch limit');
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once('drain', resolve));
    }
    await new Promise<void>((resolve, reject) => {
      out.once('error', reject);
      out.end(resolve);
    });
  } catch (error) {
    out.destroy();
    throw error;
  }
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
  await openWorkspacePath(rel, kind, serverUrl);
}
