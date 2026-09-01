// Forever-thread model window. Every send is:
//   1. persona / FACE / rules (tiny — injected by the runner, not this module)
//   2. compact = summary of everything OLDER THAN the last 50 visible turns
//      (one overwriteable blob; NOT the last 50)
//   3. last 50 visible user+assistant turns (the working window)
//
// So: persona + compact(history − last50) + last50.
// Compact must never be stored or described as the last 50.
//
// Do not send the week-long Rivendell jsonl, Claude session jsonl, or
// tool-result novels as the turn payload. A live engine process may stay up
// (--resume is fine for process continuity) as long as the *logical* payload
// is compact+50. Replaying a 920KB tool dump via --resume is still wrong —
// skip that resume on spawn and seed compact+50 instead. Do not kill a
// live session just because jsonl exceeded 350KB.
//
// Overflow compact: when visible turns go past 50, fold the oldest extras
// into the compact blob (replace the file) and keep last 50 as the tail.
//
// The Rivendell event log is UI-only and is never trimmed here.

import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  isAutomationPeerEvent,
  isExactNoUpdate,
  isQuietRoutineReply,
  isRoutinePromptText,
} from './routineNoise.ts';

export const WINDOW_TURNS = 50;
/** Clip a single visible turn so one essay cannot blow the window. */
export const MAX_TURN_CHARS = 3000;
/** Grok overwrite needs at least one aged-out turn. Raw overflow is already
 *  in the compact slot; this is only the generate-and-replace threshold. */
export const MIN_OVERFLOW_TURNS = 3;
/** Even terse overflow eventually folds (don't wait forever on "ok"s). */
export const HARD_OVERFLOW_TURNS = 40;
/** Don't bother Grok with a handful of short lines. Unmerged overflow still
 *  sits in the compact slot so history − last50 is never dropped. */
export const MIN_OVERFLOW_CHARS = 2000;
/** Skip --resume of a jsonl that is already a tool-novel dump. Spawn-time only. */
export const JSONL_RESUME_SKIP_BYTES = 64 * 1024;
/** Raw unmerged overflow in the compact slot is bounded so a restart cannot
 *  stuff a multi-megabyte primer. Oldest-first, matching Grok's compact batch. */
export const MAX_UNMERGED_OVERFLOW_CHARS = 240 * 1024;

export type VisibleTurn = {
  role: 'user' | 'assistant';
  text: string;
  seq: number;
};

export type WindowSplit = {
  window: VisibleTurn[];
  overflow: VisibleTurn[];
};

export type Seqish = { seq?: number; ev?: any };

function clipTurn(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_TURN_CHARS) return t;
  const keep = Math.max(200, Math.floor((MAX_TURN_CHARS - 48) / 2));
  return `${t.slice(0, keep)}\n…[clipped ${t.length - keep * 2} chars]…\n${t.slice(-keep)}`;
}

function unwrapInner(wrapper: any): Record<string, unknown> | null {
  if (!wrapper || typeof wrapper !== 'object') return null;
  if (wrapper.type === 'event' && wrapper.event && typeof wrapper.event === 'object') {
    return wrapper.event as Record<string, unknown>;
  }
  if (wrapper.type === 'compacted') return null;
  if (wrapper.event && typeof wrapper.event === 'object' && typeof wrapper.type !== 'string') {
    return wrapper.event as Record<string, unknown>;
  }
  return wrapper as Record<string, unknown>;
}

function assistantTextBlocks(inner: Record<string, unknown>): string[] {
  const msg = inner.message;
  const content = msg && typeof msg === 'object' ? (msg as { content?: unknown }).content : inner.content;
  if (typeof content === 'string') return content.trim() ? [content] : [];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const c of content) {
    if (c && typeof c === 'object' && (c as { type?: string }).type === 'text' && typeof (c as { text?: string }).text === 'string') {
      const t = (c as { text: string }).text.trim();
      if (t) out.push((c as { text: string }).text);
    }
  }
  return out;
}

function flushPending(
  pending: string,
  seq: number,
  afterAutomation: boolean,
  turns: VisibleTurn[],
): boolean {
  const body = pending.trim();
  if (!body) return afterAutomation;
  if (afterAutomation && (isQuietRoutineReply(body) || isExactNoUpdate(body))) return false;
  turns.push({ role: 'assistant', text: clipTurn(body), seq });
  return false;
}

/** Visible user+assistant turns for the model window. Skips tool results,
 *  MCP dumps, hidden routine prompts, and quiet NO_UPDATE replies. */
export function extractVisibleTurns(events: Seqish[]): VisibleTurn[] {
  const turns: VisibleTurn[] = [];
  const openText = new Map<number, string>();
  let pendingAssistant = '';
  let pendingAssistantSeq = 0;
  let haveAssistantEvent = false;
  let afterAutomation = false;

  const takeStreamTail = (): string => {
    const chunks: string[] = [];
    for (const chunk of openText.values()) chunks.push(chunk);
    openText.clear();
    return chunks.join('').trim();
  };

  const flushAssistant = () => {
    const trailing = takeStreamTail();
    const body = haveAssistantEvent
      ? pendingAssistant
      : `${pendingAssistant}${trailing ? `\n${trailing}` : ''}`;
    const seq = pendingAssistantSeq;
    pendingAssistant = '';
    pendingAssistantSeq = 0;
    haveAssistantEvent = false;
    afterAutomation = flushPending(body, seq, afterAutomation, turns);
  };

  for (let i = 0; i < events.length; i++) {
    const se = events[i];
    const seq = typeof se.seq === 'number' && se.seq > 0 ? se.seq : i + 1;
    const inner = unwrapInner(se.ev);
    if (!inner) continue;
    const t = inner.type;

    if (t === '_user_echo' && typeof inner.text === 'string') {
      flushAssistant();
      const text = inner.text.trim();
      if (!text) continue;
      if (isRoutinePromptText(text)) {
        afterAutomation = true;
        continue;
      }
      turns.push({ role: 'user', text: clipTurn(text), seq });
      afterAutomation = false;
      continue;
    }

    if (t === 'peer_message') {
      flushAssistant();
      if (isAutomationPeerEvent(se.ev) || (typeof inner.text === 'string' && isRoutinePromptText(inner.text))) {
        afterAutomation = true;
        continue;
      }
      const from = typeof inner.from === 'string' && inner.from.trim() ? inner.from.trim() : 'peer';
      const text = typeof inner.text === 'string' ? inner.text.trim() : '';
      if (text) {
        turns.push({ role: 'user', text: clipTurn(`[${from}] ${text}`), seq });
        afterAutomation = false;
      }
      continue;
    }

    if (t === 'assistant') {
      const texts = assistantTextBlocks(inner);
      if (texts.length) {
        const joined = texts.join('\n').trim();
        if (joined) {
          pendingAssistant = haveAssistantEvent ? `${pendingAssistant}\n${joined}` : joined;
          pendingAssistantSeq = seq;
          haveAssistantEvent = true;
          openText.clear();
        }
      }
      continue;
    }

    if (t === 'stream_event' && inner.event && typeof inner.event === 'object') {
      const stream = inner.event as { type?: unknown; index?: unknown; delta?: any; content_block?: any };
      if (stream.type === 'message_start') {
        if (pendingAssistant || openText.size) flushAssistant();
        pendingAssistantSeq = seq;
        continue;
      }
      if (haveAssistantEvent) continue;
      if (stream.type === 'content_block_start' && typeof stream.index === 'number') {
        if (stream.content_block?.type === 'text') openText.set(stream.index, '');
        continue;
      }
      if (stream.type === 'content_block_delta' && typeof stream.index === 'number') {
        if (stream.delta?.type === 'text_delta' && typeof stream.delta.text === 'string' && openText.has(stream.index)) {
          openText.set(stream.index, (openText.get(stream.index) ?? '') + stream.delta.text);
          pendingAssistantSeq = seq;
        }
        continue;
      }
      if (stream.type === 'content_block_stop' && typeof stream.index === 'number') {
        const finished = openText.get(stream.index);
        if (finished !== undefined) {
          openText.delete(stream.index);
          const trimmed = finished.trim();
          if (trimmed) {
            pendingAssistant = pendingAssistant ? `${pendingAssistant}\n${trimmed}` : trimmed;
            pendingAssistantSeq = seq;
          }
        }
      }
    }
  }
  flushAssistant();
  return turns;
}

export function splitWindow(turns: VisibleTurn[], size = WINDOW_TURNS): WindowSplit {
  if (turns.length <= size) return { window: turns, overflow: [] };
  return { window: turns.slice(-size), overflow: turns.slice(0, turns.length - size) };
}

export function overflowChars(turns: VisibleTurn[]): number {
  let n = 0;
  for (const t of turns) n += t.text.length;
  return n;
}

export function shouldCompactOverflow(overflow: VisibleTurn[]): boolean {
  if (overflow.length >= HARD_OVERFLOW_TURNS) return true;
  if (overflow.length >= MIN_OVERFLOW_TURNS && overflowChars(overflow) >= MIN_OVERFLOW_CHARS) return true;
  return false;
}

/** Aged-out turns for the compact slot (history − last 50). Never the tail. */
export function formatAgedTurns(turns: VisibleTurn[]): string {
  if (turns.length === 0) return '';
  return turns.map((t) => `${t.role === 'user' ? 'MATT' : 'AGENT'}: ${t.text}`).join('\n\n');
}

/** Compact slot: overwriteable blob, plus any overflow not yet merged. Never the last 50. */
export function compactSlotText(opts: {
  compact?: string | null;
  unmergedOverflow: VisibleTurn[];
}): string {
  const blob = (opts.compact ?? '').trim();
  const kept: VisibleTurn[] = [];
  let used = 0;
  for (const t of opts.unmergedOverflow) {
    const cost = t.text.length + 16;
    if (kept.length > 0 && used + cost > MAX_UNMERGED_OVERFLOW_CHARS) break;
    kept.push(t);
    used += cost;
  }
  const aged = formatAgedTurns(kept);
  const omitted = opts.unmergedOverflow.length - kept.length;
  const agedBlock = omitted > 0
    ? `${aged}\n\n…[${omitted} further aged-out turns omitted from this seed; they stay in the Rivendell log until compact overwrites this document]`
    : aged;
  if (blob && agedBlock) {
    return `${blob}\n\n---\n\nAged-out turns not yet merged into the document above:\n\n${agedBlock}`;
  }
  return blob || agedBlock;
}

export function formatWorkingWindow(turns: VisibleTurn[]): string {
  if (turns.length === 0) return '';
  const body = JSON.stringify(
    turns.map((t) => ({ role: t.role, text: t.text })),
    null,
    2,
  );
  return [
    'Working window — the last visible user and assistant turns (no tool results, no MCP dumps, no hidden routine prompts). Treat these as the live conversation.',
    body,
  ].join('\n');
}

const PRIMER_HEADER = `You are continuing a single long-running conversation. The model window is persona/rules (already in your system prompt) plus the two blocks below — NOT the full engine session jsonl.

1) Rolling memory: one document that OVERWRITES itself. It is the summary of everything older than the working window. There is not a stack of primers; this is the only compact.
2) Working window: the last visible user/assistant turns.

Continue seamlessly. If something from before the working window matters and is not in the rolling memory, say so rather than guessing.
`;

export function buildEnginePrimer(compact: string | null | undefined, window: VisibleTurn[]): string {
  const compactText = (compact ?? '').trim();
  const windowText = formatWorkingWindow(window);
  if (!compactText && !windowText) return '';
  const parts = [PRIMER_HEADER];
  if (compactText) {
    parts.push('## Rolling memory (everything older than the last 50 visible turns)\n');
    parts.push(compactText);
  } else {
    parts.push('## Rolling memory\n\n(none yet — the working window is the whole visible conversation so far.)');
  }
  if (windowText) {
    parts.push('\n## Working window (last 50 visible turns)\n');
    parts.push(windowText);
  }
  return parts.join('\n');
}

export function usageTokenTotal(usage: unknown): number {
  if (!usage || typeof usage !== 'object') return 0;
  const u = usage as Record<string, unknown>;
  const n = (k: string) => {
    const v = u[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  return n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens');
}

/** Usage for the current engine session only — never a previous thread's result. */
export function lastContextTokenEstimate(events: Seqish[], sessionId?: string | null): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const inner = unwrapInner(events[i].ev);
    if (!inner) continue;
    if (inner.type === 'result') {
      if (sessionId) {
        if (typeof inner.session_id !== 'string' || inner.session_id !== sessionId) continue;
      }
      const total = usageTokenTotal(inner.usage);
      if (total > 0) return total;
      continue;
    }
    if (sessionId) continue;
    if (inner.type === 'stream_event' && inner.event && typeof inner.event === 'object') {
      const stream = inner.event as { type?: unknown; message?: { usage?: unknown } };
      if (stream.type === 'message_start') {
        const total = usageTokenTotal(stream.message?.usage);
        if (total > 0) return total;
      }
    }
  }
  return null;
}

function claudeConfigDir(cli: string): string {
  if (cli === 'xai') return join(homedir(), '.claude-xai');
  if (cli === 'zai') return join(homedir(), '.claude-zai');
  return join(homedir(), '.claude');
}

function encodeClaudeProject(cwd: string): string {
  return cwd.replace(/[\\/]/g, '-');
}

export function claudeSessionJsonlBytes(cli: string, cwd: string, sessionId: string | null | undefined): number {
  if (!sessionId) return 0;
  const path = join(claudeConfigDir(cli), 'projects', encodeClaudeProject(cwd), `${sessionId}.jsonl`);
  try {
    if (!existsSync(path)) return 0;
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Tool dumps bloat jsonl after a single turn. That must not kill a live session. */
export function isEngineFat(_opts: {
  events: Seqish[];
  cli: string;
  cwd: string;
  sessionId?: string | null;
}): boolean {
  return false;
}

/**
 * Spawn-time only: do not `--resume` a jsonl/tool dump into a new process.
 * Seed compact(history − last50) + last 50 instead. Does not kill a live process.
 */
export function shouldSkipEngineResume(opts: {
  events: Seqish[];
  cli: string;
  cwd: string;
  sessionId: string | null | undefined;
}): boolean {
  if (extractVisibleTurns(opts.events).length > WINDOW_TURNS) return true;
  if (!opts.sessionId) return false;
  return claudeSessionJsonlBytes(opts.cli, opts.cwd, opts.sessionId) > JSONL_RESUME_SKIP_BYTES;
}

export type ForeverTurn = {
  visibleTurns: number;
  overflowTurns: number;
  windowTurns: number;
  unmergedOverflowTurns: number;
  /** Visible turns older than the last 50 — what compact covers. */
  compactCovers: number;
  window: VisibleTurn[];
  overflow: VisibleTurn[];
  unmergedOverflow: VisibleTurn[];
  compactText: string;
  primer: string;
  shouldCompact: boolean;
  /** True only if the compact slot is the last-50 tail. Must stay false. */
  compactIsTheLast50: boolean;
};

/** One-turn assembly: persona stays in the runner; this is compact + last 50. */
export function assembleForeverTurn(opts: {
  events: Seqish[];
  compact?: string | null;
  lastCompactedSeq?: number;
}): ForeverTurn {
  const turns = extractVisibleTurns(opts.events);
  const { window, overflow } = splitWindow(turns);
  const lastSeq = opts.lastCompactedSeq ?? 0;
  const unmergedOverflow = overflow.filter((t) => t.seq > lastSeq);
  const compactText = compactSlotText({ compact: opts.compact, unmergedOverflow });
  const primer = buildEnginePrimer(compactText, window);
  return {
    visibleTurns: turns.length,
    overflowTurns: overflow.length,
    windowTurns: window.length,
    unmergedOverflowTurns: unmergedOverflow.length,
    compactCovers: overflow.length,
    window,
    overflow,
    unmergedOverflow,
    compactText,
    primer,
    shouldCompact: shouldCompactOverflow(unmergedOverflow),
    compactIsTheLast50: compactText.length > 0 && compactText === formatAgedTurns(window),
  };
}

export function describeTurnAssembly(turn: ForeverTurn): string {
  const compactKind = turn.overflowTurns === 0
    ? 'none yet (the working window is the whole visible conversation)'
    : `${turn.overflowTurns} older visible turns (history − last ${WINDOW_TURNS})`;
  return [
    'Each send assembles:',
    '  1. persona / FACE / rules (tiny, injected by the runner)',
    `  2. compact = ${compactKind}`,
    `  3. last ${turn.windowTurns} visible user/assistant turns (working window)`,
    '  NOT sent: Rivendell event-log jsonl, Claude session jsonl, tool-result novels',
    `  compact === last ${WINDOW_TURNS}? ${turn.compactIsTheLast50 ? 'YES (BUG)' : 'no'}`,
  ].join('\n');
}

/** Fixture for dry reconstruction: N visible user/assistant turns, no tools. */
export function syntheticVisibleEvents(visibleTurns: number): Seqish[] {
  const events: Seqish[] = [];
  for (let i = 0; i < visibleTurns; i++) {
    const seq = i + 1;
    const n = Math.floor(i / 2) + 1;
    const pad = 'detail '.repeat(10).trim();
    if (i % 2 === 0) {
      events.push({
        seq,
        ev: {
          type: 'event',
          event: { type: '_user_echo', text: `user turn ${n} (visible ${seq}/${visibleTurns}) ${pad}`, ts: seq },
        },
      });
    } else {
      events.push({
        seq,
        ev: {
          type: 'event',
          event: {
            type: 'assistant',
            message: { content: [{ type: 'text', text: `assistant turn ${n} (visible ${seq}/${visibleTurns}) ${pad}` }] },
          },
        },
      });
    }
  }
  return events;
}

export type PayloadSummary = {
  visibleTurns: number;
  windowTurns: number;
  overflowTurns: number;
  unmergedOverflowTurns: number;
  compactCovers: number;
  compactIsTheLast50: boolean;
  windowChars: number;
  overflowChars: number;
  shouldCompact: boolean;
  engineFat: boolean;
  tokenEstimate: number | null;
  jsonlBytes: number;
  primerChars: number;
  primerHasCompact: boolean;
};

export function summarizeForeverPayload(opts: {
  events: Seqish[];
  compact?: string | null;
  lastCompactedSeq?: number;
  cli?: string;
  cwd?: string;
  sessionId?: string | null;
}): PayloadSummary {
  const assembled = assembleForeverTurn({
    events: opts.events,
    compact: opts.compact,
    lastCompactedSeq: opts.lastCompactedSeq,
  });
  const cli = opts.cli ?? '';
  const cwd = opts.cwd ?? '';
  return {
    visibleTurns: assembled.visibleTurns,
    windowTurns: assembled.windowTurns,
    overflowTurns: assembled.overflowTurns,
    unmergedOverflowTurns: assembled.unmergedOverflowTurns,
    compactCovers: assembled.compactCovers,
    compactIsTheLast50: assembled.compactIsTheLast50,
    windowChars: overflowChars(assembled.window),
    overflowChars: overflowChars(assembled.overflow),
    shouldCompact: assembled.shouldCompact,
    engineFat: cli && cwd ? isEngineFat({ events: opts.events, cli, cwd, sessionId: opts.sessionId }) : false,
    tokenEstimate: lastContextTokenEstimate(opts.events),
    jsonlBytes: cli && cwd ? claudeSessionJsonlBytes(cli, cwd, opts.sessionId) : 0,
    primerChars: assembled.primer.length,
    primerHasCompact: Boolean(assembled.compactText.trim()),
  };
}
