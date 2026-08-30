#!/usr/bin/env node

/**
 * rivendell-team MCP — agent-to-agent messaging for Rivendell teammates.
 *
 * A tiny stdio MCP server (no deps) that fronts Rivendell's /api/team HTTP
 * surface on localhost. Spawned per chat session by the runners via
 * --mcp-config / codex -c overrides / banana config mirroring.
 *
 * Tools:
 *   team_list    — the roster (id, name, role, engine)
 *   team_message — message a teammate; waits for their reply by default
 *   team_recent  — recent visible messages from a teammate's thread
 *
 * The server enforces hop/rate limits, so free conversation can't loop
 * forever. Loop discipline still belongs to the models: end chains with a
 * summary to the human rather than hop 4/4.
 */

import { createInterface } from 'node:readline';

const BASE = process.env.RIVENDELL_TEAM_URL || 'http://127.0.0.1:8091';

const TOOLS = [
  {
    name: 'team_list',
    description:
      'List your AI teammates on this Rivendell instance (id, name, role, engine). ' +
      'Use the exact name with team_message.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'team_message',
    description:
      'Send a message to a teammate by name. They receive it in their own thread, think, ' +
      'and (by default) their reply is returned to you. Use this to delegate, ask, coordinate, ' +
      'or hand off work. hop: pass 2 when replying to a message you received (chain depth guard).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Your own teammate name (the sender)' },
        to: { type: 'string', description: "Teammate name, e.g. 'Chief of Staff'" },
        text: { type: 'string', description: 'What to say or ask' },
        hop: { type: 'number', description: 'Chain depth: 1 for a fresh message, 2+ when replying in a chain' },
        wait: { type: 'boolean', description: 'Wait for the reply (default true)' },
      },
      required: ['from', 'to', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'team_recent',
    description:
      "Read a teammate's recent thread messages (their last exchanges) — check what they " +
      'already said or did before re-asking.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        limit: { type: 'number', description: 'How many messages (default 8)' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
];

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok && !body?.delivered) {
    const reason = body?.reason || body?.error || `${res.status} ${res.statusText}`;
    throw new Error(typeof reason === 'string' ? reason : JSON.stringify(reason));
  }
  return body;
}

async function callTool(name, args) {
  if (name === 'team_list') {
    const { agents } = await api('/api/team');
    return `Teammates (${agents.length}):\n` + agents
      .map((a) => `- ${a.name} (${a.id}) — ${a.role} [${a.engine}]`)
      .join('\n');
  }
  if (name === 'team_message') {
    const result = await api('/api/team/message', {
      method: 'POST',
      body: JSON.stringify({
        from: process.env.RIVENDELL_AGENT_NAME || args.from || 'Teammate',
        to: args.to,
        text: args.text,
        hop: args.hop,
        wait: args.wait,
      }),
    });
    if (!result.delivered) return `NOT DELIVERED: ${result.reason}`;
    return result.reply
      ? `Delivered to ${result.to}. Their reply:\n\n${result.reply}`
      : `Delivered to ${result.to}.`;
  }
  if (name === 'team_recent') {
    const { messages } = await api(`/api/team/recent?name=${encodeURIComponent(args.name)}&limit=${args.limit ?? 8}`);
    if (!messages?.length) return `No recent messages for ${args.name}.`;
    return messages.map((m) => `${m.who === 'agent' ? args.name : m.who === 'peer' ? '→ teammate msg' : 'user'}: ${m.text}`).join('\n');
  }
  throw new Error(`unknown tool: ${name}`);
}

// --- stdio JSON-RPC (MCP) ----------------------------------------------------

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  try {
    if (method === 'initialize') {
      send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'rivendell-team', version: '1.0.0' } } });
    } else if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      // no-op
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
    } else if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      const out = await callTool(params.name, params.arguments ?? {});
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(out) }] } });
    } else if (method && id !== undefined) {
      // Requests get a proper error; notifications (no id) get silence.
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  } catch (e) {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `ERROR: ${e.message}` }], isError: true } });
  }
});

process.on('SIGTERM', () => process.exit(0));
