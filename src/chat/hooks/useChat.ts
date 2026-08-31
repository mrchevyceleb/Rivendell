import { useEffect, useRef, useState } from 'react';
import type { ChatBlock, ChatImagePreview, CompanionId, Repo } from '../data/types';
import { contextWindowForCodexModel } from '../codexModels';

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
const BANANA_WINDOW_TOKENS = 200_000; // banana default model context
const GROK_WINDOW_TOKENS = 500_000; // Grok 4.x context window

// Pick the starting context window for a given CLI before we've seen any model
// id. Codex uses the selected catalog entry; current Claude (Opus 4.6/4.7/4.8,
// Sonnet 4.6) is 1M; GLM 5.3/5.2 is 1M; xAI/Grok is 500K; banana/OpenRouter defaults to 200K.
function defaultWindowForCli(cli: CompanionId, model?: string): number {
  if (isCodexCli(cli)) return contextWindowForCodexModel(model);
  if (cli === 'banana' || cli === 'banana-local' || cli === 'banana-fireworks') return BANANA_WINDOW_TOKENS;
  // xAI always runs Grok (500K). Pin before system/init arrives so the meter
  // never flashes the 200K non-claude default.
  if (cli === 'xai') return GROK_WINDOW_TOKENS;
  return windowForClaudeModel(model); // Claude/Z.ai model ids carry the real window.
}

function contextWindowOverride(value: number | null | undefined): number | undefined {
  if (!Number.isFinite(value) || !value || value <= 0) return undefined;
  return Math.floor(value);
}

function windowForCli(cli: CompanionId, model: string | undefined, override?: number | null): number {
  return contextWindowOverride(override) ?? defaultWindowForCli(cli, model);
}

function isCodexCli(cli: CompanionId): boolean {
  return cli === 'codex';
}

function shouldReadResultUsage(cli: CompanionId): boolean {
  return isCodexCli(cli)
    || cli === 'banana'
    || cli === 'banana-local'
    || cli === 'banana-fireworks';
}

// Map a model id to its real context window. Current Opus (4.6/4.7/4.8),
// Sonnet 4.6, and Fable/Mythos 5 are all 1M; Haiku and older models are 200K;
// GLM 5.3 / 5.2 are 1M on Z.ai's coding API; GLM 5.1 stays 200K.
function windowForClaudeModel(model: string | undefined): number {
  if (!model) return LARGE_WINDOW_TOKENS;
  const m = model.toLowerCase();
  if (m.includes('[1m]') || m.includes('-1m')) return LARGE_WINDOW_TOKENS;
  if (m.includes('haiku')) return DEFAULT_WINDOW_TOKENS;
  if (m.includes('glm-5.3') || m.includes('glm-5.2')) return LARGE_WINDOW_TOKENS;
  if (m.includes('glm')) return DEFAULT_WINDOW_TOKENS;
  // Any Grok id (grok-4.5, grok-4-5, future grok-*) is 500K on xAI.
  if (m.includes('grok')) return GROK_WINDOW_TOKENS;
  if (m.includes('opus') || m.includes('sonnet') || m.includes('fable') || m.includes('mythos')) return LARGE_WINDOW_TOKENS;
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

  // Agent-to-agent delivery: a teammate's message landing in this thread.
  if (ev.type === 'peer_message' && typeof ev.text === 'string') {
    return [...blocks, {
      kind: 'peer',
      id: id(),
      from: typeof ev.from === 'string' ? ev.from : 'Teammate',
      fromRole: typeof ev.fromRole === 'string' ? ev.fromRole : undefined,
      text: ev.text,
      ts: typeof ev.ts === 'number' ? ev.ts : Date.now(),
    }];
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
    return blocks.flatMap((b) => {
      if (b.kind !== 'text' && b.kind !== 'tool') return b;
      if (b.cbIndex !== idx || b.turnId !== turnId) return b;
      if (b.kind === 'tool') {
        return [{ ...b, args: prettifyJson(b.args), open: false }];
      }
      return [{ ...b, open: false }];
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

  // Final `assistant` event. Backends that stream Anthropic-format deltas
  // (Anthropic, Z.ai) deliver text via content_block_delta above, so the
  // block is already full and this is a no-op. xAI's Anthropic-compatible
  // stream, however, emits message_start + content_block_start(thinking) and
  // then skips every content_block_delta, delivering the full text only in
  // this final assistant event. Without this fallback xAI replies render as a
  // blank bubble. Guard on "no text yet for this turn" so delta-backed
  // backends never double-render.
  if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
    const turnId = turnIdRef.current;
    const fullText = (ev.message.content as Array<any>)
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
    if (fullText) {
      const hasText = blocks.some((b) => b.kind === 'text' && b.turnId === turnId && b.text !== '');
      if (!hasText) {
        return [...blocks, { kind: 'text', id: id(), text: fullText, ts: Date.now(), turnId, cbIndex: -1, open: false }];
      }
    }
    return blocks;
  }

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

function isLegacyCompactionSummaryText(text: string): boolean {
  const lower = text.trimStart().toLowerCase();
  if (!lower.startsWith('<summary>')) return false;
  return (
    lower.includes('primary request and intent') ||
    lower.includes('key technical concepts') ||
    lower.includes('files and code sections') ||
    lower.includes('current work') ||
    lower.includes('pending tasks') ||
    lower.includes('optional next step')
  );
}

function conversationKey(cli: CompanionId, repoPath: string, chatId = 'main'): string {
  const normalized = chatId || 'main';
  return normalized === 'main'
    ? `${cli}|${repoPath}`
    : `${cli}|${repoPath}|${normalized}`;
}

/** Outbound turns waiting for a live `ready` socket. Module-level so a click
 *  to another agent (unmount) does not drop a message the user already sent —
 *  coming back to the thread flushes it. */
type QueuedOutbound = { text: string; images?: ChatSendImage[] };
const outboundQueue = new Map<string, QueuedOutbound[]>();

function enqueueOutbound(key: string, item: QueuedOutbound): void {
  const q = outboundQueue.get(key) ?? [];
  q.push(item);
  outboundQueue.set(key, q);
}

function shiftOutbound(key: string): QueuedOutbound | undefined {
  const q = outboundQueue.get(key);
  if (!q?.length) return undefined;
  const item = q.shift();
  if (!q.length) outboundQueue.delete(key);
  else outboundQueue.set(key, q);
  return item;
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
  return blocks
    .filter((block) => !(block.kind === 'text' && isLegacyCompactionSummaryText(block.text)))
    .slice(-200)
    .map((block) => {
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
  } catch (err) {
    // A transient write failure (quota, serialization) must NEVER destroy the
    // existing cache — deleting it strands the user with a permanently blank
    // chat (the server only replays events newer than the persisted seq). Keep
    // whatever was last stored; the server log is the durable backstop and a
    // reconnect with an empty cache rehydrates via a full replay.
    console.warn('[chat] persist failed, keeping prior cache:', (err as Error).message);
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
  const visibleBlocks = blocks.filter((block) => !(block.kind === 'text' && isLegacyCompactionSummaryText(block.text)));
  for (const block of visibleBlocks) {
    const blockMatch = /^b(\d+)$/.exec(block.id);
    if (blockMatch) maxSeen = Math.max(maxSeen, Number(blockMatch[1]));
    if ('turnId' in block && block.turnId) {
      const turnMatch = /^t(\d+)$/.exec(block.turnId);
      if (turnMatch) maxSeen = Math.max(maxSeen, Number(turnMatch[1]));
    }
  }
  if (maxSeen >= nextId) nextId = maxSeen + 1;

  const seen = new Set<string>();
  return visibleBlocks.map((block) => {
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

/** Sync restore so the first paint of a remounted thread already has the
 *  transcript (Grok unmounts the feed while blocks are empty; an effect-only
 *  restore would flash the empty state and leave scrollTop at 0). */
function initialStoredBlocks(
  enabled: boolean | undefined,
  repo: Repo | undefined,
  cli: CompanionId,
  chatId: string,
): ChatBlock[] {
  if (enabled === false || !repo) return [];
  return restoreBlocksWithUniqueIds(readStoredBlocks(cli, repo.path, chatId));
}

export function useChat(opts: {
  repo: Repo | undefined;
  cli: CompanionId;
  chatId?: string;
  enabled: boolean;
  initialMessage?: string | null;
  onInitialMessageSent?: () => void;
  /** Model id (Banana + Codex). Rides on every send/steer. */
  model?: string;
  /** Optional known context window for engines whose model id does not encode it. */
  contextWindowTokens?: number | null;
  /** Reasoning/thinking effort for engines that expose one. */
  effort?: string;
  /** Account-pinned login for this lane ('kim'), or undefined for the
   *  repo-resolved default. Rides inside the chatId so the server spawns the
   *  CLI under that account. Personal Claude/Codex lanes are gone. */
  account?: string;
}) {
  const {
    repo,
    cli,
    enabled,
    initialMessage,
    onInitialMessageSent,
    model,
    contextWindowTokens,
    effort,
  } = opts;
  // Encode the account into the chatId (same `__acct__` separator the server
  // parses in accountResolver.ts). Every WS message + storage key then keys off
  // this, so switching account rebinds to that account's own session.
  const baseChatId = opts.chatId ?? 'main';
  const chatId = opts.account ? `${baseChatId}__acct__${opts.account}` : baseChatId;
  // Mirror the model into a ref so the WS send path always reads the latest
  // pick without re-subscribing the connection effect on every change.
  const modelRef = useRef<string | undefined>(model);
  modelRef.current = model;
  const effortRef = useRef<string | undefined>(effort);
  effortRef.current = effort;
  const [blocks, setBlocks] = useState<ChatBlock[]>(() => initialStoredBlocks(enabled, repo, cli, chatId));
  // `chatId` already carries `__acct__<account>` when the lane is pinned.
  const restoreKey = enabled && repo ? conversationKey(cli, repo.path, chatId) : '';
  const restoreKeyRef = useRef(restoreKey);
  if (restoreKeyRef.current !== restoreKey) {
    restoreKeyRef.current = restoreKey;
    setBlocks(initialStoredBlocks(enabled, repo, cli, chatId));
  }
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
  const windowTokensRef = useRef<number>(windowForCli(cli, model, contextWindowTokens));
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const teardownRef = useRef(false);
  const connectionIdRef = useRef(0);
  /** Wall-clock of the last server message on the current socket. The stream
   *  watchdog uses it to detect a silently stalled turn, and the live "working"
   *  banner uses it to show "last token Ns ago". */
  const lastMessageAtRef = useRef<number>(Date.now());
  /** When the current turn started — drives the live elapsed timer. */
  const turnStartRef = useRef<number>(0);
  /** True while the CLI is compacting context (a quiet phase that would
   *  otherwise look like a hang). */
  const compactingRef = useRef<boolean>(false);
  const turnIdRef = useRef('');
  /** Set by the connection effect so the returned `reconnect()` can force a
   *  close-and-reopen even when auto-reconnect is mid-backoff. */
  const forceReconnectRef = useRef<() => void>(() => {});
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
  const flushOutboundRef = useRef<() => void>(() => {});
  const flushOutbound = () => {
    if (!repo) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const key = conversationKey(cli, repo.path, chatId);
    const item = shiftOutbound(key);
    if (!item) return;
    pendingSendRef.current = true;
    setError(null);
    turnStartRef.current = Date.now();
    lastMessageAtRef.current = Date.now();
    compactingRef.current = false;
    setStatus('streaming');
    ws.send(JSON.stringify({
      type: 'send',
      chatId,
      text: item.text,
      images: payloadImages(item.images),
      model: modelRef.current,
      effort: effortRef.current,
    }));
  };
  flushOutboundRef.current = flushOutbound;

  useEffect(() => {
    const nextWindow = windowForCli(cli, model, contextWindowTokens);
    windowTokensRef.current = nextWindow;
    setUsage((prev) => {
      if (!prev) return prev;
      const total = prev.inputTokens + prev.cacheReadTokens + prev.cacheCreateTokens;
      return {
        ...prev,
        windowTokens: nextWindow,
        fraction: Math.min(total / nextWindow, 1),
      };
    });
  }, [cli, model, contextWindowTokens]);

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
        ws.send(JSON.stringify({ type: 'send', chatId, text: initialMessage, model: modelRef.current, effort: effortRef.current }));
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
    // Reset the assumed context window to the selected model each time we
    // (re)connect. The system/init event will refine it for Claude.
    windowTokensRef.current = windowForCli(cli, modelRef.current, contextWindowTokens);
    setUsage(null);
    // Restore prior blocks from localStorage so a page reload doesn't wipe
    // the chat. Server replay then fills in events newer than what we have.
    const stored = restoreBlocksWithUniqueIds(readStoredBlocks(cli, repo.path, chatId));
    setBlocks(stored);
    turnIdRef.current = '';
    reconnectAttemptRef.current = 0;
    // Decide replay start from whether we actually have cached blocks, NOT from
    // the persisted seq alone. If the cache is empty (wiped, quota error, a
    // brand-new browser, or a different device), ask the server for a FULL
    // replay (sinceSeq=0 → every event, seq starts at 1) so the entire
    // conversation rehydrates from the durable event log. Trusting a stale
    // persisted seq here is exactly what stranded users with a blank chat.
    lastSeqRef.current = stored.length > 0 ? readStoredSeq(cli, repo.path, chatId) : 0;
    // Mark this conversation as restored so the persistence-write effect can
    // safely begin saving updates back to storage.
    restoredKeyRef.current = conversationKey(cli, repo.path, chatId);

    /** Strip handlers and close a socket so it can't fire onopen/onclose into
     *  the new connection's state. Used before replacing wsRef during a
     *  forced reconnect or a fall-through reconcile, where the prior socket
     *  may still be CONNECTING or CLOSING. */
    const detachSocket = (socket: WebSocket | null) => {
      if (!socket) return;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(); } catch {}
    };

    const connect = () => {
      if (!isCurrentConnection()) return;
      // Detach whatever is still parked in wsRef. A socket left CONNECTING or
      // CLOSING keeps its handlers: its onopen fires a duplicate hello and its
      // onclose schedules a competing reconnect. That is how one tab
      // accumulated dozens of live sockets, each re-helloing the same lane.
      if (wsRef.current) detachSocket(wsRef.current);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
      wsRef.current = ws;
      // Mid-turn reconnects must not flip 'streaming' → 'connecting' or the
      // thinking UI dies and a tool/think pause looks like a crashed line.
      const keepStreaming = statusRef.current === 'streaming' || pendingSendRef.current;
      if (!keepStreaming) setStatus('connecting');
      lastMessageAtRef.current = Date.now();

      ws.onopen = () => {
        if (!isCurrentConnection()) return;
        ws.send(JSON.stringify({
          type: 'hello',
          cli,
          repo: repo.path,
          chatId,
          sinceSeq: lastSeqRef.current,
          model: modelRef.current,
          effort: effortRef.current,
        }));
      };
      ws.onmessage = (e) => {
        if (!isCurrentConnection()) return;
        lastMessageAtRef.current = Date.now();
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
        if (msg.type === 'working') {
          // Transport keepalive while the engine is on a tool/think pause.
          // lastMessageAtRef was already bumped; nothing to render.
          return;
        }
        if (msg.type === 'ready') {
          // If the server says we attached to a busy session (Sam is mid-turn
          // because the user reconnected from a phone unlock or tab switch),
          // jump straight to 'streaming' so the UI shows tending instead of
          // looking idle while events stream in via replay.
          setError(null);
          reconnectAttemptRef.current = 0;
          // Send a pending first message (typed straight into the threshold)
          // the moment the server says ready. Keep it pending until turnStart
          // confirms the server accepted it, so startup reconnects do not lose
          // threshold-entered prompts.
          const pending = initialMessageRef.current;
          const queued = outboundQueue.get(conversationKey(cli, repo.path, chatId));
          if (pending && !initialSendInFlightRef.current && ws.readyState === WebSocket.OPEN) {
            setStatus(msg.busy ? 'streaming' : 'ready');
            initialSendInFlightRef.current = true;
            setBlocks((prev) => {
              const lastUser = [...prev].reverse().find((b) => b.kind === 'user');
              if (lastUser && lastUser.kind === 'user' && lastUser.text === pending) return prev;
              return [
                ...prev,
                { kind: 'user', id: id(), text: pending, ts: Date.now() },
              ];
            });
            ws.send(JSON.stringify({ type: 'send', chatId, text: pending, model: modelRef.current, effort: effortRef.current }));
          } else if (queued && queued.length > 0 && ws.readyState === WebSocket.OPEN) {
            setStatus('streaming');
            flushOutboundRef.current();
          } else {
            setStatus(msg.busy ? 'streaming' : 'ready');
            if (!msg.busy) {
              pendingSendRef.current = false;
              compactingRef.current = false;
            }
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
          turnStartRef.current = Date.now();
          compactingRef.current = false;
          setError(null);
          setStatus('streaming');
        }
        else if (msg.type === 'turnEnd') {
          pendingSendRef.current = false;
          compactingRef.current = false;
          const leftover = outboundQueue.get(conversationKey(cli, repo.path, chatId));
          if (leftover && leftover.length > 0) {
            flushOutboundRef.current();
          } else {
            setStatus('ready');
          }
        }
        else if (msg.type === 'compacted') {
          // Auto-compaction marker: the model's context rotated (juicy summary
          // banked to RAG). The visible thread lives on — just draw the line.
          setBlocks((prev) => {
            const id = `compact-${msg.seq}`;
            if (prev.some((b) => b.id === id)) return prev;
            return [...prev, {
              kind: 'compact',
              id,
              ts: msg.at ?? Date.now(),
              words: msg.words ?? 0,
              turns: msg.turns ?? 0,
              count: msg.count ?? 1,
              savedToRag: msg.savedToRag,
            } as ChatBlock];
          });
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
          // The CLI idle-closed (or exited mid-turn). Don't strand the user on
          // a dead-looking "asleep" banner — re-bind transparently, exactly
          // like samwise-2. bindSession replies with a fresh ready/streaming.
          pendingSendRef.current = false;
          setError(null);
          setStatus('closed');
          window.setTimeout(() => forceReconnectRef.current(), 250);
        }
        else if (msg.type === 'stream') {
          // Track compaction so the working banner can say "compacting context"
          // instead of looking hung. The claude CLI signals compaction START with
          // a system/status event (status:"compacting") and the END boundary with
          // system/compact_boundary. CRUCIAL: with --include-partial-messages the
          // CLI wraps real content under a `stream_event` envelope, so the content
          // type lives at event.event.type, NOT event.type. The old code checked
          // the top-level type, which is always 'stream_event' for content, so the
          // flag NEVER cleared and "compacting context" stuck for the whole turn.
          const ev = msg.event;
          const evType = ev?.type;
          const innerType = evType === 'stream_event' ? ev?.event?.type : evType;
          if (evType === 'system' && ev?.subtype === 'status' && ev?.status === 'compacting') {
            compactingRef.current = true;
          } else if (
            (evType === 'system' && ev?.subtype === 'compact_boundary') ||
            innerType === 'message_start' ||
            innerType === 'content_block_start' ||
            innerType === 'content_block_delta'
          ) {
            compactingRef.current = false;
          }
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
            // Prefer CLI-aware window (xai -> 500K) over bare model match so a
            // future grok id rename can't drop the meter back to 200K.
            windowTokensRef.current = windowForCli(cli, msg.event.model, contextWindowTokens);
          }
          // Power the context meter from per-API-call usage.
          //
          // Claude Code's `result.usage` is cumulative across every API
          // call in a turn — a turn that uses N tools makes N+1 calls and
          // cache_read_input_tokens gets summed N+1 times, inflating the
          // displayed total by roughly Nx. So for claude we track usage
          // from `assistant` events instead, where each event corresponds
          // to one API call and `message.usage` is that call's real input
          // size. Taking the most recent assistant event in a turn gives
          // us the true context size of the most recent call.
          //
          // Codex/Banana don't have this Claude cumulative-result bug:
          // Codex and Banana synthesize one result usage payload per turn.
          // Z.ai emits zeroes on assistant.message.usage but real per-call
          // numbers on the final message_delta, so read that instead.
          const messageDeltaUsage =
            cli === 'zai' &&
            msg.event?.type === 'stream_event' &&
            msg.event?.event?.type === 'message_delta' &&
            msg.event.event.usage
              ? (msg.event.event.usage as Record<string, number | undefined>)
              : null;
          const usagePayload =
            messageDeltaUsage ??
            (cli !== 'zai' &&
            !shouldReadResultUsage(cli) &&
            msg.event?.type === 'assistant' &&
            msg.event?.message?.usage
              ? (msg.event.message.usage as Record<string, number | undefined>)
              : shouldReadResultUsage(cli) &&
                  msg.event?.type === 'result' &&
                  msg.event?.usage
                ? (msg.event.usage as Record<string, number | undefined>)
                : null);

          if (usagePayload) {
            const input = usagePayload.input_tokens ?? 0;
            const cacheRead = usagePayload.cache_read_input_tokens ?? 0;
            const cacheCreate = usagePayload.cache_creation_input_tokens ?? 0;
            const output = usagePayload.output_tokens ?? 0;
            const total = input + cacheRead + cacheCreate;
            // Safety net (claude only): if observed usage exceeds the known
            // window, ratchet up to 1M. Covers the case where init didn't
            // carry a model id but the session is plainly running on the
            // large-context variant. Codex windows come from the model catalog,
            // so the meter clamps at 100% if reported usage somehow exceeds one.
            if (
              !isCodexCli(cli) &&
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
          // Claude Code writes this once per unknown model id per process.
          // xAI/Z.ai ids are off its registry by design; the turn still runs.
          if (typeof msg.message === 'string' && /^\s*\[claude-code:unrecognized_model\]/.test(msg.message)) {
            console.warn('[chat] ignored unrecognized_model warning');
            return;
          }
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
        // Only the socket currently owned by wsRef drives reconnects. An
        // orphan closing later must not open yet another connection.
        if (wsRef.current && wsRef.current !== ws) return;
        if (initialSendInFlightRef.current) initialSendInFlightRef.current = false;
        const keepStreaming =
          (statusRef.current === 'streaming' || pendingSendRef.current) &&
          reconnectAttemptRef.current < 3;
        if (!keepStreaming) {
          pendingSendRef.current = false;
          setStatus('closed');
        }
        const attempt = Math.min(reconnectAttemptRef.current, 3);
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        reconnectAttemptRef.current += 1;
        // Replace, never stack: overwriting the ref without clearing left the
        // previous timer live, so two connects raced and one socket leaked.
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        if (!isCurrentConnection()) return;
        // Browsers fire onerror on every abnormal close (process restart,
        // proxy blip). onclose already reconnects. A red pill here makes a
        // Grok tool/think pause look like a dead line.
        if (
          statusRef.current !== 'streaming' &&
          !pendingSendRef.current &&
          reconnectAttemptRef.current >= 3
        ) {
          setError('the line went quiet, reconnecting…');
        } else {
          console.warn('[chat] socket error; reconnecting');
        }
      };
    };

    // Backgrounded tabs get their WebSocket throttled or silently killed by
    // the browser, and the setTimeout-based reconnect can be deferred for
    // minutes. When the tab comes back we force a reconcile: if the socket
    // is still open, re-send hello so the server replays anything missed
    // via sinceSeq; otherwise reconnect immediately.
    const reconcileNow = () => {
      if (!isCurrentConnection()) return;
      const live = wsRef.current;
      // A CONNECTING handshake must not be killed on window focus (clicking
      // from another app back into Rivendell). That loop is how messages
      // never reached hello, so every agent looked dead.
      // CLOSING counts too: its onclose is about to run the reconnect, and
      // opening one here would leave the closing socket orphaned.
      if (
        live
        && (live.readyState === WebSocket.CONNECTING || live.readyState === WebSocket.CLOSING)
      ) return;
      if (live && live.readyState === WebSocket.OPEN) {
        try {
          live.send(JSON.stringify({
            type: 'hello',
            cli,
            repo: repo.path,
            chatId,
            sinceSeq: lastSeqRef.current,
            model: modelRef.current,
            effort: effortRef.current,
          }));
          return;
        } catch {
          // fall through to a forced reconnect below
        }
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;
      // Detach the stale socket so its pending onopen/onclose can't fire a
      // duplicate hello or schedule a competing reconnect timer alongside
      // the new connection we're about to open.
      detachSocket(wsRef.current);
      wsRef.current = null;
      connect();
    };
    // Restoring a window fires visibilitychange, focus and often pageshow in
    // the same tick, and each one used to send its own hello. Coalesce them.
    let reconcileTimer: number | null = null;
    const reconcile = () => {
      if (!isCurrentConnection()) return;
      if (reconcileTimer !== null) return;
      reconcileTimer = window.setTimeout(() => {
        reconcileTimer = null;
        reconcileNow();
      }, 150);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconcile();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', reconcile);
    window.addEventListener('online', reconcile);
    window.addEventListener('pageshow', reconcile);

    // Cross-browser-tab sync: when ANOTHER tab on the same conversation writes
    // newer state, adopt it here instead of letting this (possibly stale) tab
    // later overwrite the shared cache with older blocks. We key off the `:seq`
    // companion entry because writeStoredState writes blocks first, then seq —
    // so by the time seq fires, the blocks value is already current. Skip while
    // this tab has a turn in flight so we don't clobber a live stream.
    const seqStorageKey = blocksStorageKey(cli, repo.path, chatId) + ':seq';
    const onStorage = (e: StorageEvent) => {
      if (!isCurrentConnection()) return;
      if (e.key !== seqStorageKey || e.newValue == null) return;
      const incoming = Number(e.newValue);
      if (!Number.isFinite(incoming) || incoming <= lastSeqRef.current) return;
      if (statusRef.current === 'streaming' || pendingSendRef.current) return;
      const fresh = restoreBlocksWithUniqueIds(readStoredBlocks(cli, repo.path, chatId));
      setBlocks(fresh);
      lastSeqRef.current = incoming;
    };
    window.addEventListener('storage', onStorage);

    forceReconnectRef.current = () => {
      if (!isCurrentConnection()) return;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;
      // Same trap as reconcile: a CONNECTING/CLOSING socket whose handlers
      // are still attached will fire onopen/onclose against the new
      // connection's state. Detach handlers before replacing.
      detachSocket(wsRef.current);
      wsRef.current = null;
      connect();
    };

    // Stream watchdog: if a turn is streaming but the socket has been silent
    // for STREAM_SILENCE_MS, the connection is almost certainly stale (the
    // server already emitted turnEnd, it just never arrived). Force a fresh WS
    // so bindSession replies with a fresh ready{busy:false} (or replays the
    // missed turnEnd) and the "tending" dots clear instead of hanging forever.
    // 90s (not 45s): Grok/Claude tool calls, MCP, and thinking can sit quiet
    // well past 45s. Server `working` keepalives should refresh lastMessageAt
    // well before this; the extra room covers keepalive loss during compaction.
    const STREAM_SILENCE_MS = 90_000;
    const COMPACT_SILENCE_MS = 180_000;
    const WATCHDOG_TICK_MS = 5_000;
    const watchdog = window.setInterval(() => {
      if (!isCurrentConnection()) return;
      if (statusRef.current !== 'streaming') return;
      const silenceMs = compactingRef.current ? COMPACT_SILENCE_MS : STREAM_SILENCE_MS;
      if (Date.now() - lastMessageAtRef.current < silenceMs) return;
      // eslint-disable-next-line no-console
      console.warn(`[useChat] stream watchdog: silent ${silenceMs}ms, forcing reconnect`);
      lastMessageAtRef.current = Date.now();
      forceReconnectRef.current();
    }, WATCHDOG_TICK_MS);

    connect();

    return () => {
      teardownRef.current = true;
      forceReconnectRef.current = () => {};
      window.clearInterval(watchdog);
      if (reconcileTimer !== null) {
        clearTimeout(reconcileTimer);
        reconcileTimer = null;
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', reconcile);
      window.removeEventListener('online', reconcile);
      window.removeEventListener('pageshow', reconcile);
      window.removeEventListener('storage', onStorage);
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
    if (!repo) {
      setError('Sam is not on the line. Please wait a moment.');
      return;
    }
    setBlocks((prev) => [
      ...prev,
      { kind: 'user', id: id(), text, images: imagePreviews(images), imageCount: images?.length, ts: Date.now() },
    ]);
    const key = conversationKey(cli, repo.path, chatId);
    const inFlight = pendingSendRef.current || statusRef.current === 'streaming';
    enqueueOutbound(key, { text, images });
    pendingSendRef.current = true;
    setError(null);
    turnStartRef.current = Date.now();
    lastMessageAtRef.current = Date.now();
    compactingRef.current = false;
    setStatus('streaming');
    const ws = wsRef.current;
    if (
      !inFlight
      && ws
      && ws.readyState === WebSocket.OPEN
      && (statusRef.current === 'ready' || statusRef.current === 'closed')
    ) {
      // 'closed' means the engine idled out, not that the socket is gone: the
      // server respawns on demand. Waiting for a 'ready' that only arrives on
      // the next reconnect is how a typed message sat in the queue unsent.
      flushOutbound();
    }
  };

  const freshStart = () => {
    if (!repo) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('Sam is not on the line. Please wait a moment.');
      return;
    }
    ws.send(JSON.stringify({
      type: 'freshStart',
      cli,
      repo: repo.path,
      chatId,
      model: modelRef.current,
      effort: effortRef.current,
    }));
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
    const key = conversationKey(cli, repo.path, chatId);
    const waiting = (outboundQueue.get(key)?.length ?? 0) > 0
      || !ws
      || ws.readyState !== WebSocket.OPEN;
    if (waiting) {
      send(text, images);
      return;
    }
    setBlocks((prev) => [
      ...prev,
      { kind: 'user', id: id(), text, images: imagePreviews(images), imageCount: images?.length, ts: Date.now() },
    ]);
    pendingSendRef.current = true;
    setError(null);
    ws.send(JSON.stringify({ type: 'steer', cli, repo: repo.path, chatId, text, images: payloadImages(images), model: modelRef.current, effort: effortRef.current }));
    turnStartRef.current = Date.now();
    lastMessageAtRef.current = Date.now();
    compactingRef.current = false;
    setStatus('streaming');
  };

  const reconnect = () => forceReconnectRef.current();

  return {
    blocks, status, error, send, steer, freshStart, stop, reconnect, usage,
    lastActivityRef: lastMessageAtRef, turnStartRef, compactingRef,
  };
}
