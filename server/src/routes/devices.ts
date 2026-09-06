import { Router } from 'express';
import {
  DEVICE_DEFAULT_TIMEOUT_MS,
  DEVICE_MAX_TIMEOUT_MS,
  callDevice,
  listDevices,
  type DeviceOp,
} from '../devices/bridge.ts';
import { asyncHandler } from './helpers.ts';

// Linked computers: the machines running the TARDIS desktop app. The device
// itself enforces what is allowed (its own user approves commands), so this
// surface only relays. Same tailnet-only trust model as the rest of /api.

export const devicesRouter = Router();

devicesRouter.get('/', (_req, res) => {
  res.json({ devices: listDevices() });
});

function timeoutOf(value: unknown): number {
  const asked = Number(value);
  if (!Number.isFinite(asked) || asked <= 0) return DEVICE_DEFAULT_TIMEOUT_MS;
  return Math.min(asked, DEVICE_MAX_TIMEOUT_MS);
}

/** POST /api/devices/:op — { device?, ...params }. `device` may be an id, a
 *  name, or omitted when exactly one computer is linked. */
function relay(op: DeviceOp, pick: (body: Record<string, unknown>) => Record<string, unknown> | string) {
  return asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const params = pick(body);
    if (typeof params === 'string') {
      res.status(400).json({ error: params });
      return;
    }
    const reply = await callDevice(String(body.device ?? ''), op, params, timeoutOf(body.timeoutMs));
    if (!reply.ok) {
      res.status(502).json({ error: reply.error });
      return;
    }
    res.json(reply.result);
  });
}

devicesRouter.post('/exec', relay('exec', (body) => {
  const command = String(body.command ?? '').trim();
  if (!command) return 'command is required';
  return { command, cwd: body.cwd ? String(body.cwd) : undefined };
}));

devicesRouter.post('/read', relay('read', (body) => {
  const path = String(body.path ?? '').trim();
  if (!path) return 'path is required';
  return { path, maxBytes: body.maxBytes };
}));

devicesRouter.post('/write', relay('write', (body) => {
  const path = String(body.path ?? '').trim();
  if (!path) return 'path is required';
  if (typeof body.content !== 'string') return 'content (string) is required';
  return { path, content: body.content };
}));

devicesRouter.post('/ls', relay('ls', (body) => {
  const path = String(body.path ?? '').trim();
  if (!path) return 'path is required';
  return { path };
}));

devicesRouter.post('/open', relay('open', (body) => {
  const path = String(body.path ?? '').trim();
  if (!path) return 'path is required';
  return { path };
}));
