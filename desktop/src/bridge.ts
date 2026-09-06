// The link that lets agents use this computer. The app dials the ship (the
// ship never dials in, so nothing here listens on a port), announces the
// machine, and then answers requests. Everything a request wants to do goes
// through approvals.ts first, always on a canonical path, and files are
// opened without following a symlink so the path that was approved is the
// path that gets touched.
import { app, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants, realpathSync } from 'node:fs';
import { mkdir, open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  approveCommand,
  approvePath,
  bridgeEnabled,
  cancelPendingApprovals,
  isSecretPath,
} from './approvals.js';
import { getSettings, saveSettings } from './settings.js';
import { workspaceRoot } from './workspace.js';

const RECONNECT_MIN_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
const OUTPUT_CAP = 256 * 1024;
const FILE_CAP = 2 * 1024 * 1024;
const LS_CAP = 500;
// A compromised ship must not be able to drown this machine in work.
const MAX_INFLIGHT = 8;
const MAX_RUNNING_COMMANDS = 4;
// Symlinks are resolved before approval; refusing to follow one at the final
// step closes the gap between the check and the open.
const NOFOLLOW = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);

let socket: WebSocket | null = null;
let retryTimer: NodeJS.Timeout | undefined;
let backoff = RECONNECT_MIN_MS;
let currentUrl: string | undefined;
let inflight = 0;
// Bumped every time the link is pointed somewhere new or torn down, so a
// socket that closes later cannot schedule a reconnect for a link that is
// already gone (which would otherwise loop forever).
let linkGeneration = 0;

// Commands still running, so a shutdown does not leave them behind.
const running = new Set<ChildProcess>();

/** A stable id for this machine, so a reconnect replaces its own link. */
function deviceId(): string {
  const saved = getSettings().deviceId;
  if (saved) return saved;
  const fresh = randomUUID();
  saveSettings({ deviceId: fresh });
  return fresh;
}

/** Resolve every symlink we can, so authorisation and the operation itself
 *  see the same real path. For a file that does not exist yet, the nearest
 *  existing parent is resolved and the rest appended. */
function canonical(target: string): string {
  let head = target;
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(head), ...tail);
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return path.normalize(target);
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

function resolveOnThisMachine(raw: string): string {
  const target = raw.trim();
  if (!target) throw new Error('path is required');
  const base = workspaceRoot() ?? os.homedir();
  return canonical(path.isAbsolute(target) ? target : path.resolve(base, target));
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0);
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  // The child leads its own process group, so this reaches what it started.
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

async function runCommand(command: string, cwd: string, timeoutMs: number): Promise<unknown> {
  if (running.size >= MAX_RUNNING_COMMANDS) {
    throw new Error('That computer is already running as many commands as it will take at once.');
  }
  const [file, args] = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]]
    : [process.env.SHELL || '/bin/bash', ['-lc', command]];

  return new Promise((resolve, reject) => {
    const child = spawn(file, args as string[], {
      cwd,
      windowsHide: true,
      env: process.env,
      // Its own process group, so a timeout can take the whole tree with it.
      detached: process.platform !== 'win32',
    });
    running.add(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = (current: string, chunk: Buffer) =>
      current.length >= OUTPUT_CAP ? current : (current + chunk.toString('utf8')).slice(0, OUTPUT_CAP);

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer) => { stdout = cap(stdout, chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = cap(stderr, chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      running.delete(child);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      running.delete(child);
      resolve({
        code: code ?? (timedOut ? 124 : 0),
        stdout,
        stderr,
        timedOut,
        cwd,
        truncated: stdout.length >= OUTPUT_CAP || stderr.length >= OUTPUT_CAP,
      });
    });
  });
}

async function handle(op: string, params: Record<string, unknown>): Promise<unknown> {
  if (!bridgeEnabled()) throw new Error('This computer is not accepting agent requests (Ship menu → Allow Agents on This Computer).');
  const budget = Number(params.timeoutMs) || 60_000;
  const deadline = Date.now() + budget;
  const root = workspaceRoot();

  if (op === 'exec') {
    const command = String(params.command ?? '').trim();
    if (!command) throw new Error('command is required');
    const cwd = params.cwd ? resolveOnThisMachine(String(params.cwd)) : (root ?? os.homedir());
    if (await approveCommand(command, cwd, deadline) === 'deny') {
      throw new Error('The person at that computer declined to run this.');
    }
    // Time spent waiting for that answer comes out of the command's budget,
    // so nothing keeps running after the ship has stopped listening.
    const remaining = deadline - Date.now();
    if (remaining < 1_000) throw new Error('Approval came too late to start this command.');
    return runCommand(command, cwd, remaining);
  }

  const target = resolveOnThisMachine(String(params.path ?? ''));
  if (isSecretPath(target)) throw new Error('That path holds credentials; this computer never shares it.');

  if (op === 'read') {
    if (await approvePath(target, 'read', root, deadline) === 'deny') {
      throw new Error('The person at that computer declined to share this file.');
    }
    const handle = await open(target, fsConstants.O_RDONLY | NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('That path is not a file.');
      if (info.size > FILE_CAP) throw new Error(`That file is ${Math.round(info.size / 1024)} KB; too large to read over the link.`);
      const buffer = await handle.readFile();
      if (looksBinary(buffer)) throw new Error('That file is not text.');
      return { path: target, size: info.size, content: buffer.toString('utf8') };
    } finally {
      await handle.close();
    }
  }

  if (op === 'write') {
    const content = String(params.content ?? '');
    if (Buffer.byteLength(content, 'utf8') > FILE_CAP) throw new Error('That is too much to write over the link.');
    if (await approvePath(target, 'write', root, deadline) === 'deny') {
      throw new Error('The person at that computer declined to write this file.');
    }
    await mkdir(path.dirname(target), { recursive: true });
    const handle = await open(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | NOFOLLOW, 0o644);
    try {
      await handle.writeFile(content, 'utf8');
      const info = await handle.stat();
      return { path: target, size: info.size };
    } finally {
      await handle.close();
    }
  }

  if (op === 'ls') {
    if (await approvePath(target, 'read', root, deadline) === 'deny') {
      throw new Error('The person at that computer declined to list this folder.');
    }
    const found = await readdir(target, { withFileTypes: true });
    const entries = [];
    for (const entry of found.slice(0, LS_CAP)) {
      const full = path.join(target, entry.name);
      let size: number | undefined;
      let modifiedAt: string | undefined;
      try {
        const info = await stat(full);
        size = info.isFile() ? info.size : undefined;
        modifiedAt = info.mtime.toISOString();
      } catch { /* vanished or unreadable */ }
      entries.push({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', size, modifiedAt });
    }
    return { path: target, entries, truncated: found.length > LS_CAP };
  }

  if (op === 'open') {
    if (await approvePath(target, 'open', root, deadline) === 'deny') {
      throw new Error('The person at that computer declined to open this, or it is a file the computer would run.');
    }
    const problem = await shell.openPath(target);
    if (problem) throw new Error(problem);
    return { path: target };
  }

  throw new Error(`unknown operation: ${op}`);
}

function wsUrl(serverUrl: string): string {
  const url = new URL('/ws/device', serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

function connect(generation: number): void {
  if (generation !== linkGeneration || !currentUrl) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(currentUrl));
  } catch (error) {
    console.error('[tardis] device link failed to open:', error);
    scheduleReconnect(generation);
    return;
  }
  socket = ws;

  ws.addEventListener('open', () => {
    if (generation !== linkGeneration) {
      try { ws.close(); } catch { /* already closing */ }
      return;
    }
    backoff = RECONNECT_MIN_MS;
    console.log(`[tardis] offering this computer to ${currentUrl}`);
    ws.send(JSON.stringify({
      type: 'hello',
      deviceId: deviceId(),
      name: os.hostname(),
      platform: process.platform,
      homeDir: os.homedir(),
      workspaceRoot: workspaceRoot() ?? '',
      version: app.getVersion(),
    }));
  });

  ws.addEventListener('message', (event: MessageEvent) => {
    if (generation !== linkGeneration) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }
    if (msg.type !== 'request') return;
    const id = String(msg.id ?? '');
    const op = String(msg.op ?? '');
    const params = (msg.params ?? {}) as Record<string, unknown>;
    const answer = (payload: Record<string, unknown>) => {
      if (generation === linkGeneration && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'reply', id, ...payload }));
      }
    };
    if (inflight >= MAX_INFLIGHT) {
      answer({ ok: false, error: 'That computer is already handling as many requests as it will take at once.' });
      return;
    }
    inflight += 1;
    void handle(op, params)
      .then(
        (result) => answer({ ok: true, result }),
        (error: unknown) => answer({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => { inflight -= 1; });
  });

  ws.addEventListener('close', () => {
    if (socket === ws) socket = null;
    // Only the socket that still owns the link may ask for another one.
    if (generation !== linkGeneration) return;
    console.log(`[tardis] device link closed; retrying in ${Math.round(backoff / 1000)}s`);
    cancelPendingApprovals();
    scheduleReconnect(generation);
  });
  ws.addEventListener('error', () => {
    try { ws.close(); } catch { /* already closing */ }
  });
}

function scheduleReconnect(generation: number): void {
  if (generation !== linkGeneration || !currentUrl) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => connect(generation), backoff);
  retryTimer.unref?.();
  backoff = Math.min(RECONNECT_MAX_MS, Math.round(backoff * 1.7));
}

/** Point the link at a ship (or move it to a different one). Refuses while
 *  the master switch is off, so a computer that is not offering itself never
 *  announces its name and paths. */
export function startDeviceBridge(serverUrl: string | undefined): void {
  if (!bridgeEnabled()) {
    stopDeviceBridge();
    return;
  }
  if (currentUrl === serverUrl && socket) return;
  teardown();
  currentUrl = serverUrl;
  if (!serverUrl) return;
  backoff = RECONNECT_MIN_MS;
  connect(linkGeneration);
}

/** Re-announce this machine (its workspace folder just changed). */
export function refreshDeviceBridge(): void {
  const url = currentUrl;
  if (!url || !bridgeEnabled()) return;
  teardown();
  currentUrl = url;
  backoff = RECONNECT_MIN_MS;
  connect(linkGeneration);
}

function teardown(): void {
  // A new generation orphans every callback belonging to the old link.
  linkGeneration += 1;
  clearTimeout(retryTimer);
  cancelPendingApprovals();
  const ws = socket;
  socket = null;
  if (ws) {
    try { ws.close(); } catch { /* already gone */ }
  }
}

export function stopDeviceBridge(): void {
  teardown();
  currentUrl = undefined;
  for (const child of running) killTree(child);
  running.clear();
}

export function deviceLinkState(): 'off' | 'linked' | 'connecting' {
  if (!bridgeEnabled()) return 'off';
  return socket?.readyState === WebSocket.OPEN ? 'linked' : 'connecting';
}
