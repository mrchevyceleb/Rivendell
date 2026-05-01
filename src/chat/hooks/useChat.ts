import { useEffect, useRef, useState } from 'react';
import type { ChatBlock, CompanionId, Repo } from '../data/types';

type Status = 'idle' | 'connecting' | 'ready' | 'streaming' | 'closed' | 'error';

export type ContextUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  outputTokens: number;
  /** How full the context window is, 0..1. */
  fraction: number;
  /** Window size in tokens (claude default). */
  windowTokens: number;
};

const DEFAULT_WINDOW_TOKENS = 200_000;

let nextId = 1;
const id = () => `b${nextId++}`;

// Pure reducer — all per-turn state lives on the blocks themselves
// (turnId + cbIndex). This keeps it safe under React Strict Mode, which
// invokes reducers twice for purity-checking.
function reduce(blocks: ChatBlock[], ev: any, turnIdRef: { current: string }): ChatBlock[] {
  if (!ev || typeof ev !== 'object') return blocks;

  if (ev.type === 'stream_event' && ev.event) {
    return reduce(blocks, ev.event, turnIdRef);
  }

  // Server-injected echo of the user's prompt — keeps the user's message in
  // the visible thread when a client reconnects and replays the buffer.
  if (ev.type === '_user_echo' && typeof ev.text === 'string') {
    // Dedupe: if the optimistic local user block was already added by send(),
    // don't double up.
    const lastUser = [...blocks].reverse().find((b) => b.kind === 'user');
    if (lastUser && lastUser.kind === 'user' && lastUser.text === ev.text) {
      return blocks;
    }
    const ts = typeof ev.ts === 'number' ? ev.ts : Date.now();
    return [...blocks, { kind: 'user', id: id(), text: ev.text, ts }];
  }

  if (ev.type === 'message_start') {
    // New assistant turn. Mint a fresh turnId; close out any open blocks from
    // a prior turn so their cbIndex correlation can no longer match.
    turnIdRef.current = `t${nextId++}`;
    return blocks.map((b) =>
      b.kind === 'user' ? b : 'open' in b && b.open ? { ...b, open: false } : b,
    );
  }

  if (ev.type === 'content_block_start') {
    const idx: number = ev.index;
    const cb = ev.content_block;
    const turnId = turnIdRef.current;
    if (cb?.type === 'text') {
      const block: ChatBlock = {
        kind: 'text', id: id(), text: '', ts: Date.now(),
        turnId, cbIndex: idx, open: true,
      };
      return [...blocks, block];
    }
    if (cb?.type === 'tool_use') {
      const block: ChatBlock = {
        kind: 'tool', id: id(),
        toolUseId: cb.id, tool: cb.name, args: '',
        running: true, ts: Date.now(),
        turnId, cbIndex: idx, open: true,
      };
      return [...blocks, block];
    }
    return blocks;
  }

  if (ev.type === 'content_block_delta') {
    const idx: number = ev.index;
    const turnId = turnIdRef.current;
    const delta = ev.delta;
    return blocks.map((b) => {
      if (b.kind === 'user') return b;
      if (!('cbIndex' in b) || b.cbIndex !== idx || b.turnId !== turnId || !b.open) return b;
      if (delta?.type === 'text_delta' && b.kind === 'text' && typeof delta.text === 'string') {
        return { ...b, text: b.text + delta.text };
      }
      if (delta?.type === 'input_json_delta' && b.kind === 'tool' && typeof delta.partial_json === 'string') {
        return { ...b, args: b.args + delta.partial_json };
      }
      return b;
    });
  }

  if (ev.type === 'content_block_stop') {
    const idx: number = ev.index;
    const turnId = turnIdRef.current;
    return blocks.map((b) => {
      if (b.kind === 'user') return b;
      if (!('cbIndex' in b) || b.cbIndex !== idx || b.turnId !== turnId) return b;
      if (b.kind === 'tool') {
        return { ...b, args: prettifyJson(b.args), open: false };
      }
      return { ...b, open: false };
    });
  }

  // Tool result: claude emits a `user` message containing tool_result content.
  if (ev.type === 'user' && ev.message?.content) {
    let next = blocks;
    for (const c of ev.message.content as Array<any>) {
      if (c?.type === 'tool_result') {
        const summary = stringifyResult(c.content);
        next = next.map((b) =>
          b.kind === 'tool' && b.toolUseId === c.tool_use_id
            ? { ...b, result: summary, running: false }
            : b,
        );
      }
    }
    return next;
  }

  // Final `assistant` event: with content_block_* coverage above we already
  // have everything. Skip.

  return blocks;
}

function prettifyJson(raw: string): string {
  if (!raw) return '';
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const entries = Object.entries(obj as Record<string, unknown>);
      if (entries.length === 0) return '';
      return entries
        .slice(0, 3)
        .map(([k, v]) => {
          const s = typeof v === 'string' ? v : JSON.stringify(v);
          return `${k}=${s.length > 60 ? s.slice(0, 60) + '…' : s}`;
        })
        .join(' ');
    }
    return raw;
  } catch {
    return raw.length > 60 ? raw.slice(0, 60) + '…' : raw;
  }
}

function stringifyResult(content: unknown): string {
  if (typeof content === 'string') return summarize(content);
  if (Array.isArray(content)) {
    const text = content
      .map((c: any) => (c?.type === 'text' ? c.text : ''))
      .filter(Boolean)
      .join(' ');
    return summarize(text);
  }
  return '';
}

function summarize(s: string): string {
  const trimmed = s.trim();
  const firstLine = trimmed.split('\n')[0];
  if (trimmed.length <= 80) return trimmed;
  return `${firstLine.slice(0, 80)}…`;
}

function blocksStorageKey(cli: CompanionId, repoPath: string): string {
  return `rivendell:chat-blocks:${cli}|${repoPath}`;
}

function readStoredBlocks(cli: CompanionId, repoPath: string): ChatBlock[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(blocksStorageKey(cli, repoPath));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ChatBlock[];
  } catch {}
  return [];
}

function writeStoredBlocks(cli: CompanionId, repoPath: string, blocks: ChatBlock[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Cap stored blocks so localStorage doesn't grow unbounded.
    const tail = blocks.slice(-200);
    localStorage.setItem(blocksStorageKey(cli, repoPath), JSON.stringify(tail));
  } catch {}
}

function readStoredSeq(cli: CompanionId, repoPath: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(blocksStorageKey(cli, repoPath) + ':seq');
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  return 0;
}

function writeStoredSeq(cli: CompanionId, repoPath: string, seq: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(blocksStorageKey(cli, repoPath) + ':seq', String(seq));
  } catch {}
}

export function useChat(opts: {
  repo: Repo | undefined;
  cli: CompanionId;
  enabled: boolean;
  initialMessage?: string | null;
  onInitialMessageSent?: () => void;
}) {
  const { repo, cli, enabled, initialMessage, onInitialMessageSent } = opts;
  const [blocks, setBlocks] = useState<ChatBlock[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const teardownRef = useRef(false);
  const turnIdRef = useRef('');
  // Mirror the initial message into a ref so the WS onmessage handler can
  // read the latest value without re-subscribing every render.
  const initialMessageRef = useRef<string | null>(initialMessage ?? null);
  const initialSendInFlightRef = useRef(false);
  const onInitialMessageSentRef = useRef(onInitialMessageSent);
  onInitialMessageSentRef.current = onInitialMessageSent;
  /** Latest event seq received from server. Sent on reconnect for replay. */
  const lastSeqRef = useRef(-1);
  /** Key (`${cli}|${repoPath}`) of the conversation we've already restored from
   *  storage. Writes are gated on this so we don't wipe a saved chat with the
   *  empty initial state on the first render after repos load. */
  const restoredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialMessage) {
      initialMessageRef.current = initialMessage;
      initialSendInFlightRef.current = false;
    } else if (!initialSendInFlightRef.current) {
      initialMessageRef.current = null;
    }
  }, [initialMessage]);

  // Save to localStorage whenever blocks change, so a refresh restores them.
  // CRITICAL: skip until the read-and-restore effect below has run for the
  // current (cli, repo) — otherwise the first render after repos resolve
  // writes blocks=[] over saved history before we get a chance to load it.
  useEffect(() => {
    if (!repo) return;
    const key = `${cli}|${repo.path}`;
    if (restoredKeyRef.current !== key) return;
    writeStoredBlocks(cli, repo.path, blocks);
    writeStoredSeq(cli, repo.path, lastSeqRef.current);
  }, [blocks, repo?.path, cli]);

  useEffect(() => {
    if (!enabled || !repo) return;

    teardownRef.current = false;
    // Restore prior blocks from localStorage so a page reload doesn't wipe
    // the chat. Server replay then fills in events newer than what we have.
    const stored = readStoredBlocks(cli, repo.path);
    setBlocks(stored);
    turnIdRef.current = '';
    reconnectAttemptRef.current = 0;
    // Sequence we've already seen (persisted) — replay only what's newer.
    lastSeqRef.current = readStoredSeq(cli, repo.path);
    // Mark this conversation as restored so the persistence-write effect can
    // safely begin saving updates back to storage.
    restoredKeyRef.current = `${cli}|${repo.path}`;

    const connect = () => {
      if (teardownRef.current) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
      wsRef.current = ws;
      setStatus('connecting');
      setError(null);

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        ws.send(JSON.stringify({
          type: 'hello',
          cli,
          repo: repo.path,
          sinceSeq: lastSeqRef.current,
        }));
      };
      ws.onmessage = (e) => {
        let msg: any;
        try { msg = JSON.parse(String(e.data)); }
        catch { return; }
        // Track every server event's sequence so reconnect can resume.
        if (typeof msg.seq === 'number' && msg.seq > lastSeqRef.current) {
          lastSeqRef.current = msg.seq;
        }
        if (typeof msg.latestSeq === 'number' && msg.latestSeq > lastSeqRef.current) {
          lastSeqRef.current = msg.latestSeq;
        }
        if (msg.type === 'ready') {
          // If the server says we attached to a busy session (Sam is mid-turn
          // because the user reconnected from a phone unlock or tab switch),
          // jump straight to 'streaming' so the UI shows tending instead of
          // looking idle while events stream in via replay.
          setStatus(msg.busy ? 'streaming' : 'ready');
          // Send a pending first message (typed straight into the threshold)
          // the moment the server says ready. Keep it pending until turnStart
          // confirms the server accepted it, so startup reconnects do not lose
          // threshold-entered prompts.
          const pending = initialMessageRef.current;
          if (pending && !initialSendInFlightRef.current && ws.readyState === WebSocket.OPEN) {
            initialSendInFlightRef.current = true;
            setBlocks((prev) => {
              const lastUser = [...prev].reverse().find((b) => b.kind === 'user');
              if (lastUser && lastUser.kind === 'user' && lastUser.text === pending) return prev;
              return [
                ...prev,
                { kind: 'user', id: id(), text: pending, ts: Date.now() },
              ];
            });
            ws.send(JSON.stringify({ type: 'send', text: pending }));
          }
        }
        else if (msg.type === 'sessionRebound') {
          lastSeqRef.current = 0;
          setError(null);
        }
        else if (msg.type === 'turnStart') {
          if (initialSendInFlightRef.current) {
            initialSendInFlightRef.current = false;
            initialMessageRef.current = null;
            onInitialMessageSentRef.current?.();
          }
          setError(null);
          setStatus('streaming');
        }
        else if (msg.type === 'turnEnd') setStatus('ready');
        else if (msg.type === 'freshStarted') {
          setBlocks([]);
          setUsage(null);
          setError(null);
          setStatus('ready');
          turnIdRef.current = '';
          lastSeqRef.current = 0;
          if (repo) {
            writeStoredBlocks(cli, repo.path, []);
            writeStoredSeq(cli, repo.path, 0);
          }
        }
        else if (msg.type === 'sessionClosed') {
          setError('This warm session is asleep. Send a message to wake it.');
          setStatus('closed');
        }
        else if (msg.type === 'stream') {
          setBlocks((prev) => reduce(prev, msg.event, turnIdRef));
          // Track usage from claude's `result` events to power the context meter.
          if (msg.event?.type === 'result' && msg.event?.usage) {
            const u = msg.event.usage as Record<string, number | undefined>;
            const input = u.input_tokens ?? 0;
            const cacheRead = u.cache_read_input_tokens ?? 0;
            const cacheCreate = u.cache_creation_input_tokens ?? 0;
            const output = u.output_tokens ?? 0;
            const total = input + cacheRead + cacheCreate;
            setUsage({
              inputTokens: input,
              cacheReadTokens: cacheRead,
              cacheCreateTokens: cacheCreate,
              outputTokens: output,
              fraction: Math.min(total / DEFAULT_WINDOW_TOKENS, 1),
              windowTokens: DEFAULT_WINDOW_TOKENS,
            });
          }
        }
        else if (msg.type === 'error') setError(msg.message);
      };
      ws.onclose = () => {
        if (teardownRef.current) return;
        if (initialSendInFlightRef.current) initialSendInFlightRef.current = false;
        setStatus('closed');
        const attempt = Math.min(reconnectAttemptRef.current, 3);
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        setError('the line went quiet, reconnecting…');
      };
    };

    connect();

    return () => {
      teardownRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, repo?.path, cli]);

  const send = (
    text: string,
    images?: Array<{ mediaType: string; base64: string }>,
  ) => {
    const ws = wsRef.current;
    setBlocks((prev) => [
      ...prev,
      { kind: 'user', id: id(), text, ts: Date.now() },
    ]);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('Sam is not on the line. Please wait a moment.');
      return;
    }
    setError(null);
    ws.send(JSON.stringify({ type: 'send', text, images }));
  };

  const freshStart = () => {
    if (!repo) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('Sam is not on the line. Please wait a moment.');
      return;
    }
    ws.send(JSON.stringify({ type: 'freshStart', cli, repo: repo.path }));
  };

  const stop = () => {
    if (!repo) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'stop', cli, repo: repo.path }));
  };

  /** Stop the current turn and immediately fire a new prompt. The model sees
   *  it as a fresh turn that resumes the saved session_id, so the
   *  conversation continues but Sam stops doing whatever he was doing. */
  const steer = (
    text: string,
    images?: Array<{ mediaType: string; base64: string }>,
  ) => {
    if (!repo) return;
    const ws = wsRef.current;
    setBlocks((prev) => [
      ...prev,
      { kind: 'user', id: id(), text, ts: Date.now() },
    ]);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('Sam is not on the line. Please wait a moment.');
      return;
    }
    setError(null);
    ws.send(JSON.stringify({ type: 'steer', cli, repo: repo.path, text, images }));
  };

  return { blocks, status, error, send, steer, freshStart, stop, usage };
}
