// User-defined agents — the team Matt curates. One agent = one persistent
// forever-thread + a scope document, running on any engine lane.
//
// Records live in ~/.rivendell/personas/agents.json; scopes in <id>.md
// beside them (same hot-reload mtime cache as always). Seeded with exactly
// ONE agent (Chief of Staff) on first boot — everything else is created by
// the user through the UI.

import { readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from './config.ts';
import { deleteRoutinesForAgent } from './routines.ts';
import { deleteMessagePinsForAgent } from '../lib/messagePinStore.ts';

const AGENTS_DIR = join(STATE_DIR, 'personas');
const AGENTS_FILE = join(AGENTS_DIR, 'agents.json');
const AVATARS_DIR = join(AGENTS_DIR, 'avatars');

const AVATAR_EXTS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export type Agent = {
  /** slug id — also the scope filename (<id>.md). */
  id: string;
  name: string;
  role: string;
  /** WORKSPACE_COMPANIONS lane id ('claude-kim', 'xai', …). */
  engine: string;
  /** home thread chatId (bot-<id>). */
  home: string;
  createdAt: number;
  /** Avatar version stamp (epoch ms) — also the cache-buster in avatar URLs. */
  avatar?: number;
  /** Live lane (session cli) this agent's home thread last ran on — updated
   *  on every user turn so the team bus routes to the thread the human (and
   *  teammates) actually see, even after a rebrain. */
  cli?: string;
  /** Manual sidebar position (drag-and-drop). Order is FIXED unless the user
   *  moves a row — never activity-sorted. */
  order?: number;
  /** xAI realtime voice id for calls ('ara', 'rex', …). */
  voice?: string;
  /** Pinned to the top bubble strip (user choice, not activity). */
  pinned?: boolean;
};

const DEFAULT_SCOPE = `# Chief of Staff

You are the Chief of Staff of Rivendell — Matt's always-on AI teammate.

## Who you are
- The coordinator. You think in plans, owners, and next actions. You keep the whole house's work coherent.
- Calm, thorough, honest about risks. You flag what's blocked before it's late.

## What you do
- Break work into owned steps and route them to the right teammate as the team grows.
- Track open threads; when asked "where are we?", answer per workstream with state + owner + next action.
- Write things worth keeping: briefs, decisions, replies to people outside the house.

## Style
- Structured markdown, short sections, explicit owners and dates. End with the single next action.
- House rules: never invent data; say what's missing instead.
`;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent';
}

export function listAgents(): Agent[] {
  try {
    const data = JSON.parse(readFileSync(AGENTS_FILE, 'utf8')) as { agents?: Agent[] };
    const agents = Array.isArray(data.agents) ? data.agents : [];
    // Fixed manual order first; unordered legacy/new agents append by age.
    return agents.sort((a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
      || a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

function saveAgents(agents: Agent[]): void {
  mkdirSync(AGENTS_DIR, { recursive: true });
  writeFileSync(AGENTS_FILE, JSON.stringify({ agents }, null, 2));
}

/** Seed exactly one agent (Chief of Staff) when the store is empty. */
export function ensureAgents(): void {
  try {
    mkdirSync(AGENTS_DIR, { recursive: true });
    let agents = listAgents();
    if (agents.length === 0) {
      const id = 'chief-of-staff';
      const scopePath = join(AGENTS_DIR, `${id}.md`);
      try { statSync(scopePath); } catch { writeFileSync(scopePath, DEFAULT_SCOPE); }
      agents = [{
        id,
        name: 'Chief of Staff',
        role: 'Coordination, plans, delegation',
        engine: 'claude-kim',
        home: `bot-${id}`,
        createdAt: Date.now(),
      }];
      saveAgents(agents);
      console.log('[agents] seeded Chief of Staff');
    }
  } catch (err) {
    console.warn('[agents] seed failed:', (err as Error).message);
  }
}

export type AgentInput = { name: string; role?: string; engine?: string; voice?: string; pinned?: boolean; scope?: string };

export function createAgent(input: AgentInput): Agent {
  const agents = listAgents();
  const base = slugify(input.name);
  let id = base;
  let n = 2;
  while (agents.some((a) => a.id === id) || id === 'chief-of-staff' && false) id = `${base}-${n++}`;
  const agent: Agent = {
    id,
    name: input.name.trim().slice(0, 60),
    role: (input.role ?? '').trim().slice(0, 120) || 'Teammate',
    engine: input.engine ?? 'xai',
    voice: input.voice ?? 'ara',
    home: `bot-${id}`,
    createdAt: Date.now(),
    order: Math.max(0, ...agents.map((a) => a.order ?? 0)) + 1,
  };
  if (input.scope && input.scope.trim()) {
    writeFileSync(join(AGENTS_DIR, `${id}.md`), input.scope);
  }
  agents.push(agent);
  saveAgents(agents);
  return agent;
}

export function updateAgent(id: string, patch: Partial<AgentInput>): Agent | null {
  const agents = listAgents();
  const idx = agents.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  const cur = agents[idx];
  const next: Agent = {
    ...cur,
    name: patch.name !== undefined ? (patch.name.trim().slice(0, 60) || cur.name) : cur.name,
    role: patch.role !== undefined ? (patch.role.trim().slice(0, 120) || cur.role) : cur.role,
    engine: patch.engine !== undefined ? (patch.engine || cur.engine) : cur.engine,
    voice: patch.voice !== undefined ? (patch.voice || cur.voice) : cur.voice,
    pinned: patch.pinned !== undefined ? patch.pinned : cur.pinned,
  };
  // A deliberate engine change invalidates the live lane stamp — the next
  // user turn re-stamps it. Otherwise team delivery keeps routing to the
  // old lane's log after a rebrain.
  if (next.engine !== cur.engine) delete next.cli;
  agents[idx] = next;
  saveAgents(agents);
  if (patch.scope !== undefined && patch.scope.trim()) {
    writeFileSync(join(AGENTS_DIR, `${id}.md`), patch.scope);
  }
  return next;
}

export function deleteAgent(id: string): boolean {
  const agents = listAgents();
  const next = agents.filter((a) => a.id !== id);
  if (next.length === agents.length) return false;
  saveAgents(next);
  deleteRoutinesForAgent(id);
  try { deleteMessagePinsForAgent(id); } catch { /* pin pocket is ancillary to the agent record */ }
  clearAvatarFiles(id);
  try { unlinkSync(join(AGENTS_DIR, `${id}.md`)); } catch { /* scope file optional */ }
  return true;
}

function clearAvatarFiles(id: string): void {
  try {
    for (const f of readdirSync(AVATARS_DIR)) {
      if (f.startsWith(`${id}.`)) unlinkSync(join(AVATARS_DIR, f));
    }
  } catch { /* no avatars dir yet */ }
}

/** Persist an uploaded avatar for an agent; bumps the version stamp. */
export function setAgentAvatar(id: string, mime: string, bytes: Buffer): Agent | null {
  const ext = AVATAR_EXTS[mime];
  if (!ext) throw new Error(`unsupported avatar type: ${mime}`);
  if (!bytes?.length) throw new Error('empty avatar payload');
  const agents = listAgents();
  const idx = agents.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  mkdirSync(AVATARS_DIR, { recursive: true });
  clearAvatarFiles(id); // drop any stale-format previous upload
  writeFileSync(join(AVATARS_DIR, `${id}.${ext}`), bytes);
  const next: Agent = { ...agents[idx], avatar: Date.now() };
  agents[idx] = next;
  saveAgents(agents);
  return next;
}

/** Remove an agent's avatar (back to the initial disc). */
export function clearAgentAvatar(id: string): Agent | null {
  const agents = listAgents();
  const idx = agents.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  clearAvatarFiles(id);
  if (agents[idx].avatar === undefined) return agents[idx];
  const next: Agent = { ...agents[idx] };
  delete next.avatar;
  agents[idx] = next;
  saveAgents(agents);
  return next;
}

/** Absolute path of an agent's stored avatar file, if any. */
export function agentAvatarPath(id: string): string | null {
  try {
    for (const f of readdirSync(AVATARS_DIR)) {
      if (f === `${id}.png` || f === `${id}.jpg` || f === `${id}.webp` || f === `${id}.gif`) {
        return join(AVATARS_DIR, f);
      }
    }
  } catch { /* dir absent */ }
  return null;
}

/** Persist a manual sidebar order (ids in drop sequence). */
export function reorderAgents(ids: string[]): Agent[] {
  const agents = listAgents();
  const rank = new Map(ids.map((id, i) => [id, i]));
  const next = agents.map((a) => ({ ...a, order: rank.has(a.id) ? rank.get(a.id)! : (a.order ?? Number.MAX_SAFE_INTEGER) }));
  next.sort((a, b) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
    || a.createdAt - b.createdAt);
  next.forEach((a, i) => { a.order = i; });
  saveAgents(next);
  return next;
}

export function agentForChatId(chatId: string): Agent | undefined {
  const bare = chatId.replace(/__acct__[a-z0-9-]+$/i, '');
  return listAgents().find((a) => a.home === bare);
}

const laneStamps = new Map<string, string>();

/** Record which session cli a home thread last took a USER turn on. Called by
 *  every runner so rebrains (lane changes from the composer) re-route team
 *  deliveries to the live thread. Throttled write: at most one save/min/agent. */
const laneLastWrite = new Map<string, number>();
export function noteAgentLane(chatId: string, cli: string): void {
  const bare = chatId.replace(/__acct__[a-z0-9-]+$/i, '');
  if (laneStamps.get(bare) === cli) return;
  const now = Date.now();
  // Do not stamp an unsaved change as complete. The old code updated
  // laneStamps before this throttle and then returned forever on later turns,
  // leaving agents.json permanently pointed at the previous brain.
  if (now - (laneLastWrite.get(bare) ?? 0) < 60_000) return;
  try {
    const agents = listAgents();
    const idx = agents.findIndex((a) => a.home === bare);
    if (idx < 0) return;
    if (agents[idx].cli !== cli) {
      agents[idx] = { ...agents[idx], cli };
      saveAgents(agents);
    }
    laneStamps.set(bare, cli);
    laneLastWrite.set(bare, now);
  } catch { /* best-effort stamp; leave unstamped so a later turn retries */ }
}
