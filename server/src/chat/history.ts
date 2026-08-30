// Read-only chat history index backing the Grok-style sidebar conversation
// list. Scans the durable event-log directory (~/.rivendell/event-logs), maps
// each log back to (cli, repo, chatId) via the same sanitizeKey transform the
// runners use, and pulls a display title from the first user-authored message.
// Results are cached by (file, mtime) so repeat fetches only re-read logs that
// changed. No writes, no side effects.

import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { EVENT_LOG_DIR } from './event-log-store.ts';
import { discoverRepos } from './repos.ts';

export type ChatHistoryItem = {
  chatId: string;
  cli: string;
  repo: string;
  title: string;
  /** Last thing said (either side) — the rail's one-line preview. */
  preview?: string;
  updatedAt: number;
};

const CLI_KINDS = ['claude', 'codex', 'assistant', 'banana', 'banana-local', 'banana-fireworks', 'zai', 'xai'];
// Automation/spam logs that would drown the sidebar (bridge probes, browser
// sessions, account bootstraps). Real conversations (studio-*, grok-*, main)
// never start with these prefixes.
const NOISE = /^(bridge|browser|acct|test|probe|smoke)[-_]/i;
const MAX_ITEMS = 200;

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

// Pull the first user-typed text out of an event-log prefix. Tolerant of the
// three runner shapes (claude stream-json user events, banana/codex echoes).
function extractTitle(raw: string): string | null {
  const lines = raw.split('\n');
  const cap = Math.min(lines.length, 400);
  for (let i = 0; i < cap; i++) {
    const line = lines[i];
    if (!line || (!line.includes('"user"') && !line.includes('_user_echo'))) continue;
    try {
      const parsed = JSON.parse(line);
      const ev = parsed?.ev ?? parsed;
      // codex/banana: { type:'event', event:{ type:'_user_echo', text } }
      if (ev?.event?.type === '_user_echo' && typeof ev.event.text === 'string' && ev.event.text.trim()) {
        const clean = ev.event.text.replace(/\s+/g, ' ').trim().replace(/^[#*>`\-\s]+/, '').replace(/^\/(?=[a-z])/i, '').trim();
        if (clean) {
          const sliced = clean.length <= 90 ? clean : `${clean.slice(0, 90).replace(/\s+\S*$/, '')}…`;
          return sliced;
        }
      }
      // claude: { type:'event', event:{ type:'user', message:{ role:'user', content:[{type:'text',text}] | string } } }
      const msg = ev?.event?.message ?? ev?.message;
      const role = ev?.event?.type === 'user' || ev?.type === 'user' ? 'user' : msg?.role;
      if (role !== 'user') continue;
      const content = msg?.content ?? ev?.text ?? ev?.event?.text;
      let text: string | null = null;
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) {
        const t = content.find((c: any) => c?.type === 'text' && typeof c.text === 'string');
        if (t) text = t.text;
      }
      if (text) {
        const clean = text.replace(/\s+/g, ' ').trim().replace(/^[#*>`\-\s]+/, '').replace(/^\/(?=[a-z])/i, '').trim();
        if (clean) {
          // Slice at a word boundary so the sidebar never truncates mid-clause.
          const sliced = clean.length <= 90 ? clean : `${clean.slice(0, 90).replace(/\s+\S*$/, '')}…`;
          return sliced;
        }
      }
    } catch {
      // malformed line — keep scanning
    }
  }
  return null;
}

// Pull the LAST user-or-assistant text out of a log tail — the conversation
// preview line. Same tolerant shapes as extractTitle.
function extractPreview(rawTail: string): string | undefined {
  const lines = rawTail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"text"')) continue;
    try {
      const parsed = JSON.parse(line);
      const ev = parsed?.ev ?? parsed;
      const msg = ev?.event?.message ?? ev?.message;
      const content = msg?.content ?? ev?.text ?? ev?.event?.text;
      let text: string | null = null;
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) {
        const t = [...content].reverse().find((c: any) => c?.type === 'text' && typeof c.text === 'string');
        if (t) text = t.text;
      }
      if (text) {
        const clean = text.replace(/\s+/g, ' ').trim();
        if (clean) return clean.length <= 110 ? clean : `${clean.slice(0, 110).replace(/\s+\S*$/, '')}…`;
      }
    } catch { /* keep scanning */ }
  }
  return undefined;
}
const cache = new Map<string, { mtimeMs: number; item: ChatHistoryItem }>();

export async function listChatHistory(): Promise<ChatHistoryItem[]> {
  let files: string[] = [];
  try {
    files = await readdir(EVENT_LOG_DIR);
  } catch {
    return [];
  }

  // Build sanitized prefixes for every known (cli, cwd) pair so a filename can
  // be mapped back to its chatId by prefix-strip.
  const prefixes: Array<{ prefix: string; cli: string; cwd: string }> = [];
  try {
    const repos = await discoverRepos();
    for (const repo of repos) {
      for (const cli of CLI_KINDS) {
        prefixes.push({ prefix: `${sanitizeKey(`${cli}|${repo.path}|`)}`, cli, cwd: repo.path });
      }
    }
  } catch {
    // repo discovery failed — history is best-effort
  }
  prefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  // `main` sessions have NO chatId segment (key = cli|cwd) — their sanitized
  // stem is the chatId-prefix WITHOUT the trailing separator.
  const mainKeys = new Map<string, { cli: string; cwd: string }>();
  for (const p of prefixes) {
    const base = p.prefix.replace(/_$/, '');
    if (!mainKeys.has(base)) mainKeys.set(base, { cli: p.cli, cwd: p.cwd });
  }

  // Stat first, cap the candidate set, THEN pay for content reads — and keep
  // every read async so a big log dir never stalls the chat/WebSocket loop.
  type Candidate = { file: string; chatId: string; cli: string; cwd: string; path: string; mtimeMs: number; size: number };
  const candidates: Candidate[] = [];
  await Promise.all(files.map(async (file) => {
    if (!file.endsWith('.jsonl')) return;
    const stem = file.slice(0, -'.jsonl'.length);
    let hit = prefixes.find((p) => stem.startsWith(p.prefix));
    if (!hit) {
      // main-session form: stem is exactly the cli|cwd key (no chatId part)
      const mainHit = mainKeys.get(stem);
      if (mainHit) {
        try {
          const st = await stat(join(EVENT_LOG_DIR, file));
          candidates.push({ file, chatId: 'main', cli: mainHit.cli, cwd: mainHit.cwd, path: join(EVENT_LOG_DIR, file), mtimeMs: st.mtimeMs, size: st.size });
        } catch { /* skip */ }
      }
      return;
    }
    const chatId = stem.slice(hit.prefix.length);
    if (!chatId || NOISE.test(chatId)) return;
    try {
      const st = await stat(join(EVENT_LOG_DIR, file));
      candidates.push({ file, chatId, cli: hit.cli, cwd: hit.cwd, path: join(EVENT_LOG_DIR, file), mtimeMs: st.mtimeMs, size: st.size });
    } catch { /* vanished between readdir/stat — skip */ }
  }));
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates.length > MAX_ITEMS) candidates.length = MAX_ITEMS;

  const out: ChatHistoryItem[] = [];
  for (const c of candidates) {
    const cached = cache.get(c.file);
    if (cached && cached.mtimeMs === c.mtimeMs) {
      // Untitled entries never outlive the 30-minute grace window, cache or not.
      if (cached.item.title === 'New conversation' && Date.now() - c.mtimeMs > 30 * 60 * 1000) continue;
      out.push(cached.item);
      continue;
    }

    // Read a prefix for the title and a tail for the preview — a long log's
    // first user message lands early, its last message lands late.
    let title: string | null = null;
    let preview: string | undefined;
    try {
      const fh = await open(c.path, 'r');
      try {
        const headSize = Math.min(c.size, 192 * 1024);
        const head = Buffer.alloc(headSize);
        await fh.read(head, 0, headSize, 0);
        title = extractTitle(head.toString('utf8'));
        const tailSize = Math.min(c.size, 48 * 1024);
        const tail = Buffer.alloc(tailSize);
        await fh.read(tail, 0, tailSize, Math.max(0, c.size - tailSize));
        preview = extractPreview(tail.toString('utf8'));
      } finally {
        await fh.close();
      }
    } catch {
      title = null;
    }

    // Automation runs often leave logs with no user-authored message at all.
    // Keep untitled logs visible for 30 minutes (a live composer session
    // reads as 'New chat'), then drop them so the sidebar stays a real
    // conversation list instead of an automation log dir.
    if (!title && Date.now() - c.mtimeMs > 30 * 60 * 1000) continue;

    const item: ChatHistoryItem = {
      chatId: c.chatId,
      cli: c.cli,
      repo: c.cwd,
      title: title ?? 'New conversation',
      preview,
      updatedAt: Math.round(c.mtimeMs),
    };
    // Only titled conversations are cacheable — an untitled log's title can
    // still arrive, and its grace-window expiry must re-evaluate each fetch.
    if (title) cache.set(c.file, { mtimeMs: c.mtimeMs, item });
    out.push(item);
  }

  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}
