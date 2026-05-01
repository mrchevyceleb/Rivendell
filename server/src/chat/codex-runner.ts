import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliKind, SessionEvent, SeqEvent } from './runner.ts';
import { getSessionId, setSessionId } from './sessions.ts';

const EVENT_BUFFER_SIZE = 2000;

// Codex doesn't have a stdin-streaming mode (the way claude does with
// --input-format stream-json), so each turn spawns a fresh `codex exec --json`
// process that runs to completion. We normalize codex's `item.started` /
// `item.completed` events into the same claude-shaped stream-json event
// vocabulary the front-end already understands, so the reducer doesn't need
// to know there's a second CLI behind the curtain.

export type Listener = (e: SeqEvent) => void;

let nextSyntheticId = 1;
const synth = (prefix: string) => `${prefix}_${nextSyntheticId++}`;
type ChatImage = { mediaType: string; base64: string };
type ToolUseBlock = { index: number; toolUseId: string };
type CodexTurnState = {
  messageId: string;
  nextBlockIndex: number;
  toolUseBlocks: Map<string, ToolUseBlock>;
};

const CODEX_TURN_PREAMBLE = [
  '<samwise-codex-runtime>',
  'When you run shell commands that may take more than a few seconds or need polling, use exec_command with tty=true. This includes gh run watch, dev servers, test watchers, and other watch or follow commands.',
  'If you see "stdin is closed for this session", rerun the command with tty=true.',
  '</samwise-codex-runtime>',
].join('\n');

const imageExtension = (mediaType: string): string => {
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/gif') return 'gif';
  if (mediaType === 'image/webp') return 'webp';
  const subtype = mediaType.split('/')[1]?.split('+')[0] ?? 'img';
  return subtype.replace(/[^a-z0-9]/gi, '') || 'img';
};

export class CodexSession {
  readonly key: string;
  readonly cli: CliKind = 'codex';
  readonly cwd: string;
  private listeners = new Set<Listener>();
  private subscriberCount = 0;
  private threadId: string | null = null;
  private busy = false;
  private dead = false;
  private currentChild: ChildProcess | null = null;
  private eventLog: SeqEvent[] = [];
  private nextSeq = 1;
  private lastActivityAtMs = Date.now();
  /** Codex doesn't need a warmup turn — ready immediately. */
  readonly ready: Promise<boolean> = Promise.resolve(true);

  constructor(cwd: string, threadId: string | null) {
    this.cwd = cwd;
    this.key = `codex|${cwd}`;
    this.threadId = threadId;
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
    if (this.currentChild) {
      try { this.currentChild.kill('SIGTERM'); } catch {}
    }
  }

  async send(text: string, images?: ChatImage[]): Promise<void> {
    if (this.busy) {
      this.emit({
        type: 'error',
        message: 'codex is still answering — wait for the current turn to finish',
      });
      return;
    }
    this.busy = true;
    // Echo for reconnect replay (codex's events don't re-emit the user prompt).
    this.emit({
      type: 'event',
      event: { type: '_user_echo', text, imageCount: images?.length ?? 0, ts: Date.now() },
    });

    let imageTempDir: string | null = null;
    const cleanupImages = () => {
      if (imageTempDir) void rm(imageTempDir, { recursive: true, force: true });
    };

    const imageArgs: string[] = [];
    try {
      if (images?.length) {
        imageTempDir = await mkdtemp(join(tmpdir(), 'samwise-codex-images-'));
        for (const [index, image] of images.entries()) {
          if (!image.mediaType.startsWith('image/')) {
            throw new Error(`unsupported image media type: ${image.mediaType}`);
          }
          const path = join(imageTempDir, `image-${index + 1}.${imageExtension(image.mediaType)}`);
          await writeFile(path, Buffer.from(image.base64, 'base64'));
          imageArgs.push('--image', path);
        }
      }
    } catch (e) {
      cleanupImages();
      this.busy = false;
      this.emit({ type: 'error', message: `image preparation failed: ${(e as Error).message}` });
      this.emit({ type: 'turnEnd', sessionId: this.threadId ?? undefined });
      return;
    }

    const prompt = `${CODEX_TURN_PREAMBLE}\n\n${text}`;
    const args: string[] = this.threadId
      ? [
          'exec',
          'resume',
          '--json',
          '--dangerously-bypass-approvals-and-sandbox',
          ...imageArgs,
          this.threadId,
          prompt,
        ]
      : [
          'exec',
          '--json',
          '--dangerously-bypass-approvals-and-sandbox',
          ...imageArgs,
          prompt,
        ];

    const child = spawn('codex', args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.currentChild = child;

    // Synthesize a claude-shaped message_start so the reducer's turn handling
    // stays consistent across CLIs.
    const turnState: CodexTurnState = {
      messageId: synth('msg'),
      nextBlockIndex: 0,
      toolUseBlocks: new Map(),
    };
    const stderrChunks: string[] = [];

    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          this.handleCodexEvent(ev, turnState);
        } catch {
          // Non-JSON line — ignore.
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Codex prints a few benign lines on startup (e.g. "Reading additional
      // input from stdin...") and a "thread X not found" rollout warning when
      // resuming. Filter those — surface only the lines that look like real
      // errors.
      const text = chunk.trim();
      if (!text) return;
      if (/Reading additional input from stdin/i.test(text)) return;
      if (/failed to record rollout items/i.test(text)) return;
      stderrChunks.push(text);
      this.emit({ type: 'error', message: text });
    });

    child.on('exit', async (code) => {
      this.busy = false;
      this.currentChild = null;
      cleanupImages();
      this.closeDanglingToolBlocks(turnState, code, stderrChunks.join('\n').trim());
      // Emit a result event so the front-end flips status back to 'ready'.
      this.emitClaudeEvent({
        type: 'result',
        subtype: code === 0 ? 'success' : 'error_during_execution',
        is_error: code !== 0,
        session_id: this.threadId ?? undefined,
      });
      if (this.threadId) {
        await setSessionId('codex', this.cwd, this.threadId);
      }
      this.emit({ type: 'turnEnd', sessionId: this.threadId ?? undefined });
    });

    child.on('error', (err) => {
      this.busy = false;
      this.currentChild = null;
      cleanupImages();
      this.closeDanglingToolBlocks(turnState, null, err.message);
      this.emit({ type: 'error', message: `codex spawn failed: ${err.message}` });
      this.emit({ type: 'turnEnd', sessionId: this.threadId ?? undefined });
    });
  }

  // ── private ────────────────────────────────────────────────

  private emit(msg: SessionEvent): void {
    this.lastActivityAtMs = Date.now();
    const se: SeqEvent = { seq: this.nextSeq++, ev: msg };
    this.eventLog.push(se);
    if (this.eventLog.length > EVENT_BUFFER_SIZE) {
      this.eventLog.splice(0, this.eventLog.length - EVENT_BUFFER_SIZE);
    }
    for (const fn of this.listeners) fn(se);
  }

  /** Forward an event already in claude stream-json shape. */
  private emitClaudeEvent(event: any): void {
    this.emit({ type: 'event', event });
  }

  private handleCodexEvent(
    ev: any,
    state: CodexTurnState,
  ): void {
    if (!ev || typeof ev !== 'object') return;

    // Capture the thread id for resume on later turns.
    if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') {
      this.threadId = ev.thread_id;
      this.emitClaudeEvent({
        type: 'system',
        subtype: 'init',
        session_id: ev.thread_id,
      });
      return;
    }

    if (ev.type === 'turn.started') {
      this.emitClaudeEvent({
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: { id: state.messageId, role: 'assistant' },
        },
      });
      return;
    }

    if (ev.type === 'item.started' && ev.item?.type === 'command_execution') {
      const idx = state.nextBlockIndex++;
      const toolUseId = synth('tool');
      state.toolUseBlocks.set(ev.item.id, {
        index: idx,
        toolUseId,
      });
      this.emitClaudeEvent({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: idx,
          content_block: { type: 'tool_use', id: toolUseId, name: 'Bash' },
        },
      });
      this.emitClaudeEvent({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: idx,
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify({ command: ev.item.command ?? '' }),
          },
        },
      });
      return;
    }

    if (ev.type === 'item.completed' && ev.item?.type === 'command_execution') {
      const block = state.toolUseBlocks.get(ev.item.id);
      if (!block) return;
      this.emitClaudeEvent({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: block.index },
      });
      // Emit a synthetic user message carrying the tool_result, the way
      // claude does, so the reducer attaches the output to the right block.
      const output: string = ev.item.aggregated_output ?? '';
      this.emitClaudeEvent({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: block.toolUseId,
              content: [{ type: 'text', text: output }],
            },
          ],
        },
      });
      state.toolUseBlocks.delete(ev.item.id);
      return;
    }

    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
      const idx = state.nextBlockIndex++;
      const text: string = typeof ev.item.text === 'string' ? ev.item.text : '';
      this.emitClaudeEvent({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: idx,
          content_block: { type: 'text', text: '' },
        },
      });
      this.emitClaudeEvent({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: idx,
          delta: { type: 'text_delta', text },
        },
      });
      this.emitClaudeEvent({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: idx },
      });
      return;
    }

    // Other event types (turn.completed, etc.) — ignore.
  }

  private closeDanglingToolBlocks(
    state: CodexTurnState,
    code: number | null,
    detail: string,
  ): void {
    if (state.toolUseBlocks.size === 0) return;

    const fallback = code === 0
      ? 'Codex finished before reporting command output.'
      : `Codex exited before this command returned${typeof code === 'number' ? ` (code ${code})` : ''}.`;
    const text = detail || fallback;

    for (const block of state.toolUseBlocks.values()) {
      this.emitClaudeEvent({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: block.index },
      });
      this.emitClaudeEvent({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: block.toolUseId,
              content: [{ type: 'text', text }],
            },
          ],
        },
      });
    }
    state.toolUseBlocks.clear();
  }
}

/** Manager keyed by cwd — same semantics as the claude session map. */
const codexSessions = new Map<string, CodexSession>();

export function activeCodexSessions(): {
  cli: CliKind;
  cwd: string;
  busy: boolean;
  sessionId: string | null;
  lastActivityAt: number;
}[] {
  return Array.from(codexSessions.values()).map((s) => ({
    cli: 'codex',
    cwd: s.cwd,
    busy: s.isBusy(),
    sessionId: s.sessionId(),
    lastActivityAt: s.lastActivityAt(),
  }));
}

export function pruneIdleCodexSessions(ttlMs: number, now = Date.now()): number {
  let pruned = 0;
  for (const [key, session] of codexSessions) {
    if (session.isBusy()) continue;
    if (session.listenerCount() > 0) continue;
    if (now - session.lastActivityAt() < ttlMs) continue;
    session.shutdown();
    codexSessions.delete(key);
    pruned += 1;
  }
  return pruned;
}

export async function getOrCreateCodexSession(opts: { repoPath: string }): Promise<CodexSession> {
  const cwd = opts.repoPath;
  const key = `codex|${cwd}`;
  const existing = codexSessions.get(key);
  if (existing && existing.isAlive()) return existing;

  const threadId = (await getSessionId('codex', cwd)) ?? null;
  const session = new CodexSession(cwd, threadId);
  codexSessions.set(key, session);
  return session;
}

export function shutdownAllCodexSessions(): void {
  for (const s of codexSessions.values()) s.shutdown();
  codexSessions.clear();
}

/** Kill the in-flight codex child but keep the thread id saved for resume. */
export function interruptCodex(opts: { repoPath: string }): void {
  const cwd = opts.repoPath;
  const key = `codex|${cwd}`;
  const s = codexSessions.get(key);
  if (s) {
    s.shutdown();
    codexSessions.delete(key);
  }
}

/** Drop the stored thread id so the next codex spawn starts a fresh thread. */
export async function freshStartCodex(opts: { repoPath: string }): Promise<CodexSession> {
  const cwd = opts.repoPath;
  const key = `codex|${cwd}`;
  const existing = codexSessions.get(key);
  if (existing) {
    existing.shutdown();
    codexSessions.delete(key);
  }
  await setSessionId('codex', cwd, '');
  const session = new CodexSession(cwd, null);
  codexSessions.set(key, session);
  return session;
}
