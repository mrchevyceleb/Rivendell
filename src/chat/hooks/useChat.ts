import { useEffect, useRef, useState } from 'react';
import type { ChatBlock, ChatImagePreview, CompanionId, Repo } from '../data/types';

type Status = 'idle' | 'connecting' | 'ready' | 'streaming' | 'closed' | 'error';
type ChatSendImage = { mediaType: string; base64: string; previewDataUrl?: string };

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
const LARGE_WINDOW_TOKENS = 1_000_000;
const CODEX_WINDOW_TOKENS = 400_000; // GPT-5 family default

// Pick the starting context window for a given CLI before we've seen any
// model id from a system/init event. Codex's GPT-5 family is 400K; Claude
// defaults to 200K and ratchets to 1M when the model id reveals the [1m] beta.
function defaultWindowForCli(cli: CompanionId): number {
  return cli === 'codex' ? CODEX_WINDOW_TOKENS : DEFAULT_WINDOW_TOKENS;
}

// Map a claude model id to its real context window. Opus 4.7 with the `[1m]`
// beta suffix is 1M; everything else is the 200K default.
function windowForClaudeModel(model: string | undefined): number {
  if (!model) return DEFAULT_WINDOW_TOKENS;
  const m = model.toLowerCase();
  if (m.includes('[1m]') || m.includes('-1m')) return LARGE_WINDOW_TOKENS;
  return DEFAULT_WINDOW_TOKENS;
}

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
    const imageCount = typeof ev.imageCount === 'number' && ev.imageCount > 0 ? ev.imageCount : undefined;
    return [...blocks, { kind: 'user', id: id(), text: ev.text, imageCount, ts }];
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
      if (b.kind !== 'text' && b.kind !== 'tool') return b;
      if (b.cbIndex !== idx || b.turnId !== turnId || !b.open) return b;
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
      if (b.kind !== 'text' && b.kind !== 'tool') return b;
      if (b.cbIndex !== idx || b.turnId !== turnId) return b;
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

function conversationKey(cli: CompanionId, repoPath: string, chatId = 'main'): string {
  const normalized = chatId || 'main';
  return normalized === 'main'
    ? `${cli}|${repoPath}`
    : `${cli}|${repoPath}|${normalized}`;
}

function blocksStorageKey(cli: CompanionId, repoPath: string, chatId = 'main'): string {
  return `rivendell:chat-blocks:${conversationKey(cli, repoPath, chatId)}`;
}

function readStoredBlocks(cli: CompanionId, repoPath: string, chatId = 'main'): ChatBlock[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(blocksStorageKey(cli, repoPath, chatId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ChatBlock[];
  } catch {}
  return [];
}

function blocksForStorage(blocks: ChatBlock[]): ChatBlock[] {
  return blocks.slice(-200).map((block) => {
    if (block.kind !== 'user' || !block.images?.length) return block;
    const { images: _images, ...rest } = block;
    return { ...rest, imageCount: block.imageCount ?? block.images.length };
  });
}

function writeStoredState(cli: CompanionId, repoPath: string, chatId: string, blocks: ChatBlock[], seq: number): void {
  if (typeof window === 'undefined') return;
  const key = blocksStorageKey(cli, repoPath, chatId);
  try {
    localStorage.setItem(key, JSON.stringify(blocksForStorage(blocks)));
    localStorage.setItem(`${key}:seq`, String(seq));
  } catch {
    try {
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}:seq`);
    } catch {}
  }
}

function readStoredSeq(cli: CompanionId, repoPath: string, chatId = 'main'): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(blocksStorageKey(cli, repoPath, chatId) + ':seq');
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  return 0;
}

function restoreBlocksWithUniqueIds(blocks: ChatBlock[]): ChatBlock[] {
  let maxSeen = 0;
  for (const block of blocks) {
    const blockMatch = /^b(\d+)$/.exec(block.id);
    if (blockMatch) maxSeen = Math.max(maxSeen, Number(blockMatch[1]));
    if ('turnId' in block && block.turnId) {
      const turnMatch = /^t(\d+)$/.exec(block.turnId);
      if (turnMatch) maxSeen = Math.max(maxSeen, Number(turnMatch[1]));
    }
  }
  if (maxSeen >= nextId) nextId = maxSeen + 1;

  const seen = new Set<string>();
  return blocks.map((block) => {
    if (!seen.has(block.id)) {
      seen.add(block.id);
      return block;
    }
    let nextBlockId = id();
    while (seen.has(nextBlockId)) nextBlockId = id();
    seen.add(nextBlockId);
    return { ...block, id: nextBlockId };
  });
}

function imagePreviews(images: ChatSendImage[] | undefined): ChatImagePreview[] | undefined {
  if (!images?.length) return undefined;
  const previews = images
    .map((image) => image.previewDataUrl ? { mediaType: image.mediaType, dataUrl: image.previewDataUrl } : null)
    .filter((image): image is ChatImagePreview => Boolean(image));
  return previews.length ? previews : undefined;
}

function payloadImages(images: ChatSendImage[] | undefined): Array<{ mediaType: string; base64: string }> | undefined {
  if (!images?.length) return undefined;
  return images.map((image) => ({ mediaType: image.mediaType, base64: image.base64 }));
}

export function useChat(opts: {
  repo: Repo | undefined;
  cli: CompanionId;
  chatId?: string;
  enabled: boolean;
  initialMessage?: string | null;
  onInitialMessageSent?: () => void;
}) {
  const { repo, cli, chatId = 'main', enabled, initialMessage, onInitialMessageSent } = opts;
  const [blocks, setBlocks] = useState<ChatBlock[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  // Mirror status into a ref so WS handlers can read the latest value
  // without depending on render closure (used by error-suppression logic).
  const statusRef = useRef<Status>('idle');
  statusRef.current = status;
  /** True between a user send/steer and the next turnStart/turnEnd/error.
   *  Lets us surface errors that happen during the brief window after
   *  send() before the server flips us to 'streaming' (e.g. respawn
   *  failures after an idle CLI close). */
  const pendingSendRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  // Window size for the active CLI. Seeded from the per-CLI default and
  // refined by the `system/init` event (claude) or by the safety ratchet
  // when observed usage exceeds the assumed window.
  const windowTokensRef = useRef<number>(defaultWindowForCli(cli));
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const teardownRef = useRef(false);
  const connectionIdRef = useRef(0);
  const turnIdRef = useRef('');
  // Mirror the initial message into a ref so the WS onmessage handler can
  // read the latest value without re-subscribing every render.
  const initialMessageRef = useRef<string | null>(initialMessage ?? null);
  const initialSendInFlightRef = useRef(false);
  const onInitialMessageSentRef = useRef(onInitialMessageSent);
  onInitialMessageSentRef.current = onInitialMessageSent;
  /** Latest event seq received from server. Sent on reconnect for replay. */
  const lastSeqRef = useRef(-1);
  /** Key (`${cli}|${repoPath}|${chatId}`) of the conversation we've already restored from
   *  storage. Writes are gated on this so we don't wipe a saved chat with the
   *  empty initial state on the first render after repos load. */
  const restoredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialMessage) {
      initialMessageRef.current = initialMessage;
      initialSendInFlightRef.current = false;

      // The send-on-`ready` path inside ws.onmessage only fires once per
      // connection. When the user clicks an EmptyChat suggestion AFTER the
      // WS already said `ready`, that handler never re-runs, so we'd sit
      // forever with a pending message and no send. Fire it here instead.
      const ws = wsRef.current;
      if (
        ws &&
        ws.readyState === WebSocket.OPEN &&
        (status === 'ready' || status === 'idle')
      ) {
        initialSendInFlightRef.current = true;
        setBlocks((prev) => {
          const lastUser = [...prev].reverse().find((b) => b.kind === 'user');
          if (lastUser && lastUser.kind === 'user' && lastUser.text === initialMessage) return prev;
          return [
            ...prev,
            { kind: 'user', id: id(), text: initialMessage, ts: Date.now() },
          ];
        });
        ws.send(JSON.stringify({ type: 'send', chatId, text: initialMessage }));
      }
    } else if (!initialSendInFlightRef.current) {
      initialMessageRef.current = null;
    }
  }, [chatId, initialMessage, status]);

  // Save to localStorage whenever blocks change, so a refresh restores them.
  // CRITICAL: skip until the read-and-restore effect below has run for the
  // current (cli, repo) — otherwise the first render after repos resolve
  // writes blocks=[] over saved history before we get a chance to load it.
  useEffect(() => {
    if (!repo) return;
    const key = conversationKey(cli, repo.path, chatId);
    if (restoredKeyRef.current !== key) return;
    writeStoredState(cli, repo.path, chatId, blocks, lastSeqRef.current);
  }, [blocks, repo?.path, cli, chatId]);

  useEffect(() => {
    if (!enabled || !repo) return;

    teardownRef.current = false;
    const connectionId = ++connectionIdRef.current;
    const isCurrentConnection = () => connectionIdRef.current === connectionId && !teardownRef.current;
    // Reset the assumed context window to the per-CLI default each time we
    // (re)connect. The system/init event will refine it for claude; codex
    // sticks at 400K unless usage forces a ratchet.
    windowTokensRef.current = defaultWindowForCli(cli);
    setUsage(null);
    // Restore prior blocks from localStorage so a page reload doesn't wipe
    // the chat. Server replay then fills in events newer than what we have.
    const stored = restoreBlocksWithUniqueIds(readStoredBlocks(cli, repo.path, chatId));
    setBlocks(stored);
    turnIdRef.current = '';
    reconnectAttemptRef.current = 0;
    // Sequence we've already seen (persisted) — replay only what's newer.
    lastSeqRef.current = readStoredSeq(cli, repo.path, chatId);
    // Mark this conversation as restored so the persistence-write effect can
    // safely begin saving updates back to storage.
    restoredKeyRef.current = conversationKey(cli, repo.path, chatId);

    const connect = () => {
      if (!isCurrentConnection()) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
      wsRef.current = ws;
      setStatus('connecting');
      setError(null);

      ws.onopen = () => {
        if (!isCurrentConnection()) return;
        reconnectAttemptRef.current = 0;
        ws.send(JSON.stringify({
          type: 'hello',
          cli,
          repo: repo.path,
          chatId,
          sinceSeq: lastSeqRef.current,
        }));
      };
      ws.onmessage = (e) => {
        if (!isCurrentConnection()) return;
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
            ws.send(JSON.stringify({ type: 'send', chatId, text: pending }));
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
          pendingSendRef.current = false;
          setError(null);
          setStatus('streaming');
        }
        else if (msg.type === 'turnEnd') {
          pendingSendRef.current = false;
          setStatus('ready');
        }
        else if (msg.type === 'freshStarted') {
          setBlocks([]);
          setUsage(null);
          setError(null);
          setStatus('ready');
          turnIdRef.current = '';
          lastSeqRef.current = 0;
          if (repo) {
            writeStoredState(cli, repo.path, chatId, [], 0);
          }
        }
        else if (msg.type === 'sessionClosed') {
          setError('This warm session is asleep. Send a message to wake it.');
          setStatus('closed');
        }
        else if (msg.type === 'stream') {
          setBlocks((prev) => reduce(prev, msg.event, turnIdRef));
          // Pick up the model id from claude's system/init event so the
          // context meter knows which window to divide against. Opus 4.7
          // with the `[1m]` suffix is 1M; defaults stay at 200K.
          if (
            cli !== 'codex' &&
            msg.event?.type === 'system' &&
            msg.event?.subtype === 'init' &&
            typeof msg.event?.model === 'string'
          ) {
            windowTokensRef.current = windowForClaudeModel(msg.event.model);
          }
          // Track usage from claude's `result` events to power the context meter.
          if (msg.event?.type === 'result' && msg.event?.usage) {
            const u = msg.event.usage as Record<string, number | undefined>;
            const input = u.input_tokens ?? 0;
            const cacheRead = u.cache_read_input_tokens ?? 0;
            const cacheCreate = u.cache_creation_input_tokens ?? 0;
            const output = u.output_tokens ?? 0;
            const total = input + cacheRead + cacheCreate;
            // Safety net (claude only): if observed usage exceeds the known
            // window, ratchet up to 1M. Covers the case where init didn't
            // carry a model id but the session is plainly running on the
            // large-context variant. Codex has no 1M variant — the meter just
            // clamps at 100% if usage somehow exceeds its 400K window.
            if (
              cli !== 'codex' &&
              total > windowTokensRef.current &&
              windowTokensRef.current < LARGE_WINDOW_TOKENS
            ) {
              windowTokensRef.current = LARGE_WINDOW_TOKENS;
            }
            const windowTokens = windowTokensRef.current;
            setUsage({
              inputTokens: input,
              cacheReadTokens: cacheRead,
              cacheCreateTokens: cacheCreate,
              outputTokens: output,
              fraction: Math.min(total / windowTokens, 1),
              windowTokens,
            });
          }
        }
        else if (msg.type === 'error') {
          // Surface errors when a turn is in flight OR when the user just
          // sent and we're still waiting on the server to flip to
          // 'streaming' (covers respawn failures after an idle CLI close).
          // Otherwise it's idle CLI chatter and the server has already
          // filtered the worst of it; just log.
          const inFlight =
            statusRef.current === 'streaming' ||
            statusRef.current === 'connecting' ||
            pendingSendRef.current;
          if (inFlight) {
            pendingSendRef.current = false;
            setError(msg.message);
          } else {
            console.warn('[chat] suppressed idle error:', msg.message);
          }
        }
      };
      ws.onclose = () => {
        if (!isCurrentConnection()) return;
        if (initialSendInFlightRef.current) initialSendInFlightRef.current = false;
        pendingSendRef.current = false;
        setStatus('closed');
        const attempt = Math.min(reconnectAttemptRef.current, 3);
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        if (!isCurrentConnection()) return;
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
  }, [enabled, repo?.path, cli, chatId]);

  const send = (
    text: string,
    images?: ChatSendImage[],
  ) => {
    const ws = wsRef.current;
    setBlocks((prev) => [
      ...prev,
      { kind: 'user', id: id(), text, images: imagePreviews(images), imageCount: images?.length, ts: Date.now() },
    ]);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('Sam is not on the line. Please wait a moment.');
      return;
    }
    pendingSendRef.current = true;
    setError(null);
    ws.send(JSON.stringify({ type: 'send', chatId, text, images: payloadImages(images) }));
  };

  const freshStart = () => {
    if (!repo) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('Sam is not on the line. Please wait a moment.');
      return;
    }
    ws.send(JSON.stringify({ type: 'freshStart', cli, repo: repo.path, chatId }));
  };

  const stop = () => {
    if (!repo) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'stop', cli, repo: repo.path, chatId }));
  };

  /** Stop the current turn and immediately fire a new prompt. The model sees
   *  it as a fresh turn that resumes the saved session_id, so the
   *  conversation continues but Sam stops doing whatever he was doing. */
  const steer = (
    text: string,
    images?: ChatSendImage[],
  ) => {
    if (!repo) return;
    const ws = wsRef.current;
    setBlocks((prev) => [
      ...prev,
      { kind: 'user', id: id(), text, images: imagePreviews(images), imageCount: images?.length, ts: Date.now() },
    ]);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('Sam is not on the line. Please wait a moment.');
      return;
    }
    pendingSendRef.current = true;
    setError(null);
    ws.send(JSON.stringify({ type: 'steer', cli, repo: repo.path, chatId, text, images: payloadImages(images) }));
  };

  return { blocks, status, error, send, steer, freshStart, stop, usage };
}
