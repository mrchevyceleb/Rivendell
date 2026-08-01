import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliKind, SessionEvent, SeqEvent } from './runner.ts';
import { getSessionId, setSessionId } from './sessions.ts';
import { appendEventLog, clearEventLog, compactEventLog, loadEventLogSync } from './event-log-store.ts';
import { fileProviderErrorMessage, isTransientFileProviderError } from '../lib/fileProvider.ts';
import { assertMemoryAvailableForSpawn, MemoryPressureSpawnError } from './memory.ts';
import { accountEnv, accountEnvForAccount, accountFromChatId } from '../lib/accountResolver.ts';
import { resolveCodexSelection } from './codex-models.ts';
import { HUB_WRITE_LOCK_PROMPT } from '../lib/hubPaths.ts';

/**
 * Which codex binary to run.
 *
 * Do NOT rely on bare 'codex' resolving through PATH here. Rivendell is started
 * by npm, which prepends every ancestor node_modules/.bin, so a stale
 * @openai/codex in ~/node_modules shadows the real install and every turn fails
 * with a 400 the transcript never shows. Prefer the standalone install, allow an
 * explicit override, and only then fall back to PATH.
 */
function resolveCodexBin(): string {
  const explicit = process.env.RIVENDELL_CODEX_BIN;
  if (explicit) return explicit;
  const standalone = join(homedir(), '.local', 'bin', 'codex');
  return existsSync(standalone) ? standalone : 'codex';
}

const CODEX_BIN = resolveCodexBin();
console.log(`[chat codex] binary: ${CODEX_BIN}`);

function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const descendants = child.pid ? collectDescendantPids(child.pid) : [];
  try { child.kill(signal); } catch {}
  if (child.pid) {
    try { process.kill(-child.pid, signal); } catch {}
  }
  for (const pid of descendants.reverse()) {
    try { process.kill(pid, signal); } catch {}
  }
}

/** Resolve once the child has fully exited. SIGTERM first; SIGKILL after 3s
 *  if still alive. Returns immediately if the child is already dead.
 *  Used by shutdown() so the next `codex exec resume` only starts after the
 *  prior child has released the rollout JSONL. Without this, steer races
 *  against the dying child's final writes and the resume reads partial state. */
async function waitForTreeExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    const done = () => resolve();
    child.once('exit', done);
    child.once('error', done);
  });
  terminateProcessTree(child, 'SIGTERM');
  const sigkill = setTimeout(() => {
    if (child.exitCode === null) terminateProcessTree(child, 'SIGKILL');
  }, 3000);
  sigkill.unref();
  await exited;
  clearTimeout(sigkill);
}

function collectDescendantPids(pid: number): number[] {
  try {
    const out = execFileSync('/usr/bin/pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 1000 });
    const children = out
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    return children.flatMap((childPid) => [childPid, ...collectDescendantPids(childPid)]);
  } catch {
    return [];
  }
}

// OneDrive's fileproviderd daemon intermittently holds an exclusive lock on
// `.codex/config.toml` while syncing, which surfaces in Codex as
// "Resource deadlock avoided (os error 11)" at startup and kills the turn.
// We probe the file before spawning so the sync window can clear; reading it
// from Node also tends to "warm" the placeholder so Codex's own read on the
// heels of ours succeeds.
const PROJECT_CONFIG_PROBE_RETRIES = 8;
const PROJECT_CONFIG_PROBE_DELAY_MS = 250;
type ProjectConfigProbeResult =
  | { ok: true }
  | { ok: false; message: string };

async function probeProjectConfigFile(path: string): Promise<ProjectConfigProbeResult> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= PROJECT_CONFIG_PROBE_RETRIES; attempt += 1) {
    try {
      await readFile(path, 'utf8');
      return { ok: true };
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      // ENOENT: no project config — nothing to probe, codex will skip it.
      if (code === 'ENOENT') return { ok: true };
      if (!isTransientFileProviderError(err)) {
        // Any other read failure: log and let codex try anyway.
        console.warn(`[chat codex] project config probe failed: ${fileProviderErrorMessage(err)}`);
        return { ok: true };
      }
      if (attempt === PROJECT_CONFIG_PROBE_RETRIES) break;
      await new Promise((r) => setTimeout(
        r,
        Math.min(1500, PROJECT_CONFIG_PROBE_DELAY_MS * (attempt + 1)),
      ));
    }
  }

  return {
    ok: false,
    message:
      `OneDrive is still locking ${path} after ${PROJECT_CONFIG_PROBE_RETRIES + 1} read attempts. ` +
      `Retry in a moment, or move ASSISTANT-HUB off OneDrive. Last error: ${fileProviderErrorMessage(lastErr)}`,
  };
}

async function probeProjectConfig(cwd: string): Promise<ProjectConfigProbeResult> {
  for (const path of [join(cwd, '.codex', 'config.toml'), join(cwd, '.codex', 'hooks.json')]) {
    const result = await probeProjectConfigFile(path);
    if (!result.ok) return result;
  }
  return { ok: true };
}

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
type CodexSessionOptions = { recoverContextOnNextTurn?: boolean; cli?: CliKind };
type ToolUseBlock = { index: number; toolUseId: string };
type CodexUsage = {
  input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  output_tokens: number;
};
type CodexTurnState = {
  messageId: string;
  nextBlockIndex: number;
  toolUseBlocks: Map<string, ToolUseBlock>;
  usage: CodexUsage | null;
};

const CODEX_TURN_PREAMBLE = [
  '<samwise-codex-runtime>',
  'When you run shell commands that may take more than a few seconds or need polling, use exec_command with tty=true. This includes gh run watch, dev servers, test watchers, and other watch or follow commands.',
  'If you see "stdin is closed for this session", rerun the command with tty=true.',
  'When searching files, use `rg` or `rg --files` with scoped paths and exclusions for `node_modules`, `.git`, build output, and CloudStorage sync trees. Do not run broad recursive `grep` or `find` over `/Users/mjohnst`, `~/samwise`, or ASSISTANT-HUB.',
  'Give spawned subagents the same search constraint before asking them to inspect code.',
  HUB_WRITE_LOCK_PROMPT,
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

const CODEX_TRACING_LINE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(ERROR|WARN|INFO|DEBUG|TRACE)\s+[\w_]+(?:::[\w_]+)*:/;
const CODEX_PROJECT_CONFIG_ERROR = /(config\.toml|hooks\.json|project config|error loading config)/i;

function isIgnorableCodexStderr(line: string): boolean {
  if (/Reading additional input from stdin/i.test(line)) return true;
  if (/failed to record rollout items/i.test(line)) return true;
  if (/write_stdin failed: stdin is closed for this session/i.test(line)) return true;
  return CODEX_TRACING_LINE.test(line);
}

function recapSnippet(text: string, max = 700): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 32)} ... [truncated ${flat.length - max + 32} chars]`;
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item: any) => {
        if (item?.type === 'text' && typeof item.text === 'string') return item.text;
        if (typeof item === 'string') return item;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export class CodexSession {
  readonly key: string;
  readonly cli: CliKind;
  readonly cwd: string;
  readonly chatId: string;
  private listeners = new Set<Listener>();
  private subscriberCount = 0;
  private threadId: string | null = null;
  private busy = false;
  private dead = false;
  private currentChild: ChildProcess | null = null;
  /** Set by shutdown() before the SIGTERM so the in-flight send()'s exit
   *  handler knows not to emit a stray result/turnEnd — the steer/stop
   *  caller is driving the next state itself. */
  private intentionalKill = false;
  private eventLog: SeqEvent[] = [];
  private nextSeq = 1;
  private lastActivityAtMs = Date.now();
  private recoverContextOnNextTurn = false;
  private threadIdWrite: Promise<void> = Promise.resolve();
  private cancellationEmitted = false;
  /** Codex doesn't need a warmup turn — ready immediately. */
  readonly ready: Promise<boolean> = Promise.resolve(true);

  constructor(cwd: string, chatId: string, threadId: string | null, opts: CodexSessionOptions = {}) {
    this.cwd = cwd;
    this.chatId = chatId;
    this.cli = opts.cli ?? 'codex';
    this.key = keyOf(this.cli, cwd, chatId);
    this.threadId = threadId;
    this.recoverContextOnNextTurn = opts.recoverContextOnNextTurn === true;

    // Mirror the claude path: rehydrate eventLog from disk so a server
    // restart between turns doesn't strand a reconnecting client whose
    // sinceSeq is past the new in-memory latestSeq.
    try {
      const restored = loadEventLogSync(this.key);
      if (restored.events.length > 0) {
        this.eventLog = restored.events;
        this.nextSeq = restored.nextSeq;
        console.log(
          `[chat codex] restored ${restored.events.length} event(s) from disk for ${this.key} (nextSeq=${this.nextSeq})`,
        );
      }
    } catch (err) {
      console.warn(`[chat codex] event-log restore failed for ${this.key}:`, (err as Error).message);
    }
    if (!this.threadId) {
      const restoredThreadId = latestThreadIdFromEvents(this.eventLog);
      if (restoredThreadId) {
        void this.persistThreadId(restoredThreadId);
        console.warn(`[chat codex] restored missing thread id ${restoredThreadId} from event log for ${this.key}`);
      } else if (this.eventLog.length > 0) {
        this.recoverContextOnNextTurn = true;
        console.warn(`[chat codex] no saved thread id for ${this.key}; will recover context from event log on next turn`);
      }
    }
    void compactEventLog(this.key);
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

  /** Async so steering can await the child's full exit (SIGKILL fallback at
   *  3s) before the next `codex exec resume` spawns. Without the await, the
   *  dying child's final writes to the rollout JSONL race the resume read. */
  async shutdown(): Promise<void> {
    if (this.dead) return;
    const shouldEmitCancellation = this.busy;
    this.dead = true;
    const latestThreadId = this.threadId ?? latestThreadIdFromEvents(this.eventLog);
    if (latestThreadId) {
      await this.persistThreadId(latestThreadId);
    }
    const child = this.currentChild;
    if (child && child.exitCode === null) {
      this.intentionalKill = true;
      await waitForTreeExit(child);
    }
    await this.threadIdWrite.catch(() => undefined);
    if (shouldEmitCancellation) this.emitCancellationTurnEnd();
  }

  private persistThreadId(threadId: string): Promise<void> {
    this.threadId = threadId;
    this.threadIdWrite = this.threadIdWrite.then(
      () => setSessionId(this.cli, this.cwd, threadId, this.chatId),
      () => setSessionId(this.cli, this.cwd, threadId, this.chatId),
    );
    return this.threadIdWrite;
  }

  private emitCancellationTurnEnd(): void {
    if (this.cancellationEmitted) return;
    this.cancellationEmitted = true;
    this.busy = false;
    this.currentChild = null;
    this.emit({ type: 'event', event: { type: '_interrupted', ts: Date.now() } });
    this.emit({ type: 'turnEnd', sessionId: this.threadId ?? undefined });
  }

  private buildTranscriptRecap(): string {
    type Turn = { role: 'user' | 'assistant'; text: string };
    const turns: Turn[] = [];
    const openText = new Map<number, string>();
    const openTools = new Map<number, { name: string; input: string }>();
    let pendingAssistant = '';

    const flushAssistant = () => {
      const finalChunks = Array.from(openText.values());
      openText.clear();
      const trailing = finalChunks.join('').trim();
      const body = (pendingAssistant + (trailing ? `\n${trailing}` : '')).trim();
      pendingAssistant = '';
      if (body) turns.push({ role: 'assistant', text: body });
    };

    for (const se of this.eventLog) {
      const wrapper = se.ev;
      if (wrapper.type !== 'event') continue;
      const ev = (wrapper as { type: 'event'; event: any }).event;
      if (!ev || typeof ev !== 'object') continue;

      if (ev.type === '_user_echo' && typeof ev.text === 'string') {
        flushAssistant();
        const trimmed = ev.text.trim();
        if (trimmed) turns.push({ role: 'user', text: trimmed });
        continue;
      }

      if (ev.type === 'stream_event' && ev.event && typeof ev.event === 'object') {
        const inner = ev.event as { type?: unknown; index?: unknown; delta?: any; content_block?: any };
        if (inner.type === 'message_start') {
          flushAssistant();
          continue;
        }
        if (inner.type === 'content_block_start' && typeof inner.index === 'number') {
          if (inner.content_block?.type === 'text') {
            openText.set(inner.index, '');
          } else if (inner.content_block?.type === 'tool_use') {
            const name = typeof inner.content_block.name === 'string' ? inner.content_block.name : 'tool';
            openTools.set(inner.index, { name, input: '' });
          }
          continue;
        }
        if (inner.type === 'content_block_delta' && typeof inner.index === 'number') {
          if (inner.delta?.type === 'text_delta' && typeof inner.delta.text === 'string') {
            if (openText.has(inner.index)) {
              openText.set(inner.index, (openText.get(inner.index) ?? '') + inner.delta.text);
            }
          } else if (
            inner.delta?.type === 'input_json_delta' &&
            typeof inner.delta.partial_json === 'string' &&
            openTools.has(inner.index)
          ) {
            const tool = openTools.get(inner.index);
            if (tool) tool.input += inner.delta.partial_json;
          }
          continue;
        }
        if (inner.type === 'content_block_stop' && typeof inner.index === 'number') {
          const text = openText.get(inner.index);
          if (text != null) {
            pendingAssistant += text ? `${text}\n` : '';
            openText.delete(inner.index);
            continue;
          }
          const tool = openTools.get(inner.index);
          if (tool) {
            pendingAssistant += `[tool ${tool.name}${tool.input ? `: ${recapSnippet(tool.input, 300)}` : ''}]\n`;
            openTools.delete(inner.index);
          }
        }
        continue;
      }

      if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
        for (const item of ev.message.content as Array<any>) {
          if (item?.type !== 'tool_result') continue;
          const content = recapSnippet(stringifyToolResultContent(item.content), 700);
          if (content) pendingAssistant += `[tool result: ${content}]\n`;
        }
      }
    }
    flushAssistant();

    const kept: Turn[] = [];
    let budget = 12_000;
    const perTurnOverhead = 48;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i];
      const cost = turn.text.length + perTurnOverhead;
      if (cost > budget) {
        const keepChars = Math.max(0, budget - perTurnOverhead);
        if (keepChars > 0) kept.unshift({ role: turn.role, text: turn.text.slice(-keepChars) });
        break;
      }
      budget -= cost;
      kept.unshift(turn);
    }

    if (kept.length === 0) return '';
    return [
      'Rivendell had to continue a Codex chat without a saved Codex thread id.',
      'The JSON array below contains visible prior turns plus summarized tool activity. Treat it as partial working memory, then answer the user message that follows.',
      JSON.stringify(kept, null, 2),
    ].join('\n');
  }

  async send(text: string, images?: ChatImage[], opts: { model?: unknown; effort?: unknown } = {}): Promise<void> {
    if (this.busy) {
      this.emit({
        type: 'error',
        message: 'codex is still answering — wait for the current turn to finish',
      });
      return;
    }
    const { model: codexModel, effort: codexEffort } = resolveCodexSelection(
      opts.model,
      opts.effort,
    );
    this.busy = true;
    this.cancellationEmitted = false;
    const recoverContextThisTurn = this.recoverContextOnNextTurn;
    const preTurnRecap = recoverContextThisTurn ? this.buildTranscriptRecap() : '';
    // Echo for reconnect replay (codex's events don't re-emit the user prompt).
    this.emit({
      type: 'event',
      event: { type: '_user_echo', text, imageCount: images?.length ?? 0, ts: Date.now() },
    });

    try {
      assertMemoryAvailableForSpawn('codex');
    } catch (error) {
      this.busy = false;
      this.emit({
        type: 'error',
        code: error instanceof MemoryPressureSpawnError ? error.code : undefined,
        retryable: true,
        message: (error as Error).message,
      });
      this.emit({ type: 'turnEnd', sessionId: this.threadId ?? undefined });
      return;
    }

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

    const effectiveText = preTurnRecap ? `${preTurnRecap}\n\n${text}` : text;
    if (preTurnRecap) {
      this.recoverContextOnNextTurn = false;
      this.emit({
        type: 'event',
        event: { type: '_context_recovered', chars: preTurnRecap.length, ts: Date.now() },
      });
    } else if (recoverContextThisTurn) {
      this.recoverContextOnNextTurn = false;
    }
    const prompt = `${CODEX_TURN_PREAMBLE}\n\n${effectiveText}`;
    // Selection was validated before the session became busy. effort is
    // interpolated into this config fragment, so only allow-listed strings
    // can reach the CLI.
    const codexReasoning = `model_reasoning_effort="${codexEffort}"`;
    // Matt's real Chrome, the same MCP server the claude lanes get. Passed as
    // -c overrides rather than written into ~/.codex/config.toml so this stays
    // scoped to Rivendell.
    const browserMcpEntry =
      process.env.RIVENDELL_BROWSER_MCP ||
      `${process.env.HOME || '/home/mrchevyceleb'}/samwise/Personal-Apps/rivendell-browser-bridge/bridge/mcp-server.mjs`;
    const browserMcpArgs = [
      '-c', 'mcp_servers.rivendell-browser.command="node"',
      '-c', `mcp_servers.rivendell-browser.args=["${browserMcpEntry}"]`,
    ];
    const args: string[] = this.threadId
      ? [
          'exec',
          'resume',
          '--json',
          '-m', codexModel,
          '-c', codexReasoning,
          ...browserMcpArgs,
          '--dangerously-bypass-approvals-and-sandbox',
          ...imageArgs,
          this.threadId,
          prompt,
        ]
      : [
          'exec',
          '--json',
          '-m', codexModel,
          '-c', codexReasoning,
          ...browserMcpArgs,
          '--dangerously-bypass-approvals-and-sandbox',
          ...imageArgs,
          prompt,
        ];

    // Wait for OneDrive to release its sync lock on .codex/config.toml so
    // codex's own read at startup doesn't fail with EDEADLK and kill the turn.
    const configProbe = await probeProjectConfig(this.cwd);
    if (!configProbe.ok) {
      cleanupImages();
      this.busy = false;
      this.emit({
        type: 'error',
        code: 'CODEX_PROJECT_CONFIG_LOCKED',
        retryable: true,
        message: configProbe.message,
      });
      this.emit({ type: 'turnEnd', sessionId: this.threadId ?? undefined });
      return;
    }
    if (this.dead) {
      cleanupImages();
      this.emitCancellationTurnEnd();
      return;
    }

    // Account-pinned lanes (chatId carries `__acct__<account>`) force that exact
    // login; everything else keeps the per-repo account-map resolution.
    const forcedAccount = accountFromChatId(this.chatId);
    const child = spawn(CODEX_BIN, args, {
      cwd: this.cwd,
      env: forcedAccount ? accountEnvForAccount(forcedAccount, this.cwd) : accountEnv(this.cwd),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.currentChild = child;

    // Synthesize a claude-shaped message_start so the reducer's turn handling
    // stays consistent across CLIs.
    const turnState: CodexTurnState = {
      messageId: synth('msg'),
      nextBlockIndex: 0,
      toolUseBlocks: new Map(),
      usage: null,
    };
    // Tracks whether this turn produced any model-visible progress so we can
    // surface a real error when Codex exits empty (the "thinking then nothing"
    // UX failure mode). Codex can return exit 1 with zero agent_message and
    // almost no stderr, which used to leave Rivendell with only a silent
    // error_during_execution result and no chat-visible reason.
    let producedAgentMessage = false;
    let sawTurnCompleted = false;
    const stderrChunks: string[] = [];
    let transientProjectConfigError: string | null = null;

    const rememberTransientProjectConfigError = (text: string) => {
      if (!isTransientFileProviderError(text) || !CODEX_PROJECT_CONFIG_ERROR.test(text)) return false;
      transientProjectConfigError =
        'OneDrive locked Codex project config while Codex was starting. ' +
        `Retry in a moment, or move ASSISTANT-HUB off OneDrive. Last error: ${text}`;
      this.emit({
        type: 'error',
        code: 'CODEX_PROJECT_CONFIG_LOCKED',
        retryable: true,
        message: transientProjectConfigError,
      });
      return true;
    };

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
          if (ev?.type === 'item.completed' && ev?.item?.type === 'agent_message') {
            producedAgentMessage = true;
          }
          if (ev?.type === 'turn.completed') {
            sawTurnCompleted = true;
          }
          this.handleCodexEvent(ev, turnState);
        } catch {
          // Non-JSON line — ignore.
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Codex stderr mixes real failures with structured internal tracing.
      // The common `write_stdin failed: stdin is closed` trace is Codex's own
      // recovery path after a non-TTY command, not a user-actionable chat
      // error, so keep it out of the transcript.
      for (const raw of chunk.split('\n')) {
        const text = raw.trim();
        if (!text) continue;
        if (isIgnorableCodexStderr(text)) continue;
        if (rememberTransientProjectConfigError(text)) continue;
        stderrChunks.push(text);
        this.emit({ type: 'error', message: text });
      }
    });

    child.on('exit', async (code) => {
      console.log(
        `[chat codex] child exit cwd=${this.cwd} code=${code} threadId=${this.threadId ?? '-'}`,
      );
      this.busy = false;
      this.currentChild = null;
      cleanupImages();
      // Intentional kill (shutdown driven by steer/stop): the WS register
      // layer is already binding a new session and emitting its own turnStart.
      // A result/turnEnd from this dying turn would race that and dirty the
      // transcript.
      if (this.intentionalKill) return;
      const stderrText = stderrChunks.join('\n').trim();
      if (code !== 0 && !transientProjectConfigError && rememberTransientProjectConfigError(stderrText)) {
        stderrChunks.length = 0;
      }
      this.closeDanglingToolBlocks(turnState, code, transientProjectConfigError ?? stderrText);
      // Surface empty / hard-fail turns. Codex sometimes starts a task and then
      // completes with last_agent_message=null + exit 1 and no useful stderr.
      // Without an explicit error event the UI just drops out of "thinking".
      const emptyTurn =
        !producedAgentMessage && !transientProjectConfigError && (code !== 0 || !sawTurnCompleted);
      if (emptyTurn) {
        const detail = stderrText
          ? stderrText.slice(0, 500)
          : `codex exit ${code ?? 'null'} with no agent message (thread ${this.threadId ?? 'new'})`;
        this.emit({
          type: 'error',
          message:
            code === 0
              ? `Codex finished without a reply. ${detail}`
              : `Codex failed before producing a reply. ${detail}`,
        });
      } else if (code !== 0 && !transientProjectConfigError && stderrText) {
        // Non-empty stderr already emitted line-by-line above; if filtering ate
        // everything, still leave a breadcrumb.
        if (stderrChunks.length === 0) {
          this.emit({
            type: 'error',
            message: `Codex exited ${code} without a delivered reply.`,
          });
        }
      }
      // Emit a result event so the front-end flips status back to 'ready'.
      // Forward codex's per-turn token usage (captured from `turn.completed`)
      // mapped to claude's field names so the same client-side meter works.
      this.emitClaudeEvent({
        type: 'result',
        subtype: code === 0 ? 'success' : 'error_during_execution',
        is_error: code !== 0,
        session_id: this.threadId ?? undefined,
        usage: turnState.usage ?? undefined,
      });
      if (emptyTurn && code !== 0) {
        // Drop poisoned thread ids after empty hard-fails so the next send
        // starts clean instead of resuming a corpse that keeps exiting 1.
        // Do not go through persistThreadId('') — that would leave this.threadId as ''.
        const deadThread = this.threadId;
        this.threadId = null;
        await setSessionId(this.cli, this.cwd, '', this.chatId);
        if (deadThread) {
          console.warn(
            `[chat codex] cleared poisoned thread ${deadThread} after empty exit ${code}`,
          );
        }
      } else if (this.threadId) {
        await this.persistThreadId(this.threadId);
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
    appendEventLog(this.key, se);
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
      void this.persistThreadId(ev.thread_id);
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

    // Capture per-turn token usage from `turn.completed` so the front-end
    // context meter has real numbers instead of leftover Claude figures.
    // Codex reports `input_tokens` (full prompt incl. cache) and
    // `cached_input_tokens` (cache hits) — map to claude's field names.
    if (ev.type === 'turn.completed' && ev.usage && typeof ev.usage === 'object') {
      const u = ev.usage as Record<string, number | undefined>;
      const input = Number(u.input_tokens ?? 0);
      const cached = Number(u.cached_input_tokens ?? 0);
      const output = Number(u.output_tokens ?? 0);
      const effectiveInput = cached > 0 && cached < input ? input - cached : input;
      state.usage = {
        // Codex reports huge cumulative cache-read counts. For the context
        // meter, show the effective fresh input instead of reconstructing the
        // full cache history and producing impossible multi-million totals.
        input_tokens: Math.max(0, effectiveInput),
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: output,
      };
      return;
    }

    // Other event types — ignore.
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

function keyOf(cli: CliKind, cwd: string, chatId = 'main'): string {
  const normalized = chatId || 'main';
  return normalized === 'main' ? `${cli}|${cwd}` : `${cli}|${cwd}|${normalized}`;
}

function latestThreadIdFromEvents(events: SeqEvent[]): string | null {
  let threadId: string | null = null;
  for (const se of events) {
    const ev = se.ev;
    if (ev.type === 'turnEnd' && typeof ev.sessionId === 'string') {
      threadId = ev.sessionId;
      continue;
    }
    if (ev.type !== 'event') continue;
    const inner = ev.event;
    if (!inner || typeof inner !== 'object') continue;
    if (inner.type === 'system' && inner.subtype === 'init' && typeof inner.session_id === 'string') {
      threadId = inner.session_id;
      continue;
    }
    if (inner.type === 'result' && typeof inner.session_id === 'string') {
      threadId = inner.session_id;
    }
  }
  return threadId;
}

/** Manager keyed by cwd + chat id, matching the claude session map. */
const codexSessions = new Map<string, CodexSession>();

export function activeCodexSessions(): {
  cli: CliKind;
  cwd: string;
  chatId: string;
  busy: boolean;
  sessionId: string | null;
  lastActivityAt: number;
}[] {
  return Array.from(codexSessions.values()).map((s) => ({
    cli: s.cli,
    cwd: s.cwd,
    chatId: s.chatId,
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
    // Idle reaper: no listeners, not busy, so we can fire-and-forget the
    // SIGTERM. We don't need to await the child exit here — there's no
    // racing resume to worry about.
    void session.shutdown();
    codexSessions.delete(key);
    pruned += 1;
  }
  return pruned;
}

export async function getOrCreateCodexSession(opts: {
  repoPath: string;
  chatId?: string;
  cli?: CliKind;
}): Promise<CodexSession> {
  const cwd = opts.repoPath;
  const chatId = opts.chatId || 'main';
  const cli = opts.cli ?? 'codex';
  const key = keyOf(cli, cwd, chatId);
  const existing = codexSessions.get(key);
  if (existing && existing.isAlive()) return existing;

  const threadId = (await getSessionId(cli, cwd, chatId)) ?? null;
  const session = new CodexSession(cwd, chatId, threadId, { cli });
  codexSessions.set(key, session);
  return session;
}

export function shutdownAllCodexSessions(): void {
  // Process-exit path: fire-and-forget the SIGTERM. Node will reap children
  // as the event loop drains.
  for (const s of codexSessions.values()) void s.shutdown();
  codexSessions.clear();
}

/** Kill the in-flight codex child and wait for it to fully exit before
 *  returning. Caller (steer/stop) needs the await so the next `codex exec
 *  resume` doesn't race the dying child's writes to the rollout JSONL. */
export async function interruptCodex(opts: { repoPath: string; chatId?: string; cli?: CliKind }): Promise<void> {
  const cwd = opts.repoPath;
  const key = keyOf(opts.cli ?? 'codex', cwd, opts.chatId || 'main');
  const s = codexSessions.get(key);
  if (s) {
    codexSessions.delete(key);
    await s.shutdown();
  }
}

/** Drop the stored thread id so the next codex spawn starts a fresh thread. */
export async function freshStartCodex(opts: {
  repoPath: string;
  chatId?: string;
  cli?: CliKind;
}): Promise<CodexSession> {
  const cwd = opts.repoPath;
  const chatId = opts.chatId || 'main';
  const cli = opts.cli ?? 'codex';
  const key = keyOf(cli, cwd, chatId);
  const existing = codexSessions.get(key);
  if (existing) {
    codexSessions.delete(key);
    await existing.shutdown();
  }
  await setSessionId(cli, cwd, '', chatId);
  // Wipe the durable log before the new session loads it, so a reset thread
  // can't be resurrected by a full (sinceSeq=0) replay from an empty client.
  await clearEventLog(key);
  const session = new CodexSession(cwd, chatId, null, { cli });
  codexSessions.set(key, session);
  return session;
}
