import { execFileSync, spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import { ASSISTANT_HUB_PATH } from './config.ts';
import { getSessionId, setSessionId } from './sessions.ts';
import { CodexSession, getOrCreateCodexSession } from './codex-runner.ts';
import { BananaSession, getOrCreateBananaSession } from './banana-runner.ts';
import { appendEventLog, compactEventLog, loadEventLogSync } from './event-log-store.ts';
import { assertMemoryAvailableForSpawn, MemoryPressureSpawnError } from './memory.ts';
import { accountEnv } from '../lib/accountResolver.ts';
import { engineDefault } from '../lib/engineConfig.ts';

export { MemoryPressureSpawnError } from './memory.ts';

function terminateProcessTree(child: ChildProcessByStdio<Writable, Readable, Readable>, signal: NodeJS.Signals): void {
  const descendants = child.pid ? collectDescendantPids(child.pid) : [];
  try { child.kill(signal); } catch {}
  if (child.pid) {
    try { process.kill(-child.pid, signal); } catch {}
  }
  for (const pid of descendants.reverse()) {
    try { process.kill(pid, signal); } catch {}
  }
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

// One persistent `claude` process per (cli, repoPath) pair, fed JSON over
// stdin and reading JSONL events from stdout. This kills the per-turn startup
// tax of the previous spawn-per-message model and matches the architecture
// proven out in Banana IDE.
//
// Lessons borrowed from Banana IDE:
// - Persistent stdin/stdout stream-json so the model warms once.
// - Detect "silent resume failure": if init reports a session_id that doesn't
//   match the one we asked for, the CLI started a fresh session. Treat as a
//   resume failure, drop the stale id, and let the conversation continue from
//   the new one (don't spawn again — the user's message hasn't been sent yet).

export type CliKind = 'claude' | 'codex' | 'assistant' | 'banana';

export type StreamEvent = unknown;

type Listener = (msg: SessionEvent) => void;

export type SessionEvent =
  | { type: 'event'; event: any }       // raw stream-json event from claude
  | { type: 'turnStart' }
  | { type: 'turnEnd'; sessionId?: string }
  | { type: 'closed'; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'error'; message: string; code?: string; retryable?: boolean };

// Match `/<skill-name> <body>` at the very start of a user message. Skill names
// are kebab-case (lowercase letters, digits, hyphen). The body is anything that
// follows the first whitespace run after the skill name.
const SLASH_COMMAND_HEAD = /^\/([a-z][a-z0-9-]*)([ \t]+)([^\n][\s\S]*)$/;

/**
 * If `text` looks like `/<skill> <body>`, rewrite it to a form where the body
 * is wrapped in `<command-args>` so the model can't drop it when invoking the
 * Skill tool. Returns the original string when it doesn't match.
 *
 * Why this exists: in `--input-format=stream-json` mode claude doesn't
 * pre-expand slash commands, so `/sam Send Mario about X` arrives at the model
 * as a literal user message. The model occasionally invokes
 * `Skill({ skill: "sam" })` with no `args`, and the skill replies "you only
 * sent the slash command, no prompt." Wrapping the body in a structural tag
 * eliminates the ambiguity.
 */
export function wrapSlashArgs(text: string): string {
  if (!text) return text;
  const match = SLASH_COMMAND_HEAD.exec(text);
  if (!match) return text;
  const [, skill, , bodyRaw] = match;
  const body = bodyRaw.trim();
  if (!body) return text;
  return `/${skill}\n<command-args>\n${body}\n</command-args>`;
}

// Model + reasoning effort every `claude` spawn runs with. Single source of
// truth. Opus 4.7+ uses adaptive thinking and ignores MAX_THINKING_TOKENS; the
// live lever is the `--effort` flag (low|medium|high|xhigh|max). "max" is top.
const { model: CLAUDE_MODEL, effort: CLAUDE_EFFORT } = engineDefault('claude', 'claude-opus-4-8', 'xhigh');

const ASSISTANT_AGENT_PROMPT =
  "You are Elrond, a calm, exacting, helpful assistant. The user is Matt. " +
  "You're working inside ASSISTANT-HUB, which contains his task system, " +
  "client dashboards, and personal automation. Address him directly. Stay terse. " +
  "When you reference a workspace file or folder, use the form `ASSISTANT-HUB/relative/path` " +
  "rather than an absolute filesystem path. Matt accesses Rivendell from multiple " +
  "machines, so absolute Mac paths are useless to him on Windows or iPad. " +
  "For file search, use `rg` or `rg --files` with scoped paths and explicit exclusions. " +
  "Do not run broad recursive `grep` or `find` over `/Users/mjohnst`, `~/samwise`, " +
  "or ASSISTANT-HUB without excluding `node_modules`, `.git`, and generated output; " +
  "give the same constraint to any subagent you launch.";

// Each session keeps a rolling tail of recent events so a reconnecting client
// gets the in-flight turn's output even if its WS dropped mid-stream. Bigger
// is better here — claude emits ~30+ events per turn and the user might run a
// dozen turns before reconnecting; old events fall off the tail.
const EVENT_BUFFER_SIZE = 2000;

export type SeqEvent = { seq: number; ev: SessionEvent };

class ClaudeSession {
  readonly key: string;
  readonly cli: CliKind;
  readonly cwd: string;
  readonly chatId: string;
  private child: ChildProcessByStdio<Writable, Readable, Readable>;
  private stdoutBuf = '';
  private listeners = new Set<(e: SeqEvent) => void>();
  private subscriberCount = 0;
  /** Rolling tail of recent events (with sequence numbers) for reconnect replay. */
  private eventLog: SeqEvent[] = [];
  private nextSeq = 1;
  private lastActivityAtMs = Date.now();
  /** session_id we asked the CLI to resume (cleared once the init event arrives). */
  private pendingResumeId: string | null = null;
  /** session_id reported by the most recent init event. Persisted on every change. */
  private currentSessionId: string | null = null;
  private readonly startedResumeId: string | null = null;
  /** Model + effort this process was spawned with (per-session, defaults from config). */
  readonly spawnModel: string;
  readonly spawnEffort: string;
  private resumeFailed = false;
  private spawnError: string | null = null;
  private initSeen = false;
  private exitedBeforeInit = false;
  private startupWaiters = new Set<(state: 'initialized' | 'closed') => void>();
  /** Resolves true once init is received, false if the process exits before init. */
  readonly ready: Promise<boolean>;
  private resolveReady!: (ok: boolean) => void;

  constructor(cli: CliKind, cwd: string, chatId: string, resumeId: string | null, model?: string, effort?: string) {
    this.cli = cli;
    this.cwd = cwd;
    this.chatId = chatId;
    this.key = keyOf(cli, cwd, chatId);
    this.pendingResumeId = resumeId;
    this.startedResumeId = resumeId;
    this.spawnModel = model ?? CLAUDE_MODEL;
    this.spawnEffort = effort ?? CLAUDE_EFFORT;
    this.ready = new Promise<boolean>((res) => { this.resolveReady = res; });

    // Restore any prior emitted events from disk so a server restart (manual
    // kickstart, crash, Mac sleep) doesn't drop the conversation tail. The
    // in-memory eventLog is the source of truth during a process lifetime;
    // disk is the failover so reconnecting clients with a stale `sinceSeq`
    // can still replay everything past their last-seen seq.
    try {
      const restored = loadEventLogSync(this.key);
      if (restored.events.length > 0) {
        this.eventLog = restored.events;
        this.nextSeq = restored.nextSeq;
        console.log(
          `[chat ${cli}] restored ${restored.events.length} event(s) from disk for ${this.key} (nextSeq=${this.nextSeq})`,
        );
      }
    } catch (err) {
      console.warn(`[chat ${cli}] event-log restore failed for ${this.key}:`, (err as Error).message);
    }
    void compactEventLog(this.key);

    // Quiet-ready: the modern claude binary doesn't emit system/init until it
    // receives its first stdin message. Per Banana IDE: if the process is
    // alive after a short window and stderr is clean, treat it as ready so
    // the first send can go through. Init will fire later, after that send.
    setTimeout(() => {
      if (!this.initSeen && !this.exitedBeforeInit && !this.spawnError) {
        this.resolveReady(true);
      }
    }, 2000).unref();

    const args: string[] = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      '--model', this.spawnModel,
      '--effort', this.spawnEffort,
    ];
    if (resumeId) args.push('--resume', resumeId);
    if (cli === 'assistant') args.push('--append-system-prompt', ASSISTANT_AGENT_PROMPT);

    this.child = spawn('claude', args, {
      cwd,
      env: accountEnv(cwd),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessByStdio<Writable, Readable, Readable>;

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk));

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      // Surface stderr as a soft error event but don't kill the session — the
      // CLI prints harmless warnings here too.
      this.emit({ type: 'error', message: chunk.trim() });
    });

    this.child.on('exit', (code, signal) => {
      const idleMs = Date.now() - this.lastActivityAtMs;
      console.log(
        `[chat ${this.cli}] child exit cwd=${this.cwd} code=${code} signal=${signal ?? '-'} initSeen=${this.initSeen} idleMs=${idleMs}`,
      );
      if (!this.initSeen) {
        this.exitedBeforeInit = true;
        if (this.pendingResumeId) void setSessionId(this.cli, this.cwd, '', this.chatId);
        this.resolveReady(false);
        this.resolveStartupWaiters('closed');
      }
      this.emit({ type: 'closed', code, signal });
    });

    this.child.on('error', (err) => {
      this.spawnError = String(err?.message ?? err);
      if (!this.initSeen) {
        this.resolveReady(false);
        this.resolveStartupWaiters('closed');
      }
      this.emit({ type: 'error', message: this.spawnError });
    });
  }

  /**
   * Subscribe to live events. If `sinceSeq` is provided, immediately replays
   * any buffered events with seq > sinceSeq before returning. Pass 0 for
   * "give me everything in the buffer."
   */
  subscribe(fn: (e: SeqEvent) => void, sinceSeq = -1, countSubscriber = true): () => void {
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

  /** The latest sequence number (clients can send this on reconnect). */
  latestSeq(): number {
    return this.nextSeq - 1;
  }

  /** Most recent turn start (ms) — used for telegram-ping duration. */
  private turnStartedAt: number | null = null;

  /** Send a user message into the running CLI as one turn. */
  send(text: string, images?: Array<{ mediaType: string; base64: string }>): void {
    if (this.child.exitCode !== null) {
      this.emit({ type: 'error', message: 'session has exited' });
      return;
    }
    this.turnStartedAt = Date.now();
    // Echo the user message into our event log so reconnecting clients can
    // replay the full conversation, not just Sam's responses (claude doesn't
    // re-emit the user turn in its stream).
    this.emit({
      type: 'event',
      event: {
        type: '_user_echo',
        text,
        imageCount: images?.length ?? 0,
        ts: Date.now(),
      },
    });
    // The model occasionally drops the body when a user message is
    // `/<skill> <body>` and invokes the Skill tool with empty args. Wrap any
    // body in `<command-args>` so the args are structurally obvious before the
    // text reaches claude stdin. The UI echo above keeps the original visible.
    const stdinText = wrapSlashArgs(text);
    // Build claude's content array. Images come first so claude sees them
    // before the prompt.
    const content: Array<any> = [];
    if (images && images.length) {
      for (const img of images) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
        });
      }
    }
    if (stdinText) content.push({ type: 'text', text: stdinText });
    const payload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: content.length === 1 && content[0].type === 'text' && !images?.length
          ? stdinText
          : content,
      },
    });
    try {
      this.child.stdin.write(payload + '\n');
    } catch (e) {
      this.emit({ type: 'error', message: `stdin write failed: ${(e as Error).message}` });
    }
  }

  /** Tear down the underlying process. */
  shutdown(reason = 'unspecified'): void {
    const idleMs = Date.now() - this.lastActivityAtMs;
    console.warn(
      `[chat ${this.cli}] shutdown key=${this.key} pid=${this.child.pid ?? '-'} initSeen=${this.initSeen} listeners=${this.subscriberCount} idleMs=${idleMs} reason=${reason}`,
    );
    try { this.child.stdin.end(); } catch {}
    terminateProcessTree(this.child, 'SIGTERM');
    setTimeout(() => {
      if (this.child.exitCode === null) terminateProcessTree(this.child, 'SIGKILL');
    }, 3000).unref();
  }

  /** Same as shutdown, but framed for the user's "stop" button — keeps the
   *  saved session_id so the next message resumes the conversation. */
  interrupt(reason = 'interrupt'): void {
    this.emit({ type: 'event', event: { type: '_interrupted', ts: Date.now() } });
    this.shutdown(reason);
  }

  isAlive(): boolean {
    return this.child.exitCode === null && !this.spawnError;
  }

  hasResumeFailed(): boolean {
    return this.resumeFailed;
  }

  /** True while this session is actively processing a turn (between user send and result event). */
  isBusy(): boolean {
    return this.turnStartedAt !== null;
  }

  sessionId(): string | null {
    return this.currentSessionId ?? this.pendingResumeId;
  }

  startedWithResume(): boolean {
    return Boolean(this.startedResumeId);
  }

  waitForInitOrExit(timeoutMs: number): Promise<'initialized' | 'closed' | 'timeout'> {
    if (this.initSeen) return Promise.resolve('initialized');
    if (this.exitedBeforeInit || this.child.exitCode !== null || this.spawnError) {
      return Promise.resolve('closed');
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (state: 'initialized' | 'closed' | 'timeout') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.startupWaiters.delete(waiter);
        resolve(state);
      };
      const waiter = (state: 'initialized' | 'closed') => finish(state);
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      timer.unref?.();
      this.startupWaiters.add(waiter);
    });
  }

  listenerCount(): number {
    return this.subscriberCount;
  }

  /** Most recent activity timestamp (ms). */
  lastActivityAt(): number {
    return this.lastActivityAtMs;
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

  private resolveStartupWaiters(state: 'initialized' | 'closed'): void {
    const waiters = Array.from(this.startupWaiters);
    this.startupWaiters.clear();
    for (const fn of waiters) fn(state);
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    let nl = this.stdoutBuf.indexOf('\n');
    while (nl !== -1) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      nl = this.stdoutBuf.indexOf('\n');
      if (!line) continue;
      let ev: any;
      try { ev = JSON.parse(line); }
      catch { continue; }
      this.handleEvent(ev);
    }
  }

  private handleEvent(ev: any): void {
    // Detect init + silent-resume-failure.
    if (ev?.type === 'system' && ev.subtype === 'init' && typeof ev.session_id === 'string') {
      const pending = this.pendingResumeId;
      this.pendingResumeId = null;
      this.initSeen = true;
      this.resolveReady(true);
      this.resolveStartupWaiters('initialized');
      if (pending && pending !== ev.session_id) {
        this.resumeFailed = true;
        this.emit({
          type: 'error',
          message: `Resume failed (session ${pending.slice(0, 8)}… not found). Started a fresh thread.`,
        });
      }
      this.currentSessionId = ev.session_id;
      void setSessionId(this.cli, this.cwd, ev.session_id, this.chatId);
    }

    // Track session_id from any event that carries it (some events carry it
    // as well as init; persisting on every change keeps us safe across forks).
    if (ev && typeof ev === 'object' && typeof ev.session_id === 'string'
        && ev.session_id !== this.currentSessionId) {
      this.currentSessionId = ev.session_id;
      void setSessionId(this.cli, this.cwd, ev.session_id, this.chatId);
    }

    this.emit({ type: 'event', event: ev });

    // turn end = `result` event from the CLI
    if (ev?.type === 'result') {
      this.emit({ type: 'turnEnd', sessionId: this.currentSessionId ?? undefined });
      this.turnStartedAt = null;
    }
  }
}

// ── Session manager ────────────────────────────────────────────────

const sessions = new Map<string, ClaudeSession>();

function keyOf(cli: CliKind, cwd: string, chatId = 'main'): string {
  const normalized = chatId || 'main';
  return normalized === 'main' ? `${cli}|${cwd}` : `${cli}|${cwd}|${normalized}`;
}

// Returned by getOrCreateSession — common interface across all runners.
export type AnySession = ClaudeSession | CodexSession | BananaSession;

export async function getOrCreateSession(opts: {
  cli: CliKind;
  repoPath: string;
  chatId?: string;
  model?: string;
  effort?: string;
}): Promise<AnySession> {
  const chatId = opts.chatId || 'main';
  if (opts.cli === 'codex') {
    return getOrCreateCodexSession({ repoPath: opts.repoPath, chatId });
  }
  if (opts.cli === 'banana') {
    return getOrCreateBananaSession({ repoPath: opts.repoPath, chatId });
  }
  const cwd = opts.cli === 'assistant' ? ASSISTANT_HUB_PATH : opts.repoPath;
  const key = keyOf(opts.cli, cwd, chatId);

  while (true) {
    const existing = sessions.get(key);
    if (!existing) break;
    if (!existing.isAlive()) {
      if (sessions.get(key) === existing) sessions.delete(key);
      continue;
    }

    const ok = await existing.ready;
    if (sessions.get(key) !== existing) continue;
    if (ok && existing.isAlive()) {
      // Recycle if the requested model/effort differs from what this process
      // spawned with. session_id is preserved in storage, so the new process
      // resumes the same conversation — just with different spawn args.
      const wantModel = opts.model ?? CLAUDE_MODEL;
      const wantEffort = opts.effort ?? CLAUDE_EFFORT;
      if (existing.spawnModel === wantModel && existing.spawnEffort === wantEffort) return existing;
      existing.shutdown('model/effort change');
      sessions.delete(key);
      continue;
    }
    sessions.delete(key);
  }

  const resumeId = (await getSessionId(opts.cli, cwd, chatId)) ?? null;
  const session = await spawnSession(opts.cli, cwd, chatId, resumeId, key, 0, opts.model, opts.effort);
  return session;
}

async function spawnSession(
  cli: CliKind,
  cwd: string,
  chatId: string,
  resumeId: string | null,
  key: string,
  attempt = 0,
  model?: string,
  effort?: string,
): Promise<ClaudeSession> {
  assertMemoryAvailableForSpawn(cli);
  const session = new ClaudeSession(cli, cwd, chatId, resumeId, model, effort);
  sessions.set(key, session);

  session.subscribe((se) => {
    if (se.ev.type === 'closed' && sessions.get(key) === session) {
      sessions.delete(key);
    }
  }, -1, false);

  const ok = await session.ready;
  if (!ok) {
    sessions.delete(key);
    // Recover from a stale persisted session id: drop it and retry without
    // --resume. Only one retry — if even a fresh spawn dies before init,
    // something else is wrong.
    if (resumeId && attempt === 0) {
      await setSessionId(cli, cwd, '', chatId); // clear the bad id
      return spawnSession(cli, cwd, chatId, null, key, attempt + 1, model, effort);
    }
    throw new Error('claude exited before initializing — check the CLI install or auth');
  }
  return session;
}

export function shutdownAllSessions(): void {
  console.warn(`[chat] shutdownAllSessions called (${sessions.size} session(s))`);
  for (const s of sessions.values()) s.shutdown('shutdownAllSessions');
  sessions.clear();
}

export type LiveSession = {
  cli: CliKind;
  cwd: string;
  chatId: string;
  busy: boolean;
  sessionId: string | null;
  /** ms since epoch of the most recent event (or spawn time if no events yet). */
  lastActivityAt: number;
};

export function activeClaudeSessions(): LiveSession[] {
  const out: LiveSession[] = [];
  for (const s of sessions.values()) {
    out.push({
      cli: s.cli,
      cwd: s.cwd,
      chatId: s.chatId,
      busy: s.isBusy(),
      sessionId: s.sessionId(),
      lastActivityAt: s.lastActivityAt(),
    });
  }
  return out;
}

export function pruneIdleClaudeSessions(ttlMs: number, now = Date.now()): number {
  let pruned = 0;
  for (const [key, session] of sessions) {
    if (session.isBusy()) continue;
    if (session.listenerCount() > 0) continue;
    if (now - session.lastActivityAt() < ttlMs) continue;
    session.shutdown('idle-prune');
    sessions.delete(key);
    pruned += 1;
  }
  return pruned;
}

// Drop the warm process AND the stored session id so the next spawn starts a
// fresh thread. Picks up any `claude update` you've run since the process
// last spawned.
export async function freshStart(opts: { cli: CliKind; repoPath: string; chatId?: string }): Promise<AnySession> {
  const chatId = opts.chatId || 'main';
  if (opts.cli === 'codex') {
    const { freshStartCodex } = await import('./codex-runner.ts');
    return freshStartCodex({ repoPath: opts.repoPath, chatId });
  }
  if (opts.cli === 'banana') {
    const { freshStartBanana } = await import('./banana-runner.ts');
    return freshStartBanana({ repoPath: opts.repoPath, chatId });
  }
  const cwd = opts.cli === 'assistant' ? ASSISTANT_HUB_PATH : opts.repoPath;
  const key = keyOf(opts.cli, cwd, chatId);
  const existing = sessions.get(key);
  if (existing) {
    existing.shutdown('freshStart');
    sessions.delete(key);
  }
  await setSessionId(opts.cli, cwd, '', chatId); // drop the stored id so we don't --resume
  return spawnSession(opts.cli, cwd, chatId, null, key);
}

export function dropSession(cli: CliKind, repoPath: string, chatId = 'main'): void {
  const cwd = cli === 'assistant' ? ASSISTANT_HUB_PATH : repoPath;
  const key = keyOf(cli, cwd, chatId);
  const s = sessions.get(key);
  if (s) {
    s.shutdown('dropSession');
    sessions.delete(key);
  }
}

/** Interrupt the in-flight turn for this (cli, repo) pair. Preserves the
 *  saved session_id so the next message resumes the conversation. */
export async function interruptSession(opts: { cli: CliKind; repoPath: string; chatId?: string }): Promise<void> {
  const chatId = opts.chatId || 'main';
  if (opts.cli === 'codex') {
    const { interruptCodex } = await import('./codex-runner.ts');
    await interruptCodex({ repoPath: opts.repoPath, chatId });
    return;
  }
  if (opts.cli === 'banana') {
    const { interruptBanana } = await import('./banana-runner.ts');
    interruptBanana({ repoPath: opts.repoPath, chatId });
    return;
  }
  const cwd = opts.cli === 'assistant' ? ASSISTANT_HUB_PATH : opts.repoPath;
  const key = keyOf(opts.cli, cwd, chatId);
  const s = sessions.get(key);
  if (s) {
    s.interrupt('interruptSession');
    sessions.delete(key);
  }
}

// Re-export so callers can ignore the manager and use the class type.
export { ClaudeSession };

// Convenience for index.ts: stable ids per WebSocket subscription.
export function newSubscriberId(): string {
  return randomUUID();
}
