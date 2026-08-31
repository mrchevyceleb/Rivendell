// One-shot merge of per-engine agent logs into a single thread-keyed log.
//
// Before threadKey.ts, each brain wrote `claude|cwd|bot-max`, `xai|cwd|bot-max`,
// etc. Switching models forked the conversation. Runners now append to
// `thread|cwd|bot-max`. This migrates the leftover forks so the visible thread
// is continuous and a model switch has something to seed from.
//
// Almost none of the CLI events carry a timestamp, so we MUST NOT invent one
// with Date.now() (v1 did; long files interleaved). Order is: oldest source
// file first, original seq within each file. Idempotent via a versioned marker.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from './config.ts';
import { EVENT_LOG_DIR, isPlumbingEvent, sanitizeKey } from './event-log-store.ts';
import { listAgents } from './agents.ts';
import { threadLogKey } from './threadKey.ts';

const MARKER = join(STATE_DIR, 'thread-migrate-v2.json');
const ELROND_WORKSPACE = process.env.ELROND_WORKSPACE_PATH || '/home/mrchevyceleb/ASSISTANT-HUB';

const ENGINE_PREFIX = /^(claude|codex|assistant|banana(?:-local|-fireworks)?|zai|xai|thread)_/;

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

function readLines(path: string, filename: string): Line[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
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
      // skip malformed
    }
  }
  return out;
}

function fingerprint(ev: unknown): string {
  try {
    return JSON.stringify(ev);
  } catch {
    return '';
  }
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
  } catch {
    writeFileSync(MARKER, JSON.stringify({ at: Date.now(), migrated: 0, note: 'no event-logs dir' }));
    return { migrated: 0, skipped: false };
  }

  const byHome = new Map<string, string[]>();
  for (const file of files) {
    if (!file.endsWith('.jsonl') || file.endsWith('.archive.jsonl')) continue;
    const stem = file.slice(0, -'.jsonl'.length);
    const home = bareHomeFromStem(stem);
    if (!home || !homes.has(home)) continue;
    const list = byHome.get(home) ?? [];
    list.push(file);
    byHome.set(home, list);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const archiveDir = join(STATE_DIR, 'archive', `thread-migrate-${stamp}`);
  mkdirSync(archiveDir, { recursive: true });

  const report: Array<{ home: string; sources: string[]; events: number }> = [];

  for (const [home, srcFiles] of byHome) {
    const threadKey = threadLogKey(ELROND_WORKSPACE, home);
    const threadName = `${sanitizeKey(threadKey)}.jsonl`;
    const ranked = srcFiles
      .map((file) => {
        let mtime = 0;
        try { mtime = statSync(join(EVENT_LOG_DIR, file)).mtimeMs; } catch { /* keep 0 */ }
        return { file, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file));

    const merged: Line[] = [];
    for (const { file } of ranked) {
      merged.push(...readLines(join(EVENT_LOG_DIR, file), file));
    }

    const deduped: Line[] = [];
    const seen = new Set<string>();
    for (const row of merged) {
      const fp = fingerprint(row.ev);
      if (fp && seen.has(fp)) continue;
      if (fp) seen.add(fp);
      deduped.push(row);
    }

    const lines = deduped.map((row, i) => {
      const rec: { seq: number; ev: unknown; eng?: string; mdl?: string } = {
        seq: i + 1,
        ev: row.ev,
      };
      if (row.eng) rec.eng = row.eng;
      if (row.mdl) rec.mdl = row.mdl;
      return JSON.stringify(rec);
    });

    const dest = join(EVENT_LOG_DIR, threadName);
    const tmp = `${dest}.migrate-${process.pid}`;
    writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '', 'utf8');
    renameSync(tmp, dest);

    for (const file of srcFiles) {
      if (file === threadName) continue;
      try {
        renameSync(join(EVENT_LOG_DIR, file), join(archiveDir, file));
      } catch (err) {
        console.warn(`[thread-migrate] could not archive ${file}:`, (err as Error).message);
      }
    }
    report.push({ home, sources: ranked.map((r) => r.file), events: lines.length });
    console.log(`[thread-migrate] ${home}: ${srcFiles.length} source(s) → ${lines.length} event(s)`);
  }

  writeFileSync(MARKER, JSON.stringify({ at: Date.now(), archive: archiveDir, report }, null, 2));
  return { migrated: report.length, skipped: false };
}
