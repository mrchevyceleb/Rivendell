// Dry reconstruction of the forever-thread payload.
// Usage (from server/):
//   npx tsx src/chat/threadWindow-dry.ts --synthetic 72
//   npx tsx src/chat/threadWindow-dry.ts [jsonl ...]
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  assembleForeverTurn,
  describeTurnAssembly,
  extractVisibleTurns,
  summarizeForeverPayload,
  syntheticVisibleEvents,
  WINDOW_TURNS,
  type Seqish,
} from './threadWindow.ts';

function parseJsonl(path: string): Array<{ seq?: number; ev: any }> {
  const events: Array<{ seq?: number; ev: any }> = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.ev) events.push(parsed);
      else events.push({ seq: parsed?.seq, ev: parsed });
    } catch {
      // skip malformed
    }
  }
  return events;
}

function defaultLogs(): string[] {
  const dir = join(homedir(), '.rivendell', 'event-logs');
  return [
    'xai__home_mrchevyceleb_ASSISTANT-HUB_bot-chief-of-staff.jsonl',
    'xai__home_mrchevyceleb_ASSISTANT-HUB_bot-becca.jsonl',
    'claude__home_mrchevyceleb_ASSISTANT-HUB_bot-chief-of-staff__acct__kim.jsonl',
  ].map((name) => join(dir, name));
}

function compactForLog(file: string): { compact: string; words: number; lastCompactedSeq: number; file: string } | null {
  const dir = join(homedir(), '.rivendell', 'thread-compacts');
  if (!existsSync(dir)) return null;
  const base = file.split(/[/\\]/).pop() ?? '';
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
        compact?: string;
        words?: number;
        chatId?: string;
        lastCompactedSeq?: number;
      };
      const compact = typeof raw.compact === 'string' ? raw.compact.trim() : '';
      if (!compact) continue;
      const chatId = typeof raw.chatId === 'string' ? raw.chatId : '';
      if (chatId && base.includes(chatId.replace(/[^a-zA-Z0-9._-]/g, '_'))) {
        return {
          compact,
          words: raw.words ?? 0,
          lastCompactedSeq: raw.lastCompactedSeq ?? 0,
          file: name,
        };
      }
    } catch {
      // skip
    }
  }
  return null;
}

function printAssembly(label: string, events: Seqish[], compact?: string | null, lastCompactedSeq?: number, logBytes?: number) {
  const assembled = assembleForeverTurn({ events, compact, lastCompactedSeq });
  const summary = summarizeForeverPayload({ events, compact, lastCompactedSeq });
  console.log('\n====', label, '====');
  console.log(describeTurnAssembly(assembled));
  console.log(JSON.stringify({
    logBytes: logBytes ?? null,
    logEvents: events.length,
    visibleTurns: summary.visibleTurns,
    compactCovers: summary.compactCovers,
    windowTurns: summary.windowTurns,
    overflowTurns: summary.overflowTurns,
    unmergedOverflowTurns: summary.unmergedOverflowTurns,
    compactIsTheLast50: summary.compactIsTheLast50,
    windowChars: summary.windowChars,
    overflowChars: summary.overflowChars,
    shouldCompact: summary.shouldCompact,
    primerChars: assembled.primer.length,
    primerHasCompact: summary.primerHasCompact,
    lastWindowPreview: assembled.window.slice(-4).map((t) => `${t.role}: ${t.text.slice(0, 90).replace(/\s+/g, ' ')}`),
    overflowPreview: assembled.overflow.slice(0, 3).map((t) => `${t.role}: ${t.text.slice(0, 70).replace(/\s+/g, ' ')}`),
  }, null, 2));
  const payload = `persona + compact(${summary.compactCovers} older) + last ${summary.windowTurns}/${WINDOW_TURNS}`;
  const notSent = logBytes != null ? `, not the ${logBytes}-byte jsonl` : ', not the engine jsonl / tool novels';
  console.log(`would send: ${payload}${notSent}`);
  return { assembled, summary };
}

const argv = process.argv.slice(2);
const synIdx = argv.indexOf('--synthetic');
if (synIdx !== -1) {
  const n = Number(argv[synIdx + 1] ?? 72);
  const events = syntheticVisibleEvents(n);
  const { assembled, summary } = printAssembly(`synthetic ${n} visible turns`, events);
  const expectOverflow = Math.max(0, n - WINDOW_TURNS);
  const expectWindow = Math.min(WINDOW_TURNS, n);
  const ok =
    assembled.visibleTurns === n &&
    assembled.compactCovers === expectOverflow &&
    assembled.windowTurns === expectWindow &&
    assembled.compactIsTheLast50 === false &&
    (expectOverflow === 0 || summary.primerHasCompact) &&
    extractVisibleTurns(events).length === n;
  if (!ok) {
    console.error(
      `FAIL: expected compact covers ${expectOverflow} + last ${expectWindow}, compact!==last50; got covers=${assembled.compactCovers} window=${assembled.windowTurns} compactIsTheLast50=${assembled.compactIsTheLast50}`,
    );
    process.exit(1);
  }
  console.log(
    `PASS: ${n} visible → compact covers ${assembled.compactCovers} older + last ${assembled.windowTurns} (compact !== last ${WINDOW_TURNS})`,
  );
  process.exit(0);
}

const files = (argv.length ? argv : defaultLogs()).filter((p) => existsSync(p));
if (files.length === 0) {
  console.error('no event logs found');
  process.exit(1);
}

for (const file of files) {
  const events = parseJsonl(file);
  const blob = compactForLog(file);
  const logBytes = readFileSync(file).byteLength;
  printAssembly(file.split(/[/\\]/).pop() ?? file, events, blob?.compact ?? '', blob?.lastCompactedSeq, logBytes);
}
