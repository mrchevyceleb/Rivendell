// The link that lets agents use this computer. The app dials the ship (the
// ship never dials in, so nothing here listens on a port), announces the
// machine, and then answers requests one at a time. Everything a request
// wants to do goes through approvals.ts first.
import { app, shell } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { approveCommand, approvePath, bridgeEnabled, isSecretPath } from './approvals.js';
import { getSettings, saveSettings } from './settings.js';
import { workspaceRoot } from './workspace.js';

const RECONNECT_MIN_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
const OUTPUT_CAP = 256 * 1024;
const FILE_CAP = 2 * 1024 * 1024;
const LS_CAP = 500;

let socket: WebSocket | null = null;
let retryTimer: NodeJS.Timeout | undefined;
let backoff = RECONNECT_MIN_MS;
let currentUrl: string | undefined;
let stopped = false;

/** A stable id for this machine, so a reconnect replaces its own link. */
function deviceId(): string {
  const saved = getSettings().deviceId;
  if (saved) return saved;
  const fresh = randomUUID();
  saveSettings({ deviceId: fresh });
  return fresh;
}

function resolveOnThisMachine(raw: string): string {
  const target = raw.trim();
  if (!target) throw new Error('path is required');
  if (path.isAbsolute(target)) return path.normalize(target);
  const base = workspaceRoot() ?? os.homedir();
  return path.normalize(path.resolve(base, target));
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0);
}

async function runCommand(command: string, cwd: string, timeoutMs: number): Promise<unknown> {
  const [file, args] = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]]
    : [process.env.SHELL || '/bin/bash', ['-lc', command]];

  return new Promise((resolve, reject) => {
    const child = spawn(file, args as string[], { cwd, windowsHide: true, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = (current: string, chunk: Buffer) =>
      current.length >= OUTPUT_CAP ? current : (current + chunk.toString('utf8')).slice(0, OUTPUT_CAP);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer) => { stdout = cap(stdout, chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = cap(stderr, chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
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
    return runCommand(command, cwd, budget);
  }

  const target = resolveOnThisMachine(String(params.path ?? ''));
  if (isSecretPath(target)) throw new Error('That path holds credentials; this computer never shares it.');

  if (op === 'read') {
    if (await approvePath(target, 'read', root, deadline) === 'deny') {
      throw new Error('The person at that computer declined to share this file.');
    }
    const info = await stat(target);
    if (!info.isFile()) throw new Error('That path is not a file.');
    if (info.size > FILE_CAP) throw new Error(`That file is ${Math.round(info.size / 1024)} KB; too large to read over the link.`);
    const buffer = await readFile(target);
    if (looksBinary(buffer)) throw new Error('That file is not text.');
    return { path: target, size: info.size, content: buffer.toString('utf8') };
  }

  if (op === 'write') {
    const content = String(params.content ?? '');
    if (Buffer.byteLength(content, 'utf8') > FILE_CAP) throw new Error('That is too much to write over the link.');
    if (await approvePath(target, 'write', root, deadline) === 'deny') {
      throw new Error('The person at that computer declined to write this file.');
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    const info = await stat(target);
    return { path: target, size: info.size };
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
      throw new Error('The person at that computer declined to open this.');
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

function scheduleReconnect(): void {
  if (stopped || !currentUrl) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => connect(), backoff);
  retryTimer.unref?.();
  backoff = Math.min(RECONNECT_MAX_MS, Math.round(backoff * 1.7));
}

function connect(): void {
  if (stopped || !currentUrl) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(currentUrl));
  } catch (error) {
    console.error('[tardis] device link failed to open:', error);
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.addEventListener('open', () => {
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
    void handle(op, params).then(
      (result) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'reply', id, ok: true, result })),
      (error: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({
        type: 'reply',
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })),
    );
  });

  ws.addEventListener('close', () => {
    if (socket === ws) socket = null;
    console.log(`[tardis] device link closed; retrying in ${Math.round(backoff / 1000)}s`);
    scheduleReconnect();
  });
  ws.addEventListener('error', () => {
    try { ws.close(); } catch { /* already closing */ }
  });
}

/** Point the link at a ship (or move it to a different one). */
export function startDeviceBridge(serverUrl: string | undefined): void {
  stopped = false;
  if (currentUrl === serverUrl && socket) return;
  currentUrl = serverUrl;
  stopDeviceBridge(true);
  if (!serverUrl) return;
  backoff = RECONNECT_MIN_MS;
  connect();
}

export function stopDeviceBridge(keepUrl = false): void {
  if (!keepUrl) {
    stopped = true;
    currentUrl = undefined;
  }
  clearTimeout(retryTimer);
  const ws = socket;
  socket = null;
  if (ws) {
    try { ws.close(); } catch { /* already gone */ }
  }
}

export function deviceLinkState(): 'off' | 'linked' | 'connecting' {
  if (!bridgeEnabled()) return 'off';
  return socket?.readyState === WebSocket.OPEN ? 'linked' : 'connecting';
}
