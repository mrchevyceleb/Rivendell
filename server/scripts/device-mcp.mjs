#!/usr/bin/env node

/**
 * rivendell-device MCP — the user's own computers, reachable from a turn.
 *
 * A tiny stdio MCP server (no deps) fronting TARDIS's /api/devices surface on
 * localhost. A computer appears here only while its TARDIS desktop app is
 * open, and that app asks its user before running anything, so a refusal is a
 * normal answer, not an error to route around.
 *
 * Tools:
 *   device_list  — which computers are linked right now
 *   device_exec  — run a shell command there
 *   device_read  — read a file there
 *   device_write — write a file there
 *   device_ls    — list a folder there
 *   device_open  — open a file or folder in its default app
 */

import { createInterface } from 'node:readline';

const BASE = process.env.RIVENDELL_TEAM_URL || 'http://127.0.0.1:8091';

const DEVICE_ARG = {
  type: 'string',
  description: 'Which computer, by name or id. Omit when only one is linked.',
};

const TOOLS = [
  {
    name: 'device_list',
    description:
      "List the user's computers that are linked right now, with their platform and the folder each one keeps its workspace copy in. " +
      'A computer is only reachable while its TARDIS desktop app is running. Call this first when the user asks for something on "my PC", "my laptop", or "this machine". ' +
      'Pass the id rather than the name when two machines share a name.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'device_exec',
    description:
      "Run a shell command on the user's computer (PowerShell on Windows, the login shell elsewhere) and return its exit code, stdout, and stderr. " +
      'The user is asked to approve on that machine, so a denial is a legitimate outcome: report it and stop rather than retrying or rephrasing the command. ' +
      'Prefer one clear command over a chain, and never use it to work around a refusal.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command line to run' },
        cwd: { type: 'string', description: 'Working directory on that machine (default: the home folder)' },
        device: DEVICE_ARG,
        timeoutMs: { type: 'number', description: 'How long to allow, in ms (default 60000, max 600000)' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'device_read',
    description:
      "Read a text file from the user's computer by absolute path (or a path relative to that machine's workspace copy). " +
      'Files inside the workspace are read without a prompt; anything else asks the user first. Credential stores are always refused.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path on that machine, or workspace-relative' },
        device: DEVICE_ARG,
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'device_write',
    description:
      "Write a text file on the user's computer. Overwrites the file at that path. Outside the workspace copy the user is asked first.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path on that machine, or workspace-relative' },
        content: { type: 'string', description: 'The full new contents' },
        device: DEVICE_ARG,
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'device_ls',
    description: "List a folder on the user's computer: names, whether each entry is a folder, size, and modified time.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path on that machine, or workspace-relative' },
        device: DEVICE_ARG,
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'device_open',
    description:
      "Open a file or folder on the user's computer in whatever app they normally use for it. Use this to put something in front of the user rather than describing where it is.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path on that machine, or workspace-relative' },
        device: DEVICE_ARG,
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
];

async function api(path, init, signal) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    signal,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) throw new Error(body?.error || text || `${res.status} ${res.statusText}`);
  return body;
}

function post(op, args, signal) {
  return api(`/api/devices/${op}`, { method: 'POST', body: JSON.stringify(args) }, signal);
}

function describeDevice(device) {
  return `- ${device.name} (${device.id}) — ${device.platform}${device.workspaceRoot ? ` · workspace at ${device.workspaceRoot}` : ' · no local workspace folder set'}`;
}

function clip(text, limit) {
  if (typeof text !== 'string' || text.length <= limit) return text ?? '';
  return `${text.slice(0, limit)}\n… (${text.length - limit} more characters)`;
}

async function callTool(name, args, signal) {
  if (name === 'device_list') {
    const { devices } = await api('/api/devices', undefined, signal);
    if (!devices?.length) {
      return 'No computer is linked right now. The user opens the TARDIS desktop app on a machine to make it reachable.';
    }
    return `Linked computers (${devices.length}):\n${devices.map(describeDevice).join('\n')}`;
  }

  if (name === 'device_exec') {
    const result = await post('exec', {
      device: args.device,
      command: args.command,
      cwd: args.cwd,
      timeoutMs: args.timeoutMs,
    }, signal);
    const lines = [`exit ${result.code}${result.timedOut ? ' (timed out)' : ''}`];
    if (result.stdout) lines.push(`stdout:\n${clip(result.stdout, 20000)}`);
    if (result.stderr) lines.push(`stderr:\n${clip(result.stderr, 8000)}`);
    if (!result.stdout && !result.stderr) lines.push('(no output)');
    return lines.join('\n\n');
  }

  if (name === 'device_read') {
    const result = await post('read', { device: args.device, path: args.path }, signal);
    return `${result.path} (${result.size} bytes)\n\n${clip(result.content, 60000)}`;
  }

  if (name === 'device_write') {
    const result = await post('write', { device: args.device, path: args.path, content: args.content }, signal);
    return `Wrote ${result.path} (${result.size} bytes).`;
  }

  if (name === 'device_ls') {
    const result = await post('ls', { device: args.device, path: args.path }, signal);
    if (!result.entries?.length) return `${result.path} is empty.`;
    const rows = result.entries.map((entry) => `${entry.type === 'directory' ? 'dir ' : 'file'}  ${entry.name}${entry.type === 'file' ? `  ${entry.size} bytes` : ''}`);
    return `${result.path}\n${rows.join('\n')}`;
  }

  if (name === 'device_open') {
    const result = await post('open', { device: args.device, path: args.path }, signal);
    return `Opened ${result.path}.`;
  }

  throw new Error(`unknown tool: ${name}`);
}

// --- stdio JSON-RPC (MCP) ----------------------------------------------------

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const activeCalls = new Map();

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  try {
    if (method === 'initialize') {
      send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'rivendell-device', version: '1.0.0' } } });
    } else if (method === 'notifications/initialized') {
      // no-op
    } else if (method === 'notifications/cancelled') {
      const requestId = params?.requestId;
      activeCalls.get(requestId)?.abort();
      activeCalls.delete(requestId);
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
    } else if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      const controller = new AbortController();
      activeCalls.set(id, controller);
      try {
        const out = await callTool(params.name, params.arguments ?? {}, controller.signal);
        if (!controller.signal.aborted) {
          send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(out) }] } });
        }
      } catch (e) {
        if (!controller.signal.aborted) throw e;
      } finally {
        activeCalls.delete(id);
      }
    } else if (method && id !== undefined) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  } catch (e) {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `ERROR: ${e.message}` }], isError: true } });
  }
});

process.on('SIGTERM', () => process.exit(0));
