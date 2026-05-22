import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import type { Event, PermissionRuleset } from '@opencode-ai/sdk/v2';
import type { CliKind, SessionEvent, SeqEvent } from './runner.ts';
import { getSessionId, setSessionId } from './sessions.ts';
import { appendEventLog, compactEventLog, loadEventLogSync } from './event-log-store.ts';

const EVENT_BUFFER_SIZE = 2000;

// ── Banana v2 ────────────────────────────────────────────────────────────
//
// v1 spawned `banana run --format json` once per turn. That paid a cold-start
// tax (25-40s) every message and could not stream — the answer landed all at
// once. v2 keeps a single persistent `banana serve` process for the whole app
// (the BananaServer singleton), talks to it through the @opencode-ai/sdk v2
// client, and consumes ONE shared SSE event stream. Each turn drives a
// `sdk.session.prompt` and the SDK's `message.part.delta` events are
// normalized into the SAME claude-shaped stream-json vocabulary v1 emitted,
// but now incrementally — real token streaming.
//
// BananaSession keeps its v1 external contract intact (constructor, subscribe,
// send, shutdown, getOrCreateBananaSession, freshStartBanana, interruptBanana,
// activeBananaSessions, pruneIdleBananaSessions, shutdownAllBananaSessions) so
// chat/runner.ts and the WS layer are unchanged.

export type Listener = (e: SeqEvent) => void;

let nextSyntheticId = 1;
const synth = (prefix: string) => `${prefix}_${nextSyntheticId++}`;
type ChatImage = { mediaType: string; base64: string };
type BananaUsage = {
  input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  output_tokens: number;
};

/** Per-turn bookkeeping. Tracks the claude-shaped block indices we have
 *  opened so deltas can be routed to the right block.
 *
 *  `emittedLen` is the count of chars already emitted for a text/reasoning
 *  block. The snapshot reconciler in handlePartUpdated emits only
 *  `part.text.slice(emittedLen)`, so a dropped or pre-anchor delta can never
 *  lose text — the next message.part.updated snapshot backfills it. */
type PartRecord = {
  index: number;
  kind: 'text' | 'reasoning' | 'tool';
  started: boolean;
  emittedLen: number;
  /** True once the block's content_block_stop has been emitted. A closed
   *  text/reasoning record is kept in `state.parts` (not deleted) so a
   *  repeated/replayed final snapshot for the same partID cannot recreate it
   *  with emittedLen 0 and re-emit the whole answer as a duplicate block. */
  closed: boolean;
};
type BananaTurnState = {
  messageId: string;
  nextBlockIndex: number;
  messageStarted: boolean;
  /** banana partID -> claude block record. */
  parts: Map<string, PartRecord>;
  /** deltas that arrived before their part-created event, keyed by partID. */
  bufferedDeltas: Map<string, string[]>;
  /** banana assistant messageID currently being normalized. A tool-using turn
   *  can have more than one assistant message: one for tool_use blocks, then
   *  a later one for final text after tool results. */
  assistantMessageId: string | null;
  /** True once this turn's prompt has been accepted by the server, or once
   *  the turn has anchored to an assistant message. A `session.status idle`
   *  only completes the turn after one of those — a late/trailing idle from
   *  the PREVIOUS prompt (the banana session is reused) can otherwise land in
   *  the window between this turn's state being created and its prompt being
   *  accepted, and would fake-complete the turn before the real answer streams. */
  promptAccepted: boolean;
  /** True once this turn has actually emitted or observed a tool_use part. */
  sawToolUse: boolean;
  usage: BananaUsage | null;
  done: boolean;
  /** Tear-down for this turn's image temp dir. Carried on the turn (not the
   *  session) so a stale idle event for a previous turn cannot delete the
   *  current turn's files. Idempotent; a no-op when the turn sent no images. */
  cleanup: () => void;
};

// `banana serve` has no internal turn timeout; if the backend stalls the SSE
// stream simply goes quiet. Default 120s of silence aborts the turn. The
// watchdog NEVER kills the shared server — it only ends the stuck turn.
const DEFAULT_STALL_TIMEOUT_MS = 120_000;
const SESSION_VALIDATION_TIMEOUT_MS = 5_000;

function stallTimeoutMs(): number {
  const raw = process.env.RIVENDELL_BANANA_STALL_TIMEOUT_MS;
  if (!raw) return DEFAULT_STALL_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALL_TIMEOUT_MS;
}

async function validateSessionExists(client: any, sessionID: string): Promise<string | null> {
  try {
    const result = await Promise.race([
      client.session.get({ sessionID }),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error(`session.get timed out after ${SESSION_VALIDATION_TIMEOUT_MS}ms`)),
          SESSION_VALIDATION_TIMEOUT_MS,
        ).unref();
      }),
    ]);
    const error = (result as any)?.error;
    return error ? errorText(error) : null;
  } catch (err) {
    return (err as Error).message;
  }
}

// The launchd service PATH often omits /opt/homebrew/bin, so resolve the
// banana binary to an absolute path. Honor BANANA_BIN, then Homebrew, then
// fall back to bare `banana`.
function resolveBananaBin(): string {
  const override = process.env.BANANA_BIN?.trim();
  if (override) return override;
  const homebrew = '/opt/homebrew/bin/banana';
  if (existsSync(homebrew)) return homebrew;
  const intel = '/usr/local/bin/banana';
  if (existsSync(intel)) return intel;
  return 'banana';
}

// One fixed free port for the lifetime of the app process. Picked once at
// module load so a serve restart reuses the same port (do NOT pick port 0
// per spawn — every restart would change the SDK baseUrl).
const SERVE_PORT = pickFixedPort();
function pickFixedPort(): number {
  const raw = process.env.RIVENDELL_BANANA_SERVE_PORT;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  // A high, unlikely-to-collide port. 41000-firsthalf range.
  return 41000 + Math.floor(Math.random() * 4000);
}

// ── OpenRouter via monkey-models ─────────────────────────────────────────
//
// Banana's built-in `openrouter` provider only autoloads when it has an API
// key. With no key it registers ZERO models, so any OpenRouter pick fails
// with "model not found". The fix: override the `openrouter` provider's
// baseURL + apiKey to point at the monkey-models proxy, which forwards any
// model id straight to OpenRouter (no bundled model list) and supplies the
// real OpenRouter key. We hand `banana serve` the override inline via the
// BANANA_CONFIG_CONTENT env var.
//
// The monkey base URL + default token are copied verbatim from banana-cli-2
// packages/opencode/src/provider/provider.ts (MONKEY_BASE_URL /
// MONKEY_DEFAULT_TOKEN), so the proxy key here matches the one Banana's
// own `monkey` provider uses.
const MONKEY_BASE_URL = 'https://monkey-models-production.up.railway.app/v1';
const MONKEY_DEFAULT_TOKEN =
  '086399eca157e4ad2fc0fecfb254da1118d226ac53371757267388b23bd10fa6';

/** Resolve the monkey-models auth token the SAME way Banana's own provider
 *  does (packages/opencode/src/provider/provider.ts):
 *  BANANA_MONKEY_TOKEN, then MONKEY_MODELS_TOKEN, then the bundled default.
 *  Missing the MONKEY_MODELS_TOKEN fallback would send a stale token (403)
 *  whenever a deploy rotates the proxy key via that var. */
function resolveMonkeyToken(): string {
  return (
    process.env.BANANA_MONKEY_TOKEN?.trim() ||
    process.env.MONKEY_MODELS_TOKEN?.trim() ||
    MONKEY_DEFAULT_TOKEN
  );
}

const MONKEY_MODEL_CATALOG_TTL_MS = 60 * 1000;
const MONKEY_MODEL_CATALOG_TIMEOUT_MS = 10_000;

let monkeyModelCatalogCache: unknown[] | null = null;
let monkeyModelCatalogAt = 0;
let monkeyModelCatalogInflight: Promise<unknown[]> | null = null;

type BananaPickerModel = {
  id: string;
  name: string;
  context_length?: number;
};

function numberFrom(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedModalities(value: unknown): string[] {
  if (!Array.isArray(value)) return ['text'];
  const allowed = new Set(['text', 'audio', 'image', 'video', 'pdf']);
  const out: string[] = [];
  for (const item of value) {
    const raw = String(item);
    const normalized = raw === 'file' ? 'pdf' : raw;
    if (allowed.has(normalized) && !out.includes(normalized)) out.push(normalized);
  }
  return out.length ? out : ['text'];
}

async function fetchMonkeyModelCatalog(): Promise<unknown[]> {
  const cached = monkeyModelCatalogCache;
  const fresh = cached !== null && Date.now() - monkeyModelCatalogAt < MONKEY_MODEL_CATALOG_TTL_MS;
  if (fresh) return cached;
  if (monkeyModelCatalogInflight) return monkeyModelCatalogInflight;

  monkeyModelCatalogInflight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MONKEY_MODEL_CATALOG_TIMEOUT_MS);
    try {
      const response = await fetch(`${MONKEY_BASE_URL}/models`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${resolveMonkeyToken()}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        console.warn(`[banana-runner] monkey model catalog returned ${response.status}, keeping prior catalog`);
        return monkeyModelCatalogCache ?? [];
      }
      const body = await response.json() as { data?: unknown[] };
      const models = Array.isArray(body.data) ? body.data : [];
      if (models.length > 0) {
        monkeyModelCatalogCache = models;
        monkeyModelCatalogAt = Date.now();
      }
      return monkeyModelCatalogCache ?? [];
    } catch (error) {
      const reason = (error as Error)?.name === 'AbortError'
        ? 'timeout'
        : ((error as Error)?.message || 'unknown error');
      console.warn(`[banana-runner] monkey model catalog fetch failed (${reason}), keeping prior catalog`);
      return monkeyModelCatalogCache ?? [];
    } finally {
      clearTimeout(timeout);
      monkeyModelCatalogInflight = null;
    }
  })();

  return monkeyModelCatalogInflight;
}

function toPickerModel(model: unknown): BananaPickerModel | null {
  const row = recordOf(model);
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  if (!id || !id.includes('/')) return null;
  const context = numberFrom(row.context_length, recordOf(row.top_provider).context_length);
  return {
    id,
    name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id,
    ...(context ? { context_length: context } : {}),
  };
}

function toProviderModelConfig(model: unknown): [string, Record<string, unknown>] | null {
  const row = recordOf(model);
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  if (!id || !id.includes('/')) return null;

  const architecture = recordOf(row.architecture);
  const topProvider = recordOf(row.top_provider);
  const supported = Array.isArray(row.supported_parameters)
    ? row.supported_parameters.map((item) => String(item))
    : [];
  const input = normalizedModalities(architecture.input_modalities);
  const outputModalities = normalizedModalities(architecture.output_modalities);
  const context = numberFrom(row.context_length, topProvider.context_length);
  const output = numberFrom(topProvider.max_completion_tokens, context) ?? context;
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id;
  const lower = `${id} ${name}`.toLowerCase();
  const reasoning = supported.includes('reasoning') ||
    supported.includes('include_reasoning') ||
    lower.includes('reasoning') ||
    lower.includes('thinking');

  const config: Record<string, unknown> = {
    id,
    name,
    attachment: input.some((item) => item !== 'text'),
    reasoning,
    temperature: supported.length === 0 || supported.includes('temperature'),
    tool_call: supported.length === 0 ||
      supported.includes('tools') ||
      supported.includes('tool_choice') ||
      supported.includes('function_calling'),
    modalities: { input, output: outputModalities },
  };
  if (context && output) {
    config.limit = {
      context,
      input: context,
      output,
    };
  }
  if (reasoning) {
    config.interleaved = { field: 'reasoning_details' };
  }
  return [id, config];
}

async function monkeyOpenRouterConfigModels(): Promise<Record<string, Record<string, unknown>>> {
  const rows = await fetchMonkeyModelCatalog();
  const out: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const next = toProviderModelConfig(row);
    if (next) out[next[0]] = next[1];
  }
  return out;
}

export async function listBananaOpenRouterModels(): Promise<BananaPickerModel[]> {
  const rows = await fetchMonkeyModelCatalog();
  return rows
    .map(toPickerModel)
    .filter((model): model is BananaPickerModel => model !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True unless explicitly disabled. A deploy can set
 *  RIVENDELL_BANANA_OPENROUTER_VIA_MONKEY to a falsy value to turn the
 *  override off without a code change. Accepts the common boolean-off
 *  spellings (false/0/no/off, any case) so `FALSE` or `0` also work. */
function openrouterViaMonkeyEnabled(): boolean {
  const raw = process.env.RIVENDELL_BANANA_OPENROUTER_VIA_MONKEY?.trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}

type BananaMcpConfig =
  | {
      type: 'local';
      command: string[];
      environment?: Record<string, string>;
      enabled?: boolean;
      timeout?: number;
    }
  | {
      type: 'remote';
      url: string;
      headers?: Record<string, string>;
      enabled?: boolean;
      oauth?: false | Record<string, string>;
      timeout?: number;
    }
  | { enabled: boolean };

const DEFAULT_MCP_MIRROR_SERVERS = new Set([
  'assistant-mcp',
  'playwright',
  'supabase-elite',
  'supabase-personal',
  'game-assets-mcp',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue;
    out[key] = String(item);
  }
  return Object.keys(out).length ? out : undefined;
}

function enabledByEnv(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

function shouldMirrorMcpServer(name: string): boolean {
  const raw = process.env.RIVENDELL_BANANA_MCP_MIRROR_SERVERS ?? process.env.BANANA_MCP_MIRROR_SERVERS;
  if (!raw?.trim()) return DEFAULT_MCP_MIRROR_SERVERS.has(name);
  const requested = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return requested.includes('*') || requested.includes(name);
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function isRelativePathLike(value: string): boolean {
  return (
    value === '.' ||
    value === '..' ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('.\\') ||
    value.startsWith('..\\')
  );
}

function resolveMcpPathPart(value: string, sourceDir: string): string {
  if (!isRelativePathLike(value) || isAbsolute(value) || isWindowsAbsolutePath(value)) return value;
  return resolve(sourceDir, value);
}

function stripJsoncForParse(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n' && input[i] !== '\r') i += 1;
      i -= 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) {
        if (input[i] === '\n' || input[i] === '\r') out += input[i];
        i += 1;
      }
      i += 1;
      continue;
    }
    out += ch;
  }

  let cleaned = '';
  inString = false;
  escaped = false;
  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i];
    if (inString) {
      cleaned += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      cleaned += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j += 1;
      if (out[j] === '}' || out[j] === ']') continue;
    }
    cleaned += ch;
  }
  return cleaned;
}

function parseJsoncObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(stripJsoncForParse(raw));
  if (!isRecord(parsed)) throw new Error('config content must be a JSON object');
  return parsed;
}

function mapClaudeMcpServer(name: string, value: unknown, sourceDir: string): BananaMcpConfig | null {
  if (!isRecord(value)) return null;
  if (value.enabled === false || value.disabled === true) return { enabled: false };

  const type = typeof value.type === 'string' ? value.type.toLowerCase() : '';
  const timeout = typeof value.timeout === 'number' && value.timeout > 0 ? value.timeout : undefined;

  const command = typeof value.command === 'string' ? value.command.trim() : '';
  if ((type === 'stdio' || type === 'local' || (!type && command)) && command) {
    const args = Array.isArray(value.args) ? value.args.map((arg) => resolveMcpPathPart(String(arg), sourceDir)) : [];
    const environment = toStringMap(value.env ?? value.environment);
    return {
      type: 'local',
      command: [resolveMcpPathPart(command, sourceDir), ...args],
      ...(environment ? { environment } : {}),
      ...(timeout ? { timeout } : {}),
    };
  }

  const url = typeof value.url === 'string' ? value.url.trim() : '';
  if ((type === 'http' || type === 'sse' || type === 'remote' || (!type && url)) && url) {
    const headers = toStringMap(value.headers);
    return {
      type: 'remote',
      url,
      ...(headers ? { headers } : {}),
      ...(timeout ? { timeout } : {}),
      // Matt's mirrored servers already carry their auth in config/env. Avoid
      // Banana's OAuth auto-detection trying to pop an interactive flow.
      oauth: false,
    };
  }

  console.warn(`[banana-runner] skipping unsupported Claude MCP server "${name}"`);
  return null;
}

function readClaudeMcpServers(projectPathHint?: string): Record<string, BananaMcpConfig> {
  if (enabledByEnv(process.env.RIVENDELL_BANANA_MCP_MIRROR_DISABLED ?? process.env.BANANA_MCP_MIRROR_DISABLED)) {
    return {};
  }

  const merged: Record<string, BananaMcpConfig> = {};
  const addServers = (servers: unknown, sourceDir: string) => {
    if (!isRecord(servers)) return;
    for (const [name, entry] of Object.entries(servers)) {
      if (!shouldMirrorMcpServer(name)) continue;
      const mapped = mapClaudeMcpServer(name, entry, sourceDir);
      if (mapped) merged[name] = mapped;
    }
  };

  const readJson = (filePath: string): Record<string, unknown> | null => {
    if (!existsSync(filePath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      return isRecord(parsed) ? parsed : null;
    } catch (error) {
      console.warn(`[banana-runner] failed to parse ${filePath} for MCP mirroring: ${errorText(error)}`);
      return null;
    }
  };

  const claudeConfigPath = process.env.CLAUDE_CONFIG_FILE?.trim() || join(homedir(), '.claude.json');
  const claudeConfig = readJson(claudeConfigPath);
  if (claudeConfig) addServers(claudeConfig.mcpServers, dirname(claudeConfigPath));

  const projects = claudeConfig && isRecord(claudeConfig.projects) ? claudeConfig.projects : undefined;
  const envProjectHint =
    process.env.RIVENDELL_BANANA_MCP_PROJECT_PATH ?? process.env.BANANA_MCP_PROJECT_PATH;
  const fallbackProjectHints = projectPathHint
    ? []
    : [process.env.ELROND_WORKSPACE_PATH, process.cwd()];
  const projectCandidates = [
    envProjectHint,
    projectPathHint,
    ...fallbackProjectHints,
  ].flatMap((item) => {
    if (typeof item !== 'string') return [];
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  });

  for (const projectPath of Array.from(new Set(projectCandidates))) {
    const mcpJson = readJson(join(projectPath, '.mcp.json'));
    if (mcpJson) addServers(mcpJson.mcpServers, projectPath);
    const project = projects?.[projectPath];
    if (isRecord(project)) addServers(project.mcpServers, projectPath);
  }

  const names = Object.keys(merged);
  if (names.length) {
    console.log(`[banana-runner] mirrored ${names.length} MCP server(s) into Banana: ${names.join(', ')}`);
  }
  return merged;
}

/** Inline JSON config that overrides Banana's `openrouter` provider to route
 *  through the monkey-models proxy. Passed to `banana serve` as
 *  BANANA_CONFIG_CONTENT.
 *
 *  If the parent environment already carries an inline Banana config
 *  (BANANA_CONFIG_CONTENT or its OPENCODE_CONFIG_CONTENT alias), the
 *  OpenRouter override is MERGED into it rather than replacing it wholesale,
 *  so operator-supplied providers/agents/permissions survive. A non-JSON or
 *  unparseable existing value is ignored (logged) and only the override is
 *  used — better than crashing the spawn. */
async function bananaConfigContent(projectPathHint?: string): Promise<string | null> {
  const includeOpenrouterProxy = openrouterViaMonkeyEnabled();
  const mirroredMcp = readClaudeMcpServers(projectPathHint);
  const override: any = {
    $schema: 'https://banana-code.dev/config.json',
  };
  if (includeOpenrouterProxy) {
    const models = await monkeyOpenRouterConfigModels();
    override.provider = {
      openrouter: {
        ...(Object.keys(models).length ? { models } : {}),
        options: {
          baseURL: MONKEY_BASE_URL,
          apiKey: resolveMonkeyToken(),
        },
      },
    };
  }
  if (Object.keys(mirroredMcp).length) override.mcp = mirroredMcp;
  const hasOverride = includeOpenrouterProxy || Object.keys(mirroredMcp).length > 0;

  const existingRaw = (
    process.env.BANANA_CONFIG_CONTENT ?? process.env.OPENCODE_CONFIG_CONTENT
  )?.trim();
  if (!existingRaw) return hasOverride ? JSON.stringify(override) : null;

  let existing: any;
  try {
    existing = parseJsoncObject(existingRaw);
  } catch {
    console.warn(
      '[banana-runner] existing BANANA_CONFIG_CONTENT is not valid JSON/JSONC, ignoring it and using generated Banana override only',
    );
    return hasOverride ? JSON.stringify(override) : null;
  }
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return hasOverride ? JSON.stringify(override) : null;
  }

  // Merge so the existing config's other providers, and even openrouter's
  // own `models`/extra `options`, are kept — only baseURL + apiKey are
  // forced to the proxy values.
  const existingProvider =
    existing.provider && typeof existing.provider === 'object' ? existing.provider : {};
  const existingOpenrouter =
    existingProvider.openrouter && typeof existingProvider.openrouter === 'object'
      ? existingProvider.openrouter
      : {};
  const existingOptions =
    existingOpenrouter.options && typeof existingOpenrouter.options === 'object'
      ? existingOpenrouter.options
      : {};
  const existingMcp = existing.mcp && typeof existing.mcp === 'object' ? existing.mcp : {};
  const existingOpenrouterModels =
    existingOpenrouter.models && typeof existingOpenrouter.models === 'object'
      ? existingOpenrouter.models
      : {};
  const overrideOpenrouterModels =
    override.provider?.openrouter?.models && typeof override.provider.openrouter.models === 'object'
      ? override.provider.openrouter.models
      : {};

  const merged: any = { ...existing, ...override };
  if (includeOpenrouterProxy) {
    merged.provider = {
      ...existingProvider,
      openrouter: {
        ...existingOpenrouter,
        options: {
          ...existingOptions,
          ...override.provider.openrouter.options,
        },
        ...(Object.keys(overrideOpenrouterModels).length || Object.keys(existingOpenrouterModels).length
          ? { models: { ...overrideOpenrouterModels, ...existingOpenrouterModels } }
          : {}),
      },
    };
  }
  if (Object.keys(mirroredMcp).length || Object.keys(existingMcp).length) {
    // Operator-supplied Banana MCP config wins over the mirrored Claude stack,
    // so a deploy can disable or replace one server without editing code.
    merged.mcp = {
      ...mirroredMcp,
      ...existingMcp,
    };
  }
  return JSON.stringify(merged);
}

/** Map an image media type to a file extension for the temp file banana reads.
 *  Falls back to the bare subtype (sans any `+suffix`) so an uncommon image
 *  type still produces a usable, sanitized extension. */
function imageExtension(mediaType: string): string {
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/gif') return 'gif';
  if (mediaType === 'image/webp') return 'webp';
  const subtype = mediaType.split('/')[1]?.split('+')[0] ?? 'img';
  return subtype.replace(/[^a-z0-9]/gi, '') || 'img';
}

/** Parse a model id into the SDK's { providerID, modelID } shape. Split on the
 *  FIRST '/': everything before is the provider, everything after (joined back
 *  with '/') is the model. So `monkey/silverback` -> {monkey, silverback} and
 *  `openrouter/anthropic/claude-3.7-sonnet` -> {openrouter, anthropic/claude-3.7-sonnet}. */
export function parseModel(modelId: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!modelId || typeof modelId !== 'string') return undefined;
  const trimmed = modelId.trim();
  if (!trimmed) return undefined;
  const slash = trimmed.indexOf('/');
  if (slash < 1 || slash >= trimmed.length - 1) return undefined;
  return {
    providerID: trimmed.slice(0, slash),
    modelID: trimmed.slice(slash + 1),
  };
}

// ── BananaServer: the module-level singleton ─────────────────────────────
//
// Owns the persistent `banana serve` child, the shared SDK client, and the
// single global SSE subscription. All BananaSessions share it. Each event on
// the stream is fanned out to the owning session by sessionID.

class BananaServer {
  private child: ChildProcess | null = null;
  private password = '';
  /** Resolves once the server is reachable. Recreated on each (re)start. */
  private readyPromise: Promise<void> | null = null;
  private dead = false;
  private starting = false;
  /** Incremented on every (re)start so a stale per-cwd SSE loop from a prior
   *  serve generation knows to exit instead of fighting the new one. */
  private generation = 0;

  currentGeneration(): number {
    return this.generation;
  }
  /** banana sessionID -> the BananaSession that owns it. */
  private readonly routes = new Map<string, BananaSession>();
  /** Directories with an active SSE subscription. The SDK pins `/event` to a
   *  directory, so a single global stream would only ever carry events for the
   *  server cwd. We run one subscription per distinct session cwd instead. */
  private readonly eventLoops = new Set<string>();
  /** When the serve child died, the next ensure() restarts after this delay. */
  private restartBackoffMs = 0;
  private lastDeathAtMs = 0;
  /** Inline config content used by the currently running serve process. */
  private configSignature = '';
  /** Rejects the in-flight start promise when a config-change restart supersedes it. */
  private startReject: ((e: Error) => void) | null = null;

  /** Lazily start (or restart) the serve process. Resolves when reachable. */
  async ensure(projectPathHint?: string): Promise<void> {
    const inlineConfig = await bananaConfigContent(projectPathHint);
    const configSignature = inlineConfig ?? '';
    if (this.readyPromise && !this.dead) {
      if (configSignature !== this.configSignature) {
        this.restartForConfigChange();
      } else {
        return this.readyPromise;
      }
    }
    if (this.dead) {
      // Small backoff between restarts so a crash-looping binary doesn't spin.
      const since = Date.now() - this.lastDeathAtMs;
      if (this.restartBackoffMs > 0 && since < this.restartBackoffMs) {
        await new Promise((r) => setTimeout(r, this.restartBackoffMs - since));
      }
      this.dead = false;
      this.readyPromise = null;
    }
    if (!this.readyPromise) {
      this.readyPromise = this.start(inlineConfig, configSignature);
    }
    const waitingOn = this.readyPromise;
    try {
      await waitingOn;
    } catch (err) {
      if (this.readyPromise === waitingOn) {
        this.dead = true;
        this.readyPromise = null;
        this.starting = false;
        this.configSignature = '';
        this.startReject = null;
        this.lastDeathAtMs = Date.now();
        this.restartBackoffMs = Math.min(Math.max(this.restartBackoffMs * 2, 1000), 15_000);
      }
      throw err;
    }
  }

  private restartForConfigChange(): void {
    this.generation += 1;
    this.configSignature = '';
    this.starting = false;
    const rejectStart = this.startReject;
    this.startReject = null;
    if (rejectStart) rejectStart(new Error('banana serve start superseded by config change'));
    this.eventLoops.clear();
    const owners = new Set(this.routes.values());
    this.routes.clear();
    this.readyPromise = null;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 3000).unref();
    }
    for (const session of owners) {
      session.onServerDeath('config changed, restarting banana serve');
    }
  }

  /** The shared SDK client, bound to a per-session directory. The SDK sends
   *  the directory as a header/query param, so one client per cwd is cheap. */
  clientFor(directory: string) {
    return createOpencodeClient({
      baseUrl: `http://127.0.0.1:${SERVE_PORT}`,
      directory,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`banana:${this.password}`).toString('base64'),
      },
    });
  }

  /** Register a session under its banana sessionID so the per-cwd event loop
   *  can fan events out to it. Safe to call repeatedly with the same id.
   *  Lazily starts an SSE subscription for the session's cwd if one is not
   *  already running, so events for that directory actually reach us. */
  registerRoute(bananaSessionId: string, session: BananaSession): void {
    this.routes.set(bananaSessionId, session);
    this.ensureEventLoop(session.cwd);
  }

  unregisterRoute(bananaSessionId: string): void {
    if (this.routes.get(bananaSessionId)) this.routes.delete(bananaSessionId);
  }

  isAlive(): boolean {
    return !this.dead && this.child !== null && this.child.exitCode === null;
  }

  shutdown(): void {
    this.dead = true;
    this.readyPromise = null;
    if (this.child) {
      try { this.child.kill('SIGTERM'); } catch {}
      this.child = null;
    }
  }

  // ── private ────────────────────────────────────────────────

  private async start(inlineConfig: string | null, configSignature: string): Promise<void> {
    if (this.starting) {
      // A concurrent ensure() is already starting; wait on its promise.
      if (this.readyPromise) return this.readyPromise;
    }
    this.starting = true;
    this.password = randomBytes(24).toString('hex');
    // New serve generation — any SSE loop from a prior generation will exit.
    this.generation += 1;
    const generation = this.generation;
    this.configSignature = configSignature;

    const bin = resolveBananaBin();
    const args = ['serve', '--port', String(SERVE_PORT), '--hostname', '127.0.0.1'];
    // Build the spawn env: always a random BANANA_SERVER_PASSWORD, and
    // (unless disabled) the BANANA_CONFIG_CONTENT override that routes the
    // `openrouter` provider through the monkey-models proxy.
    const serveEnv: NodeJS.ProcessEnv = {
      ...process.env,
      BANANA_SERVER_PASSWORD: this.password,
    };
    if (inlineConfig) serveEnv.BANANA_CONFIG_CONTENT = inlineConfig;
    const child = spawn(bin, args, {
      cwd: process.cwd(),
      // Never run unsecured: inject a random Basic-auth password.
      env: serveEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    console.log(`[banana serve] spawning ${bin} on 127.0.0.1:${SERVE_PORT} pid=${child.pid ?? '-'}`);

    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    const ready = new Promise<void>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    this.startReject = rejectReady;

    let settled = false;
    const isCurrentServe = () => this.child === child && this.generation === generation;
    const clearStartReject = () => {
      if (this.startReject === rejectReady) this.startReject = null;
    };
    const markReady = () => {
      if (!isCurrentServe()) return;
      if (settled) return;
      settled = true;
      this.starting = false;
      this.restartBackoffMs = 0;
      clearStartReject();
      console.log(`[banana serve] ready on 127.0.0.1:${SERVE_PORT}`);
      resolveReady();
      // Restart an SSE loop for every cwd that still has a live route, so a
      // serve restart reconnects streaming for in-progress conversations.
      const cwds = new Set(Array.from(this.routes.values()).map((s) => s.cwd));
      for (const cwd of cwds) this.ensureEventLoop(cwd);
    };
    const markFailed = (msg: string) => {
      if (!isCurrentServe()) return;
      if (settled) {
        // Already running and then it died — handled by the close handler.
        return;
      }
      settled = true;
      this.starting = false;
      clearStartReject();
      console.warn(`[banana serve] failed to start: ${msg}`);
      // Drive a full death so the next ensure() can restart through the normal
      // backoff path. Without this the rejected readyPromise would stick around
      // and brick Banana until the whole node process restarts.
      this.handleDeath(`startup failure: ${msg}`);
      rejectReady(new Error(`banana serve failed to start: ${msg}`));
    };

    const readyLine = new RegExp(
      `Banana Code server listening on http://127\\.0\\.0\\.1:${SERVE_PORT}`,
    );
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (!settled && readyLine.test(chunk)) markReady();
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      const text = String(chunk).trim();
      if (text) console.warn(`[banana serve stderr] ${text.slice(0, 400)}`);
    });

    child.on('error', (err) => {
      if (this.child !== child || this.generation !== generation) return;
      markFailed(err.message);
      this.handleDeath(`spawn error: ${err.message}`);
    });
    child.on('close', (code, signal) => {
      if (this.child !== child || this.generation !== generation) return;
      console.warn(`[banana serve] closed code=${code} signal=${signal ?? '-'}`);
      if (!settled) markFailed(`exited code=${code} before ready`);
      this.handleDeath(`process exited code=${code} signal=${signal ?? '-'}`);
    });

    // Backstop readiness: even without the log line, poll config.get() until
    // it answers. Whichever path resolves first wins.
    void this.pollReady(markReady, markFailed, () => settled);

    return ready;
  }

  /** Poll `sdk.config.get()` until it succeeds (covers a serve build whose
   *  ready log line ever changes). Gives up after ~30s. */
  private async pollReady(
    markReady: () => void,
    markFailed: (msg: string) => void,
    isSettled: () => boolean,
  ): Promise<void> {
    const client = this.clientFor(process.cwd());
    const deadline = Date.now() + 30_000;
    while (!isSettled()) {
      if (this.child?.exitCode !== null && this.child?.exitCode !== undefined) return;
      try {
        const res = await client.config.get();
        if (!res.error) {
          markReady();
          return;
        }
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        markFailed('readiness poll timed out after 30s');
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  /** Mark the server dead, fail every in-flight turn, and clear routes so the
   *  next send() lazily restarts. Kills the child if it is somehow still alive
   *  (e.g. a readiness-poll timeout where the process never answered but did
   *  not exit) so a stuck serve does not linger holding the port. */
  private handleDeath(reason: string): void {
    if (this.dead) return;
    this.dead = true;
    this.starting = false;
    this.lastDeathAtMs = Date.now();
    this.restartBackoffMs = Math.min(Math.max(this.restartBackoffMs * 2, 1000), 15_000);
    this.readyPromise = null;
    // Drop all SSE-loop bookkeeping — the loops detect the generation bump /
    // dead flag and exit on their own; ensureEventLoop must be free to start
    // fresh ones after the next restart.
    this.eventLoops.clear();
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      try { child.kill('SIGTERM'); } catch {}
      // SIGKILL backstop if SIGTERM doesn't take it down promptly.
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 3000).unref();
    }
    const owners = new Set(this.routes.values());
    this.routes.clear();
    for (const session of owners) {
      session.onServerDeath(reason);
    }
  }

  /** Start an SSE subscription for `cwd` if one is not already running. The
   *  SDK pins `/event` to a directory, so each distinct session cwd needs its
   *  own stream — a single global loop would silently drop events for every
   *  repo other than the server process cwd. */
  private ensureEventLoop(cwd: string): void {
    if (this.dead) return;
    if (this.eventLoops.has(cwd)) return;
    this.eventLoops.add(cwd);
    void this.runEventLoop(cwd, this.generation);
  }

  /** One SSE loop, scoped to a single directory. Every event is fanned out to
   *  the owning BananaSession by sessionID. Reconnects if the stream ends
   *  while the server is alive; exits on death or a serve-generation bump. */
  private async runEventLoop(cwd: string, generation: number): Promise<void> {
    try {
      while (!this.dead && this.generation === generation) {
        const client = this.clientFor(cwd);
        try {
          // The v2 /event stream is directory-scoped — subscribe() with no
          // directory delivers events only for the serve process cwd, so a
          // session in any other repo would never see its turn events and
          // hang forever. Pass the loop's cwd explicitly.
          const events = await client.event.subscribe({ directory: cwd });
          for await (const event of events.stream) {
            if (this.dead || this.generation !== generation) break;
            this.fanOut(event as Event);
          }
        } catch (err) {
          if (this.dead || this.generation !== generation) break;
          console.warn(`[banana serve] event stream error (${cwd}): ${(err as Error).message}`);
        }
        if (this.dead || this.generation !== generation) break;
        // Stream ended but the server is (apparently) still alive — reconnect
        // after a short pause.
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      // Only release the slot if it still belongs to this generation; a newer
      // ensureEventLoop may already have re-added it after a restart.
      if (this.generation === generation) this.eventLoops.delete(cwd);
    }
  }

  /** Route one SSE event to its owning session by sessionID. Events without a
   *  resolvable sessionID (server-global noise) are dropped. */
  private fanOut(event: Event): void {
    const sessionId = extractSessionId(event);
    if (!sessionId) return;
    const session = this.routes.get(sessionId);
    if (!session) return;
    session.handleServerEvent(event);
  }
}

/** Pull the owning sessionID out of any SSE event shape. */
function extractSessionId(event: Event): string | null {
  const props = (event as { properties?: Record<string, unknown> }).properties;
  if (!props) return null;
  if (typeof props.sessionID === 'string') return props.sessionID;
  // message.part.* carry it on the nested part.
  const part = props.part as { sessionID?: unknown } | undefined;
  if (part && typeof part.sessionID === 'string') return part.sessionID;
  // message.updated carries it on info.
  const info = props.info as { sessionID?: unknown } | undefined;
  if (info && typeof info.sessionID === 'string') return info.sessionID;
  return null;
}

/** The single shared server instance for this app process. */
const bananaServer = new BananaServer();

// ── BananaSession ────────────────────────────────────────────────────────

export class BananaSession {
  readonly key: string;
  readonly cli: CliKind = 'banana';
  readonly cwd: string;
  readonly chatId: string;
  private listeners = new Set<Listener>();
  private subscriberCount = 0;
  /** banana sessionID, captured on create, persisted for resume. */
  private threadId: string | null = null;
  private threadServeGeneration: number | null = null;
  private busy = false;
  private dead = false;
  private eventLog: SeqEvent[] = [];
  private nextSeq = 1;
  /** Assistant message ids already used by this long-lived banana session.
   *  Prevents delayed events from a previous prompt from rendering into the
   *  next prompt once a reused opencode session goes quiet. */
  private seenMessageIds = new Set<string>();
  private lastActivityAtMs = Date.now();
  /** Per-turn streaming state — non-null only while busy. */
  private turn: BananaTurnState | null = null;
  /** Stall watchdog handle for the active turn. */
  private watchdog: NodeJS.Timeout | null = null;
  /** Cleanup for the current turn's image temp dir — runs once the turn ends
   *  (success, failure, or shutdown). Null when the turn sent no images. */
  private turnCleanup: (() => void) | null = null;
  /** Persistent serve means readiness is per-server, not per-session. */
  readonly ready: Promise<boolean> = Promise.resolve(true);

  constructor(cwd: string, chatId: string, threadId: string | null) {
    this.cwd = cwd;
    this.chatId = chatId;
    this.key = keyOf(cwd, chatId);
    this.threadId = threadId;

    // Mirror the claude/codex path: rehydrate eventLog from disk so a server
    // restart between turns doesn't strand a reconnecting client.
    try {
      const restored = loadEventLogSync(this.key);
      if (restored.events.length > 0) {
        this.eventLog = restored.events;
        this.nextSeq = restored.nextSeq;
        console.log(
          `[chat banana] restored ${restored.events.length} event(s) from disk for ${this.key} (nextSeq=${this.nextSeq})`,
        );
      }
    } catch (err) {
      console.warn(`[chat banana] event-log restore failed for ${this.key}:`, (err as Error).message);
    }
    void compactEventLog(this.key);

    // If we already know our banana sessionID, register the route up front so
    // a turn started elsewhere (or events that arrive before send) still land.
    if (this.threadId) bananaServer.registerRoute(this.threadId, this);
  }

  subscribe(fn: Listener, sinceSeq = -1, countSubscriber = true): () => void {
    if (sinceSeq >= 0) {
      for (const se of this.eventLog) {
        if (se.seq > sinceSeq) fn(se);
      }
    }
    this.listeners.add(fn);
    if (countSubscriber) this.subscriberCount += 1;
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(fn);
      if (countSubscriber) {
        this.subscriberCount = Math.max(0, this.subscriberCount - 1);
        if (this.subscriberCount === 0) this.lastActivityAtMs = Date.now();
      }
    };
  }

  latestSeq(): number {
    return this.nextSeq - 1;
  }

  isAlive(): boolean {
    return !this.dead;
  }

  isBusy(): boolean {
    return this.busy;
  }

  sessionId(): string | null {
    return this.threadId;
  }

  listenerCount(): number {
    return this.subscriberCount;
  }

  lastActivityAt(): number {
    return this.lastActivityAtMs;
  }

  shutdown(): void {
    this.dead = true;
    this.clearWatchdog();
    // Drop any image temp dir so a shutdown mid-turn does not leak it. The
    // cleanup lives on the turn once a turn exists, and on turnCleanup during
    // the pre-turn setup window — clear both.
    this.turn?.cleanup();
    this.turnCleanup?.();
    this.turnCleanup = null;
    // If a turn is mid-flight (stop / steer / tab close), tell the banana
    // server to abort it too. Without this the prompt keeps running server
    // side and its late events could leak into a future turn of this session.
    if (this.busy && this.threadId) this.abortServerTurn();
    if (this.threadId) bananaServer.unregisterRoute(this.threadId);
  }

  /** Fire-and-forget abort of the in-flight server-side prompt for this
   *  session. Best-effort: failures are logged, not surfaced. */
  private abortServerTurn(): void {
    const sessionID = this.threadId;
    if (!sessionID) return;
    void (async () => {
      try {
        const client = bananaServer.clientFor(this.cwd);
        await client.session.abort({ sessionID });
      } catch (err) {
        console.warn(`[chat banana] session.abort failed: ${(err as Error).message}`);
      }
    })();
  }

  private async clearSavedThreadId(reason: string): Promise<void> {
    const old = this.threadId;
    if (!old) return;
    console.warn(`[chat banana] clearing stale session ${old}: ${reason}`);
    bananaServer.unregisterRoute(old);
    this.threadId = null;
    this.threadServeGeneration = null;
    await setSessionId('banana', this.cwd, '', this.chatId);
  }

  async send(text: string, images?: ChatImage[], opts?: { model?: string }): Promise<void> {
    if (this.busy) {
      this.emit({
        type: 'error',
        message: 'banana is still answering — wait for the current turn to finish',
      });
      return;
    }
    this.busy = true;
    // Echo for reconnect replay (banana's events don't re-emit the user prompt).
    this.emit({
      type: 'event',
      event: { type: '_user_echo', text, imageCount: images?.length ?? 0, ts: Date.now() },
    });

    // Write image attachments to temp files; banana's prompt parts reference
    // them by file:// URL (the same mechanism the run path uses). The temp dir
    // is torn down when this turn ends. `cleanupImages` is idempotent (the
    // null-out makes a second call a no-op) and swallows rm failures so a
    // cleanup error can never crash the process with an unhandled rejection.
    // It is held on `turnCleanup` only for the pre-turn-state window (an early
    // setup failure or a shutdown before the turn object exists); once the
    // turn object is built it owns the cleanup, so a stale idle event for a
    // previous turn can never delete this turn's files.
    let imageTempDir: string | null = null;
    const cleanupImages = () => {
      const dir = imageTempDir;
      imageTempDir = null;
      if (dir) {
        void rm(dir, { recursive: true, force: true }).catch((err) => {
          console.warn(`[chat banana] image temp cleanup failed (${dir}): ${(err as Error).message}`);
        });
      }
    };
    this.turnCleanup = cleanupImages;

    const fileParts: Array<{ type: 'file'; url: string; filename: string; mime: string }> = [];
    try {
      if (images?.length) {
        imageTempDir = await mkdtemp(join(tmpdir(), 'rivendell-banana-images-'));
        for (const [index, image] of images.entries()) {
          if (!image.mediaType.startsWith('image/')) {
            throw new Error(`unsupported image media type: ${image.mediaType}`);
          }
          const ext = imageExtension(image.mediaType);
          const filename = `image-${index + 1}.${ext}`;
          const path = join(imageTempDir, filename);
          await writeFile(path, Buffer.from(image.base64, 'base64'));
          fileParts.push({
            type: 'file',
            url: pathToFileURL(path).href,
            filename,
            mime: image.mediaType,
          });
        }
      }
    } catch (err) {
      this.failTurn(`image preparation failed: ${(err as Error).message}`);
      return;
    }
    // The session was shut down (tab close / stop) while images were being
    // written. Bail before touching the server so banana never receives URLs
    // for a temp dir shutdown() already deleted.
    if (this.dead) {
      this.turnCleanup?.();
      this.turnCleanup = null;
      this.busy = false;
      return;
    }

    // 1. Make sure the shared serve process is up.
    try {
      await bananaServer.ensure(this.cwd);
    } catch (err) {
      this.failTurn(`banana serve unavailable: ${(err as Error).message}`);
      return;
    }
    if (this.dead) {
      this.turnCleanup?.();
      this.turnCleanup = null;
      this.busy = false;
      return;
    }

    const client = bananaServer.clientFor(this.cwd);
    const serveGeneration = bananaServer.currentGeneration();

    // 2. Reuse the saved sessionID only if this banana serve process can see
    //    it. A persisted id can outlive the serve instance that owned it;
    //    prompting that stale id hangs silently with no SSE events.
    if (this.threadId && this.threadServeGeneration !== serveGeneration) {
      await this.clearSavedThreadId('banana serve restarted');
    }
    if (this.threadId) {
      const staleReason = await validateSessionExists(client, this.threadId);
      if (staleReason) await this.clearSavedThreadId(staleReason);
    }

    // 3. Reuse the validated sessionID, or create a new one with the plan ruleset.
    if (!this.threadId) {
      try {
        const created = await client.session.create({
          title: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
          permission: PLAN_RULESET,
        });
        const newId = created.data?.id;
        if (!newId) {
          this.failTurn('banana session.create returned no id');
          return;
        }
        this.threadId = newId;
        this.threadServeGeneration = serveGeneration;
        await setSessionId('banana', this.cwd, newId, this.chatId);
        this.emit({ type: 'event', event: { type: 'system', subtype: 'init', session_id: newId } });
      } catch (err) {
        this.failTurn(`banana session.create failed: ${(err as Error).message}`);
        return;
      }
    }
    if (this.dead) {
      this.turnCleanup?.();
      this.turnCleanup = null;
      this.busy = false;
      return;
    }

    // 4. Register the route so the shared event loop fans events to us.
    bananaServer.registerRoute(this.threadId, this);

    // 5. Open per-turn streaming state and arm the stall watchdog. The image
    //    cleanup moves onto the turn object now, so only this turn's own end
    //    (completeTurn / failTurn) tears its files down — a stale idle for a
    //    prior turn can no longer reach them.
    this.turn = {
      messageId: synth('msg'),
      nextBlockIndex: 0,
      messageStarted: false,
      parts: new Map(),
      bufferedDeltas: new Map(),
      assistantMessageId: null,
      promptAccepted: false,
      sawToolUse: false,
      usage: null,
      done: false,
      cleanup: cleanupImages,
    };
    this.turnCleanup = null;
    this.armWatchdog();

    // 6. Fire the prompt. `prompt` resolves when the turn completes server
    //    side, but we drive the UI off the streamed events; the turn formally
    //    ends on the `session.status: idle` event. We still await to surface a
    //    request-level failure (auth, model not found, etc.).
    const model = parseModel(opts?.model);
    const thisTurn = this.turn;
    try {
      const res = await client.session.prompt({
        sessionID: this.threadId,
        ...(model ? { model } : {}),
        parts: [...fileParts, { type: 'text' as const, text }],
      });
      // The prompt was accepted by the server. Mark THIS turn so a
      // `session.status idle` is now honored as completion (guarded against
      // the turn having already settled and been replaced).
      if (this.turn === thisTurn && !thisTurn.done) {
        thisTurn.promptAccepted = true;
      }
      if (res.error) {
        const message = errorText(res.error);
        // If the stream already finished the turn, don't double-end it.
        if (this.turn && !this.turn.done) {
          this.failTurn(`banana prompt failed: ${message}`);
        }
      }
    } catch (err) {
      if (this.turn && !this.turn.done) {
        this.failTurn(`banana prompt failed: ${(err as Error).message}`);
      }
    }
  }

  // ── server-event entry points ──────────────────────────────

  /** Called by BananaServer when its serve child dies. Fail any in-flight
   *  turn so the UI shows an error instead of freezing. */
  onServerDeath(reason: string): void {
    if (this.busy && this.turn && !this.turn.done) {
      this.failTurn(`banana server stopped: ${reason}`);
    }
  }

  /** Called by BananaServer's fan-out for every event whose sessionID is ours. */
  handleServerEvent(event: Event): void {
    if (!this.busy || !this.turn || this.turn.done) return;
    const state = this.turn;

    switch (event.type) {
      case 'message.updated': {
        const info = event.properties.info;
        if (info.role !== 'assistant') return;
        if (state.assistantMessageId && state.assistantMessageId !== info.id) {
          if (!this.trySwitchAssistantMessage(info.id, state)) return;
        } else {
          if (!this.tryAnchorAssistantMessage(info.id, state)) return;
        }
        // The turn has a real assistant message — a later idle is now its own.
        state.promptAccepted = true;
        this.armWatchdog();
        this.ensureMessageStart(state);
        return;
      }
      case 'message.part.updated': {
        const part = event.properties.part as { messageID?: unknown } | undefined;
        const messageID = part && typeof part.messageID === 'string' ? part.messageID : undefined;
        // Do NOT anchor from a part.updated: a part carries no role, and the
        // user message's own text part can arrive first — anchoring to it
        // would render the prompt straight back as the answer. Anchoring is
        // driven by deltas (only the assistant streams) and by an assistant
        // message.updated. Drop part.updateds until the turn anchors; the
        // text reconciler backfills their content from a later snapshot.
        if (!this.belongsToTurn(messageID, state, false)) return;
        this.armWatchdog();
        this.handlePartUpdated(event.properties.part, state);
        return;
      }
      case 'message.part.delta': {
        // Deltas only ever stream for the assistant message — a user message
        // is created whole and never streamed. So the first delta reliably
        // identifies this turn's assistant message; anchor to it.
        if (!this.belongsToTurn(event.properties.messageID, state, true)) return;
        this.armWatchdog();
        this.handlePartDelta(event.properties.partID, event.properties.field, event.properties.delta, state);
        return;
      }
      case 'session.error': {
        if (event.properties.sessionID && event.properties.sessionID !== this.threadId) return;
        this.armWatchdog();
        this.emit({ type: 'error', message: errorText(event.properties.error) });
        return;
      }
      case 'session.status': {
        if (event.properties.sessionID !== this.threadId) return;
        this.armWatchdog();
        if (event.properties.status.type === 'idle') {
          // Only honor idle once this turn's prompt was accepted (or the turn
          // anchored). A trailing idle from the PREVIOUS prompt — the banana
          // session is reused — can otherwise land before this turn's prompt
          // is accepted and fake-complete it before the real answer streams.
          if (!state.promptAccepted) return;
          this.completeTurn(state);
        }
        return;
      }
      case 'permission.asked': {
        if (event.properties.sessionID !== this.threadId) return;
        this.armWatchdog();
        void this.replyToPermission(event.properties.id);
        return;
      }
      default:
        return;
    }
  }

  /** True if a part event belongs to the current turn.
   *
   *  `mayAnchor` is true ONLY for message.part.delta: a delta is emitted just
   *  for the assistant message (a user message is created whole, never
   *  streamed), so the first delta reliably anchors the turn. A part.updated
   *  carries no role and the user message's own text part can arrive first,
   *  so it must never anchor — it is dropped until a delta (or an assistant
   *  message.updated) anchors the turn; the text reconciler then backfills
   *  the snapshot content.
   *
   *  A part event with no usable messageID is dropped: it cannot be proven to
   *  belong to this turn, and accepting it would let a message-less user
   *  part.updated render the prompt back as the answer — the exact bug the
   *  delta-driven anchoring closes. */
  private belongsToTurn(
    messageID: string | undefined,
    state: BananaTurnState,
    mayAnchor: boolean,
  ): boolean {
    if (typeof messageID !== 'string' || !messageID) return false;
    if (!state.assistantMessageId) {
      if (!mayAnchor) return false;
      // First delta of the turn — adopt it as the turn anchor. The turn now
      // has a real assistant message, so a later idle is its own.
      return this.tryAnchorAssistantMessage(messageID, state);
    }
    if (state.assistantMessageId === messageID) return true;
    return mayAnchor ? this.trySwitchAssistantMessage(messageID, state) : false;
  }

  private tryAnchorAssistantMessage(messageID: unknown, state: BananaTurnState): boolean {
    if (typeof messageID !== 'string' || !messageID) return false;
    if (this.seenMessageIds.has(messageID)) return false;
    state.assistantMessageId = messageID;
    state.promptAccepted = true;
    this.rememberSeenMessageId(messageID);
    this.ensureMessageStart(state);
    return true;
  }

  /** Switch to a later assistant message in the same turn. Required for MCP
   *  tool use: opencode emits a tool_use assistant message, then a second
   *  assistant message with the final answer after tool_result blocks. */
  private trySwitchAssistantMessage(messageID: string, state: BananaTurnState): boolean {
    if (messageID === state.assistantMessageId) return true;
    if (this.seenMessageIds.has(messageID)) return false;
    if (!state.sawToolUse) {
      this.rememberSeenMessageId(messageID);
      return false;
    }
    if (this.hasOpenBlocks(state)) return false;

    state.assistantMessageId = messageID;
    state.messageId = synth('msg');
    state.nextBlockIndex = 0;
    state.messageStarted = false;
    state.parts.clear();
    state.bufferedDeltas.clear();
    state.promptAccepted = true;
    this.rememberSeenMessageId(messageID);
    this.ensureMessageStart(state);
    return true;
  }

  private rememberSeenMessageId(messageID: string): void {
    if (this.seenMessageIds.has(messageID)) return;
    this.seenMessageIds.add(messageID);
    if (this.seenMessageIds.size > 256) {
      const oldest = this.seenMessageIds.values().next().value;
      if (oldest !== undefined) this.seenMessageIds.delete(oldest);
    }
  }

  private hasOpenBlocks(state: BananaTurnState): boolean {
    for (const rec of state.parts.values()) {
      if (rec.started && !rec.closed) return true;
    }
    return false;
  }

  // ── streaming normalization ────────────────────────────────

  /** message.part.updated — a part was created or progressed. Open answer text
   *  blocks on first sight, suppress reasoning scratchpad parts, flush any
   *  deltas that arrived early, and on time.end close the block. Tool parts
   *  get the v1 tool handling.
   *  `part` is the SDK `Part` union; it is read structurally here. */
  private handlePartUpdated(part: any, state: BananaTurnState): void {
    if (!part || typeof part !== 'object') return;
    this.ensureMessageStart(state);
    const partID: string = typeof part.id === 'string' ? part.id : '';
    const type: string = typeof part.type === 'string' ? part.type : '';

    if (type === 'step-finish' && part.tokens && typeof part.tokens === 'object') {
      const t = part.tokens as Record<string, unknown>;
      const input = Number(t.input ?? 0);
      const output = Number(t.output ?? 0);
      const cache = (t.cache && typeof t.cache === 'object' ? t.cache : {}) as Record<string, unknown>;
      state.usage = {
        input_tokens: Math.max(0, input),
        cache_read_input_tokens: Math.max(0, Number(cache.read ?? 0)),
        cache_creation_input_tokens: Math.max(0, Number(cache.write ?? 0)),
        output_tokens: Math.max(0, output),
      };
      return;
    }

    if (type === 'reasoning') {
      if (!partID) return;
      let rec = state.parts.get(partID);
      if (!rec) {
        rec = { index: -1, kind: 'reasoning', started: false, emittedLen: 0, closed: false };
        state.parts.set(partID, rec);
      }
      if (typeof part.text === 'string') rec.emittedLen = part.text.length;
      state.bufferedDeltas.delete(partID);
      const ended = part.time && typeof part.time === 'object' && part.time.end != null;
      if (ended) rec.closed = true;
      return;
    }

    if (type === 'text') {
      if (!partID) return;
      let rec = state.parts.get(partID);
      // The block is already closed. A repeated or replayed final snapshot for
      // the same partID lands here; ignore it so the answer is not re-emitted
      // as a duplicate block.
      if (rec && rec.closed) return;
      if (!rec) {
        // First sight of this part — open a fresh claude text block.
        const index = state.nextBlockIndex++;
        rec = { index, kind: 'text', started: true, emittedLen: 0, closed: false };
        state.parts.set(partID, rec);
        this.emitStream({
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '' },
        });
        // Flush deltas that raced ahead of this part-created event.
        const buffered = state.bufferedDeltas.get(partID);
        if (buffered?.length) {
          for (const d of buffered) {
            rec.emittedLen += d.length;
            this.emitStream({
              type: 'content_block_delta',
              index,
              delta: { type: 'text_delta', text: d },
            });
          }
          state.bufferedDeltas.delete(partID);
        }
      }
      // Reconcile against the snapshot. `part.text` is the full accumulated
      // text of this block; streaming deltas are an optimization layered on
      // top. Emitting only the un-emitted remainder here means a dropped or
      // pre-anchor delta can never lose text — every snapshot backfills it.
      if (typeof part.text === 'string' && part.text.length > rec.emittedLen) {
        const remainder = part.text.slice(rec.emittedLen);
        rec.emittedLen = part.text.length;
        this.emitStream({
          type: 'content_block_delta',
          index: rec.index,
          delta: { type: 'text_delta', text: remainder },
        });
      }
      // A text/reasoning part with time.end is finished — close its block
      // once. The record is kept (not deleted) with `closed = true` so a
      // later duplicate snapshot for this partID cannot recreate it.
      const ended = part.time && typeof part.time === 'object' && part.time.end != null;
      if (ended) {
        rec.closed = true;
        this.emitStream({ type: 'content_block_stop', index: rec.index });
      }
      return;
    }

    if (type === 'tool') {
      this.handleToolPart(part, state);
      return;
    }

    // step-start and other part types — nothing to normalize.
  }

  /** message.part.delta — incremental token text. The delta only carries
   *  partID + field, so route it via the partID -> block-record map built from
   *  prior message.part.updated events. Buffer it if the part isn't open yet. */
  private handlePartDelta(partID: string, field: string, delta: string, state: BananaTurnState): void {
    if (field !== 'text' || typeof delta !== 'string' || !delta) return;
    const rec = state.parts.get(partID);
    if (!rec) {
      // Delta raced ahead of its part-created event — buffer until it lands.
      const buf = state.bufferedDeltas.get(partID) ?? [];
      buf.push(delta);
      state.bufferedDeltas.set(partID, buf);
      return;
    }
    if (rec.kind === 'reasoning') {
      rec.emittedLen += delta.length;
      return;
    }
    if (rec.kind !== 'text') return;
    // The block was already closed (a late delta after content_block_stop).
    // Dropping it keeps the closed block immutable on the frontend.
    if (rec.closed) return;
    // Advance emittedLen so the part.updated snapshot reconciler emits only
    // the remainder past what these deltas already streamed.
    rec.emittedLen += delta.length;
    this.emitStream({
      type: 'content_block_delta',
      index: rec.index,
      delta: { type: 'text_delta', text: delta },
    });
  }

  /** Tool parts: open a tool_use block on `running`, then on completed/error
   *  close it and emit a synthetic user tool_result the way v1 / claude do. */
  private handleToolPart(part: any, state: BananaTurnState): void {
    state.sawToolUse = true;
    const callID: string = typeof part.callID === 'string' ? part.callID : (typeof part.id === 'string' ? part.id : synth('call'));
    const toolName: string = typeof part.tool === 'string' ? part.tool : 'tool';
    const stateBlock = part.state ?? {};
    const status: string = typeof stateBlock.status === 'string' ? stateBlock.status : '';
    const partID: string = typeof part.id === 'string' ? part.id : callID;

    let rec = state.parts.get(partID);
    if (!rec && (status === 'running' || status === 'pending')) {
      const index = state.nextBlockIndex++;
      rec = { index, kind: 'tool', started: true, emittedLen: 0, closed: false };
      state.parts.set(partID, rec);
      const toolUseId = synth('tool');
      // Stash the toolUseId on the record so completed can reference it.
      (rec as any).toolUseId = toolUseId;
      this.emitStream({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: toolUseId, name: toolName },
      });
      this.emitStream({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(stateBlock.input ?? {}) },
      });
      return;
    }

    if (rec && (status === 'completed' || status === 'error')) {
      const toolUseId: string = (rec as any).toolUseId ?? synth('tool');
      this.emitStream({ type: 'content_block_stop', index: rec.index });
      const output: string = status === 'completed'
        ? (typeof stateBlock.output === 'string' ? stateBlock.output : '')
        : (typeof stateBlock.error === 'string' ? stateBlock.error : 'tool error');
      this.emit({
        type: 'event',
        event: {
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text: output }] },
            ],
          },
        },
      });
      state.parts.delete(partID);
    }
  }

  /** Auto-reply to a permission request: 'once' normally, 'reject' in plan
   *  mode. Banana chat runs unsandboxed (skip-permissions equivalent), so the
   *  default reply is 'once'. */
  private async replyToPermission(requestID: string): Promise<void> {
    const planMode = process.env.RIVENDELL_BANANA_PLAN_MODE === 'true';
    try {
      const client = bananaServer.clientFor(this.cwd);
      await client.permission.reply({ requestID, reply: planMode ? 'reject' : 'once' });
    } catch (err) {
      console.warn(`[chat banana] permission.reply failed: ${(err as Error).message}`);
    }
  }

  // ── turn lifecycle ─────────────────────────────────────────

  /** Lazily emit the synthetic message_start the reducer expects per turn. */
  private ensureMessageStart(state: BananaTurnState): void {
    if (state.messageStarted) return;
    state.messageStarted = true;
    this.emitStream({
      type: 'message_start',
      message: { id: state.messageId, role: 'assistant' },
    });
  }

  /** Normal turn end: session.status went idle. Close any dangling blocks,
   *  emit the synthetic result + turnEnd. Does NOT touch the shared server. */
  private completeTurn(state: BananaTurnState): void {
    if (state.done) return;
    state.done = true;
    this.clearWatchdog();
    // Tear down this turn's image temp dir now that the turn is over.
    state.cleanup();
    this.closeDanglingBlocks(state, 'Banana finished before this block closed.');
    this.emit({
      type: 'event',
      event: {
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: this.threadId ?? undefined,
        usage: state.usage ?? undefined,
      },
    });
    this.busy = false;
    this.turn = null;
    this.emit({ type: 'turnEnd', sessionId: this.threadId ?? undefined });
  }

  /** Abnormal turn end: an error, a stall, or the server died. Emits an error,
   *  a synthetic result, and turnEnd so the UI recovers. */
  private failTurn(message: string): void {
    const state = this.turn;
    if (state) {
      if (state.done) return;
      state.done = true;
      this.closeDanglingBlocks(state, 'Banana stopped before this block closed.');
    }
    this.clearWatchdog();
    // Tear down the failed turn's image temp dir. Once the turn object exists
    // it owns the cleanup; before that (an early setup failure) it is still on
    // turnCleanup. Run whichever applies.
    if (state) {
      state.cleanup();
    } else {
      this.turnCleanup?.();
    }
    this.turnCleanup = null;
    this.emit({ type: 'error', message });
    this.emit({
      type: 'event',
      event: {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        session_id: this.threadId ?? undefined,
        usage: state?.usage ?? undefined,
      },
    });
    this.busy = false;
    this.turn = null;
    this.emit({ type: 'turnEnd', sessionId: this.threadId ?? undefined });
  }

  /** Close every still-open claude block (text/reasoning/tool) so the front-end
   *  reducer doesn't leave them spinning. Records already closed (a text block
   *  that saw its time.end) are skipped — their content_block_stop already
   *  went out. */
  private closeDanglingBlocks(state: BananaTurnState, toolFallback: string): void {
    for (const [, rec] of state.parts) {
      if (rec.kind === 'reasoning') continue;
      if (rec.closed) continue;
      rec.closed = true;
      this.emitStream({ type: 'content_block_stop', index: rec.index });
      if (rec.kind === 'tool') {
        const toolUseId: string = (rec as any).toolUseId ?? synth('tool');
        this.emit({
          type: 'event',
          event: {
            type: 'user',
            message: {
              role: 'user',
              content: [
                { type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text: toolFallback }] },
              ],
            },
          },
        });
      }
    }
    state.parts.clear();
    state.bufferedDeltas.clear();
  }

  // ── stall watchdog ─────────────────────────────────────────

  private armWatchdog(): void {
    this.clearWatchdog();
    const timeoutMs = stallTimeoutMs();
    this.watchdog = setTimeout(() => {
      if (!this.busy || !this.turn || this.turn.done) return;
      console.warn(
        `[chat banana] stall watchdog fired after ${timeoutMs}ms of silence cwd=${this.cwd}`,
      );
      // Abort the stuck prompt on the server too so its late events can't leak
      // into the next turn, then end this turn locally. The shared serve
      // process is never killed — only this session's prompt.
      this.abortServerTurn();
      this.failTurn(`banana stalled — no output for ${Math.round(timeoutMs / 1000)}s, the turn was aborted`);
    }, timeoutMs);
    this.watchdog.unref();
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  // ── emit helpers ───────────────────────────────────────────

  private emit(msg: SessionEvent): void {
    this.lastActivityAtMs = Date.now();
    const se: SeqEvent = { seq: this.nextSeq++, ev: msg };
    this.eventLog.push(se);
    if (this.eventLog.length > EVENT_BUFFER_SIZE) {
      this.eventLog.splice(0, this.eventLog.length - EVENT_BUFFER_SIZE);
    }
    appendEventLog(this.key, se);
    for (const fn of this.listeners) fn(se);
  }

  /** Emit a claude `stream_event`-wrapped event (the incremental shape). */
  private emitStream(event: Record<string, unknown>): void {
    this.emit({ type: 'event', event: { type: 'stream_event', event } });
  }
}

/** The plan ruleset passed to session.create — same shape run.ts uses: deny
 *  questions and plan enter/exit so the chat path never blocks on prompts. */
const PLAN_RULESET: PermissionRuleset = [
  { permission: 'question', action: 'deny', pattern: '*' },
  { permission: 'plan_enter', action: 'deny', pattern: '*' },
  { permission: 'plan_exit', action: 'deny', pattern: '*' },
];

/** Best-effort extraction of a human message from a banana error object. */
function errorText(error: unknown): string {
  if (!error) return 'banana reported an error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const data = e.data as Record<string, unknown> | undefined;
    if (data && typeof data.message === 'string') return data.message;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.name === 'string') return String(e.name);
    try { return JSON.stringify(error); } catch { return 'banana reported an error'; }
  }
  return String(error);
}

function keyOf(cwd: string, chatId = 'main'): string {
  const normalized = chatId || 'main';
  return normalized === 'main' ? `banana|${cwd}` : `banana|${cwd}|${normalized}`;
}

/** Manager keyed by cwd + chat id, matching the claude/codex session maps. */
const bananaSessions = new Map<string, BananaSession>();

export function activeBananaSessions(): {
  cli: CliKind;
  cwd: string;
  chatId: string;
  busy: boolean;
  sessionId: string | null;
  lastActivityAt: number;
}[] {
  return Array.from(bananaSessions.values()).map((s) => ({
    cli: 'banana',
    cwd: s.cwd,
    chatId: s.chatId,
    busy: s.isBusy(),
    sessionId: s.sessionId(),
    lastActivityAt: s.lastActivityAt(),
  }));
}

export function pruneIdleBananaSessions(ttlMs: number, now = Date.now()): number {
  let pruned = 0;
  for (const [key, session] of bananaSessions) {
    if (session.isBusy()) continue;
    if (session.listenerCount() > 0) continue;
    if (now - session.lastActivityAt() < ttlMs) continue;
    session.shutdown();
    bananaSessions.delete(key);
    pruned += 1;
  }
  return pruned;
}

export async function getOrCreateBananaSession(opts: { repoPath: string; chatId?: string }): Promise<BananaSession> {
  const cwd = opts.repoPath;
  const chatId = opts.chatId || 'main';
  const key = keyOf(cwd, chatId);
  const existing = bananaSessions.get(key);
  if (existing && existing.isAlive()) return existing;

  // Banana/opencode session ids are not reliable across `banana serve` or
  // Node process restarts. The session can still be returned by session.get
  // but hang forever on session.prompt with no SSE events. Keep continuity
  // while the in-memory BananaSession is alive, but always start fresh after
  // a process restart / idle prune.
  if (await getSessionId('banana', cwd, chatId)) {
    await setSessionId('banana', cwd, '', chatId);
  }
  const session = new BananaSession(cwd, chatId, null);
  bananaSessions.set(key, session);
  return session;
}

export function shutdownAllBananaSessions(): void {
  for (const s of bananaSessions.values()) s.shutdown();
  bananaSessions.clear();
  // The persistent serve process is shared by every session — tear it down
  // once all sessions are gone.
  bananaServer.shutdown();
}

/** Kill the in-flight banana turn but keep the session id saved for resume. */
export function interruptBanana(opts: { repoPath: string; chatId?: string }): void {
  const cwd = opts.repoPath;
  const key = keyOf(cwd, opts.chatId || 'main');
  const s = bananaSessions.get(key);
  if (s) {
    s.shutdown();
    bananaSessions.delete(key);
  }
}

/** Drop the stored session id so the next banana turn starts a fresh session. */
export async function freshStartBanana(opts: { repoPath: string; chatId?: string }): Promise<BananaSession> {
  const cwd = opts.repoPath;
  const chatId = opts.chatId || 'main';
  const key = keyOf(cwd, chatId);
  const existing = bananaSessions.get(key);
  if (existing) {
    existing.shutdown();
    bananaSessions.delete(key);
  }
  await setSessionId('banana', cwd, '', chatId);
  const session = new BananaSession(cwd, chatId, null);
  bananaSessions.set(key, session);
  return session;
}
