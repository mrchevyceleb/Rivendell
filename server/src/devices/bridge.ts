// Linked computers. A TARDIS desktop app connects OUT to this server and
// offers its machine: agents can then run a command, read a file, or list a
// folder there. The PC always decides what is actually allowed — this side
// only routes requests and waits for the answer.
//
// Wire protocol (JSON over /ws/device):
//   device → server  {type:'hello', deviceId, name, platform, homeDir, workspaceRoot, version}
//                    {type:'reply', id, ok, result|error}
//                    {type:'pong'}
//   server → device  {type:'ready'}
//                    {type:'request', id, op, params}
//                    {type:'ping'}
//
// Same trust boundary as every other surface here: loopback or an origin the
// operator configured. There is no app-layer auth, so the desktop app asks its
// own user before it runs anything.

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { trustedWebSocketOrigin } from '../lib/origin.ts';

export type DeviceOp = 'exec' | 'read' | 'write' | 'ls' | 'open';

export type DeviceInfo = {
  id: string;
  name: string;
  platform: string;
  homeDir: string;
  workspaceRoot: string;
  version: string;
  connectedAt: string;
};

export type DeviceReply =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

type Pending = {
  resolve: (reply: DeviceReply) => void;
  timer: NodeJS.Timeout;
};

type Device = {
  info: DeviceInfo;
  socket: WebSocket;
  pending: Map<string, Pending>;
  lastSeen: number;
};

const devices = new Map<string, Device>();
const HEARTBEAT_MS = 30_000;
export const DEVICE_DEFAULT_TIMEOUT_MS = 60_000;
export const DEVICE_MAX_TIMEOUT_MS = 600_000;

export function listDevices(): DeviceInfo[] {
  return [...devices.values()]
    .map((device) => device.info)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve a device by id or (case-insensitive) name. */
export function findDevice(idOrName: string): DeviceInfo | undefined {
  const needle = idOrName.trim().toLowerCase();
  if (!needle) {
    // One linked computer is the common case: no need to name it.
    return devices.size === 1 ? [...devices.values()][0].info : undefined;
  }
  for (const device of devices.values()) {
    if (device.info.id.toLowerCase() === needle || device.info.name.toLowerCase() === needle) {
      return device.info;
    }
  }
  return undefined;
}

/** Ask a linked computer to do something. Never throws: a refusal, a timeout,
 *  and a dropped link all come back as `{ ok: false }`. */
export function callDevice(
  idOrName: string,
  op: DeviceOp,
  params: Record<string, unknown>,
  timeoutMs = DEVICE_DEFAULT_TIMEOUT_MS,
): Promise<DeviceReply> {
  const info = findDevice(idOrName);
  if (!info) {
    const linked = listDevices();
    return Promise.resolve({
      ok: false,
      error: linked.length
        ? `No linked computer called ${JSON.stringify(idOrName)}. Linked now: ${linked.map((d) => d.name).join(', ')}.`
        : 'No computer is linked right now. Open the TARDIS desktop app on the machine you want to use.',
    });
  }
  const device = devices.get(info.id);
  if (!device || device.socket.readyState !== device.socket.OPEN) {
    return Promise.resolve({ ok: false, error: `${info.name} is no longer connected.` });
  }

  const id = randomUUID();
  const budget = Math.min(Math.max(1_000, timeoutMs), DEVICE_MAX_TIMEOUT_MS);
  return new Promise<DeviceReply>((resolve) => {
    const timer = setTimeout(() => {
      device.pending.delete(id);
      resolve({ ok: false, error: `${info.name} did not answer within ${Math.round(budget / 1000)}s.` });
    }, budget + 5_000);
    timer.unref?.();
    device.pending.set(id, { resolve, timer });
    try {
      device.socket.send(JSON.stringify({ type: 'request', id, op, params: { ...params, timeoutMs: budget } }));
    } catch (error) {
      clearTimeout(timer);
      device.pending.delete(id);
      resolve({ ok: false, error: `Could not reach ${info.name}: ${(error as Error).message}` });
    }
  });
}

function settleAll(device: Device, error: string): void {
  for (const [, pending] of device.pending) {
    clearTimeout(pending.timer);
    pending.resolve({ ok: false, error });
  }
  device.pending.clear();
}

export function registerDeviceBridge(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws/device') return;
    if (!trustedWebSocketOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      let registered: Device | null = null;

      let lastSeen = Date.now();
      const beat = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return;
        // Two silent intervals means the far end is gone even though the
        // socket never closed: drop it rather than list a machine that will
        // never answer.
        if (Date.now() - lastSeen > HEARTBEAT_MS * 2.5) {
          ws.terminate();
          return;
        }
        ws.send(JSON.stringify({ type: 'ping' }));
      }, HEARTBEAT_MS);
      beat.unref?.();

      ws.on('message', (raw) => {
        lastSeen = Date.now();
        if (registered) registered.lastSeen = lastSeen;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(raw)) as Record<string, unknown>;
        } catch {
          return;
        }

        if (msg.type === 'hello') {
          if (registered) {
            // One machine per link. Anything else is a client bug or an
            // attempt to hold several registry slots on one socket.
            ws.send(JSON.stringify({ type: 'error', message: 'already registered' }));
            return;
          }
          const id = String(msg.deviceId ?? '').trim();
          if (!id) {
            ws.send(JSON.stringify({ type: 'error', message: 'deviceId is required' }));
            ws.close();
            return;
          }
          // A reconnect replaces the old link for the same machine.
          const previous = devices.get(id);
          if (previous && previous.socket !== ws) {
            settleAll(previous, 'The link to this computer was replaced.');
            try { previous.socket.close(); } catch { /* already gone */ }
          }
          const info: DeviceInfo = {
            id,
            name: String(msg.name ?? '').trim() || id,
            platform: String(msg.platform ?? 'unknown'),
            homeDir: String(msg.homeDir ?? ''),
            workspaceRoot: String(msg.workspaceRoot ?? ''),
            version: String(msg.version ?? ''),
            connectedAt: new Date().toISOString(),
          };
          registered = { info, socket: ws, pending: new Map(), lastSeen: Date.now() };
          devices.set(id, registered);
          ws.send(JSON.stringify({ type: 'ready' }));
          console.log(`[tardis] linked computer ${info.name} (${info.platform})`);
          return;
        }

        if (msg.type === 'reply' && registered) {
          const pending = registered.pending.get(String(msg.id ?? ''));
          if (!pending) return;
          registered.pending.delete(String(msg.id));
          clearTimeout(pending.timer);
          pending.resolve(
            msg.ok === true
              ? { ok: true, result: msg.result }
              : { ok: false, error: String(msg.error ?? 'the computer refused') },
          );
        }
      });

      const drop = () => {
        clearInterval(beat);
        if (!registered) return;
        settleAll(registered, `${registered.info.name} disconnected.`);
        if (devices.get(registered.info.id)?.socket === ws) {
          devices.delete(registered.info.id);
          console.log(`[tardis] unlinked computer ${registered.info.name}`);
        }
        registered = null;
      };
      ws.on('close', drop);
      ws.on('error', drop);
    });
  });
}
