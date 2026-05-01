import { MCP_BASE_URL, MCP_BEARER_TOKEN } from '../config.ts';

export async function callMcp<T = unknown>(tool: string, payload: unknown): Promise<T> {
  if (!MCP_BASE_URL) {
    throw new Error('MCP_BASE_URL or RAILWAY_MCP_URL is not configured');
  }

  const response = await fetch(`${MCP_BASE_URL.replace(/\/$/, '')}/tools/${tool}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(MCP_BEARER_TOKEN ? { Authorization: `Bearer ${MCP_BEARER_TOKEN}` } : {}),
    },
    body: JSON.stringify(payload ?? {}),
  });

  if (!response.ok) {
    throw new Error(`MCP ${tool} failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}
