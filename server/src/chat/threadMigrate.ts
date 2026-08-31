// One-shot merge of per-engine agent logs into a single thread-keyed log.
//
// Before threadKey.ts, each brain wrote `claude|cwd|bot-max`, `xai|cwd|bot-max`,
// etc. Switching models forked the conversation. Runners now append to
// `thread|cwd|bot-max`. This migrates leftover forks AND their rolling compact
// so a model switch keeps both the transcript and the forever-thread memory.
//
// Almost none of the CLI events carry a wall clock (uuids here are v4). We
// MUST NOT invent Date.now() (v1 interleaved long files) and we MUST NOT
// concatenate untimed multi-engine files by mtime (that turns A→B→A into
// all-A then all-B). Untimed multi-source groups stay unmigrated. A single
// source, or a group where every event has a real timestamp, can merge.
// Within a file every distinct record is kept; dest overlay matches uuid or
// the exact persisted event, never seq alone.
// Idempotent via a versioned marker; a failed group leaves the marker unwritten.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSISTANT_HUB_PATH, STATE_DIR } from './config.ts';
import { EVENT_LOG_DIR, isPlumbingEvent, sanitizeKey } from './event-log-store.ts';
import { listAgents } from './agents.ts';
import { isAgentThread, threadLogKey } from './threadKey.ts';
import { adoptCompaction } from './compaction.ts';

const MARKER = join(STATE_DIR, 'thread-migrate-v5.json');
const ENGINE_PREFIX = /^(claude-personal|claude|codex-personal|codex|assistant|banana(?:-local|-fireworks)?|zai|xai|thread)_/;
const SOURCE_KEY = /^(claude-personal|claude|codex-personal|codex|assistant|banana(?:-local|-fireworks)?|zai|xai|thread)\|(.+)\|(bot-[^|]+)$/;

type Line = {
  seq: number;
  ev: unknown;
  eng?: string;
  mdl?: string;
  src: string;
};

function inferEngine(filename: string): string | undefined {
  const m = ENGINE_PREFIX.exec(filename);
  if (!m) return undefined;
  return m[1] === 'thread' ? undefined : m[1];
}

function bareHomeFromStem(stem: string): string | null {
  const m = /_(bot-[a-z0-9][a-z0-9-]*)(?:__acct__[a-z0-9-]+)?$/i.exec(stem);
  return m ? m[1] : null;
}

function chatIdFromStem(stem: string): string | null {
  const m = /_(bot-[a-z0-9][a-z0-9-]*(?:__acct__[a-z0-9-]+)?)$/i.exec(stem);
  return m ? m[1] : null;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse the lossy filename back into engine, sanitized cwd, and ids. */
function parseAgentLogName(file: string): { cli: string; cwdSanitized: string; home: string; chatId: string } | null {
  if (!file.endsWith('.jsonl') || file.endsWith('.archive.jsonl')) return null;
  const stem = file.slice(0, -'.jsonl'.length);
  const eng = ENGINE_PREFIX.exec(stem);
  if (!eng) return null;
  const home = bareHomeFromStem(stem);
  const chatId = chatIdFromStem(stem);
  if (!home || !chatId) return null;
  const rest = stem.slice(eng[0].length);
  const suffix = new RegExp(`_${escapeRe(home)}(?:__acct__[a-z0-9-]+)?$`, 'i');
  const cwdSanitized = rest.replace(suffix, '');
  if (!cwdSanitized || cwdSanitized === rest) return null;
  return { cli: eng[1], cwdSanitized, home, chatId };
}

function resolveCwd(cwdSanitized: string): string | null {
  if (sanitizeKey(ASSISTANT_HUB_PATH) === cwdSanitized) return ASSISTANT_HUB_PATH;
  return null;
}

function destFileName(cwdSanitized: string, home: string): string {
  const cwd = resolveCwd(cwdSanitized);
  if (cwd) return `${sanitizeKey(threadLogKey(cwd, home))}.jsonl`;
  // cwdSanitized is sanitizeKey(cwd). thread|cwd|home sanitizes to
  // `thread_` + cwdSanitized + `_` + home — the extra `_` is the `|`.
  return `thread_${cwdSanitized}_${home}.jsonl`;
}

function sourceLogKey(file: string): string | null {
  const parsed = parseAgentLogName(file);
  if (!parsed) return null;
  const cwd = resolveCwd(parsed.cwdSanitized);
  if (!cwd) return null;
  if (parsed.cli === 'thread') return threadLogKey(cwd, parsed.home);
  return `${parsed.cli}|${cwd}|${parsed.chatId}`;
}

function unwrapEvent(ev: unknown): Record<string, unknown> | null {
  if (!ev || typeof ev !== 'object') return null;
  const rec = ev as { type?: unknown; event?: unknown };
  if (rec.type === 'event' && rec.event && typeof rec.event === 'object') {
    return rec.event as Record<string, unknown>;
  }
  return rec as Record<string, unknown>;
}

function eventTime(ev: unknown): number | null {
  const inner = unwrapEvent(ev);
  if (!inner) return null;
  const raw = inner.ts ?? inner.timestamp;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function eventUuid(ev: unknown): string | null {
  const inner = unwrapEvent(ev);
  const uuid = inner?.uuid;
  return typeof uuid === 'string' && uuid ? uuid : null;
}

type ReadResult = { ok: true; lines: Line[] } | { ok: false; error: string };

function readLines(path: string, filename: string): ReadResult {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const engFromName = inferEngine(filename);
  const out: Line[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { seq?: unknown; ev?: unknown; eng?: unknown; mdl?: unknown };
      if (typeof parsed.seq !== 'number' || !parsed.ev) continue;
      if (isPlumbingEvent(parsed.ev)) continue;
      const eng = typeof parsed.eng === 'string' && parsed.eng ? parsed.eng : engFromName;
      const row: Line = { seq: parsed.seq, ev: parsed.ev, src: filename };
      if (eng) row.eng = eng;
      if (typeof parsed.mdl === 'string' && parsed.mdl) row.mdl = parsed.mdl;
      out.push(row);
    } catch {
      return { ok: false, error: `malformed JSONL in ${filename}` };
    }
  }
  return { ok: true, lines: out };
}

function collectCompactionSources(files: string[]): Map<string, string[]> {
  const byDest = new Map<string, Set<string>>();
  const add = (from: string, dest: string) => {
    if (!from || from === dest) return;
    const set = byDest.get(dest) ?? new Set<string>();
    set.add(from);
    byDest.set(dest, set);
  };

  try {
    const state = JSON.parse(readFileSync(join(STATE_DIR, 'compaction-state.json'), 'utf8')) as Record<string, unknown>;
    for (const key of Object.keys(state)) {
      const m = SOURCE_KEY.exec(key);
      if (!m || !isAgentThread(m[3])) continue;
      add(key, threadLogKey(m[2], m[3]));
    }
  } catch {
    // no state file yet
  }

  for (const file of files) {
    const key = sourceLogKey(file);
    if (!key) continue;
    const m = SOURCE_KEY.exec(key);
    if (!m || !isAgentThread(m[3])) continue;
    add(key, threadLogKey(m[2], m[3]));
  }

  return new Map([...byDest].map(([dest, set]) => [dest, [...set]]));
}

export function migrateAgentThreadLogs(): { migrated: number; skipped: boolean } {
  if (existsSync(MARKER)) {
    return { migrated: 0, skipped: true };
  }

  const homes = new Set(listAgents().map((a) => a.home));
  if (homes.size === 0) {
    writeFileSync(MARKER, JSON.stringify({ at: Date.now(), migrated: 0, note: 'no agents' }));
    return { migrated: 0, skipped: false };
  }

  let files: string[] = [];
  try {
    files = readdirSync(EVENT_LOG_DIR);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
    files = [];
  }

  const compactReport: Array<{ dest: string; from: string[]; blob: boolean; state: boolean }> = [];
  for (const [dest, fromKeys] of collectCompactionSources(files)) {
    const home = dest.split('|').pop() ?? '';
    if (home && !homes.has(home)) continue;
    const adopted = adoptCompaction(fromKeys, dest);
    if (adopted.blob || adopted.state) compactReport.push({ dest, from: fromKeys, ...adopted });
  }

  type Group = { cwdSanitized: string; home: string; srcFiles: string[] };
  const byGroup = new Map<string, Group>();
  for (const file of files) {
    const parsed = parseAgentLogName(file);
    if (!parsed || !homes.has(parsed.home)) continue;
    const key = `${parsed.cwdSanitized}\0${parsed.home}`;
    const group = byGroup.get(key) ?? { cwdSanitized: parsed.cwdSanitized, home: parsed.home, srcFiles: [] };
    group.srcFiles.push(file);
    byGroup.set(key, group);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const archiveDir = join(STATE_DIR, 'archive', `thread-migrate-${stamp}`);
  mkdirSync(archiveDir, { recursive: true });

  const report: Array<{ home: string; cwd: string; sources: string[]; events: number; archived: boolean; skipped?: string }> = [];
  let failed = false;

  for (const group of byGroup.values()) {
    const { cwdSanitized, home, srcFiles } = group;
    const threadName = destFileName(cwdSanitized, home);
    const destPath = join(EVENT_LOG_DIR, threadName);
    const perEngine = srcFiles.filter((file) => file !== threadName);
    if (perEngine.length === 0) continue;
    // v2 already wrote a thread file. Do not rewrite live history.
    if (existsSync(destPath)) continue;

    const ranked = perEngine
      .map((file) => {
        let mtime = 0;
        try { mtime = statSync(join(EVENT_LOG_DIR, file)).mtimeMs; } catch { /* keep 0 */ }
        return { file, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file));

    const merged: Line[] = [];
    let groupFailed = false;
    for (const { file } of ranked) {
      const read = readLines(join(EVENT_LOG_DIR, file), file);
      if (!read.ok) {
        console.warn(`[thread-migrate] ${home}: aborting group, could not read ${file}: ${read.error}`);
        groupFailed = true;
        break;
      }
      merged.push(...read.lines);
    }
    if (groupFailed) {
      failed = true;
      continue;
    }

    const timed = merged.map((row) => eventTime(row.ev));
    const allTimed = timed.length > 0 && timed.every((t) => t != null);
    if (perEngine.length > 1 && !allTimed) {
      console.warn(`[thread-migrate] ${home} (${cwdSanitized}): leaving ${perEngine.length} source(s) unmigrated; no wall-clock to order A→B→A`);
      report.push({
        home,
        cwd: resolveCwd(cwdSanitized) ?? cwdSanitized,
        sources: ranked.map((r) => r.file),
        events: 0,
        archived: false,
        skipped: 'ambiguous-chronology',
      });
      continue;
    }

    const ordered = allTimed
      ? merged
        .map((row, i) => ({ row, t: timed[i] as number }))
        .sort((a, b) => a.t - b.t || a.row.src.localeCompare(b.row.src) || a.row.seq - b.row.seq)
        .map((x) => x.row)
      : merged;

    const seenUuid = new Set<string>();
    const unique: Line[] = [];
    for (const row of ordered) {
      const uuid = eventUuid(row.ev);
      if (uuid && seenUuid.has(uuid)) continue;
      if (uuid) seenUuid.add(uuid);
      unique.push(row);
    }

    const lines = unique.map((row, i) => {
      const rec: { seq: number; ev: unknown; eng?: string; mdl?: string } = {
        seq: i + 1,
        ev: row.ev,
      };
      if (row.eng) rec.eng = row.eng;
      if (row.mdl) rec.mdl = row.mdl;
      return JSON.stringify(rec);
    });

    const tmp = `${destPath}.migrate-${process.pid}`;
    writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '', 'utf8');
    renameSync(tmp, destPath);

    const archived = allTimed || perEngine.length === 1;
    if (archived) {
      for (const file of perEngine) {
        try {
          renameSync(join(EVENT_LOG_DIR, file), join(archiveDir, file));
        } catch (err) {
          console.warn(`[thread-migrate] could not archive ${file}:`, (err as Error).message);
        }
      }
    }

    report.push({
      home,
      cwd: resolveCwd(cwdSanitized) ?? cwdSanitized,
      sources: ranked.map((r) => r.file),
      events: lines.length,
      archived,
    });
    console.log(`[thread-migrate] ${home}: ${perEngine.length} source(s) → ${lines.length} event(s)`);
  }

  if (failed) {
    console.warn('[thread-migrate] one or more groups failed; marker not written, will retry on next boot');
    return { migrated: report.filter((r) => !r.skipped).length, skipped: false };
  }

  writeFileSync(MARKER, JSON.stringify({ at: Date.now(), archive: archiveDir, report, compact: compactReport }, null, 2));
  return { migrated: report.filter((r) => !r.skipped).length, skipped: false };
}
