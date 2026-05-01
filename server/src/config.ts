import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PORT = Number(process.env.PORT || process.env.RIVENDELL_PORT) || 8091;
export const HOST = process.env.HOST || '0.0.0.0';
export const STATE_DIR = process.env.RIVENDELL_STATE_DIR || join(homedir(), '.rivendell');
export const STATIC_DIR = process.env.RIVENDELL_STATIC_DIR || resolve(APP_ROOT, 'dist');
export const ELROND_WORKSPACE_PATH =
  process.env.ELROND_WORKSPACE_PATH ||
  join(homedir(), 'Library', 'CloudStorage', 'OneDrive-Personal', 'Documents', 'ASSISTANT-HUB');

export const ASSISTANT_MCP_ENV_PATH =
  process.env.ASSISTANT_MCP_ENV_PATH ||
  join(ELROND_WORKSPACE_PATH, 'assistant-mcp', 'server', '.env');

function dotenvValue(key: string): string {
  if (!existsSync(ASSISTANT_MCP_ENV_PATH)) return '';
  const text = readFileSync(ASSISTANT_MCP_ENV_PATH, 'utf8');
  const match = text.match(new RegExp(`^${key}=([^\\n\\r]*)`, 'm'));
  if (!match) return '';
  return match[1].trim().replace(/^["']|["']$/g, '');
}

export const ASSISTANT_ADMIN_BASE_URL =
  process.env.ASSISTANT_ADMIN_BASE_URL ||
  process.env.ASSISTANT_MCP_ADMIN_URL ||
  'https://matt-assistant-production.up.railway.app';

export const ASSISTANT_ADMIN_TOKEN =
  process.env.ASSISTANT_ADMIN_TOKEN ||
  process.env.MCP_AUTH_TOKEN ||
  dotenvValue('MCP_AUTH_TOKEN');

export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  '';

// Default MCP base URL to the same Railway server that serves /admin/api.
// Both endpoints share the same auth token, so co-locating them removes a
// whole class of "callMcp not configured" silent failures.
export const MCP_BASE_URL =
  process.env.RAILWAY_MCP_URL ||
  process.env.ASSISTANT_MCP_URL ||
  process.env.MCP_BASE_URL ||
  ASSISTANT_ADMIN_BASE_URL;

export const MCP_BEARER_TOKEN =
  process.env.ASSISTANT_MCP_TOKEN ||
  process.env.MCP_BEARER_TOKEN ||
  process.env.RAILWAY_MCP_TOKEN ||
  ASSISTANT_ADMIN_TOKEN ||
  '';

export const WORKER_ENABLED = process.env.RIVENDELL_WORKER_ENABLED !== 'false';
export const WORKER_RUNNER = process.env.RIVENDELL_WORKER_RUNNER || 'dry-run';
export const WORKER_POLL_MS = Number(process.env.RIVENDELL_WORKER_POLL_MS) || 10_000;
