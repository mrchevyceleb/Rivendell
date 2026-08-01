// Bridge to the Rivendell Hall chat pipeline: this is what gives Jarvis full
// parity with typed chat. One HallBrain per conversation, connected as a WS
// client of /api/ws with a `jarvis-*` chatId (which also triggers the server's
// voice-mode system prompt). The event parsing mirrors the useChat reducer
// exactly, including the stream_event unwrap and the xAI final-assistant
// fallback.

import WebSocket from 'ws';

export type BrainSettings = { cli: string; model?: string; effort?: string };

export type BrainEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'turnEnd' }
  | { kind: 'error'; message: string };

type QueueWaiter = (value: BrainEvent) => void;

const RECONNECT_DELAY_MS = 1500;
const HELLO_READY_TIMEOUT_MS = 20_000;

export class HallBrain {
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private readonly repo: string;
  readonly chatId: string;
  private settings: BrainSettings;

  private lastSeq = -1;
  private busy = false;
  private closed = false;
  private turnActive = false;
  private sawTextThisTurn = false;

  private queue: BrainEvent[] = [];
  private waiters: QueueWaiter[] = [];
  private readyResolvers: Array<(ok: boolean) => void> = [];
  private isReady = false;

  constructor(opts: { wsUrl: string; repo: string; chatId: string; settings: BrainSettings }) {
    this.wsUrl = opts.wsUrl;
    this.repo = opts.repo;
    this.chatId = opts.chatId;
    this.settings = opts.settings;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  updateSettings(next: Partial<BrainSettings>): void {
    this.settings = {
      cli: next.cli?.trim() || this.settings.cli,
      model: next.model?.trim() || this.settings.model,
      effort: next.effort?.trim() || this.settings.effort,
    };
  }

  get currentSettings(): BrainSettings {
    return { ...this.settings };
  }

  connect(): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    const readyPromise = new Promise<boolean>((resolve) => {
      this.readyResolvers.push(resolve);
      setTimeout(() => resolve(false), HELLO_READY_TIMEOUT_MS).unref();
    });
    this.openSocket();
    return readyPromise;
  }

  private openSocket(): void {
    if (this.closed) return;
    // Idempotent: a socket already connecting/open keeps its hello in flight;
    // opening a second one here would orphan the first mid-handshake.
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.sendJson({
        type: 'hello',
        cli: this.settings.cli,
        repo: this.repo,
        chatId: this.chatId,
        sinceSeq: this.lastSeq,
        model: this.settings.model,
        effort: this.settings.effort,
      });
    });

    ws.on('message', (raw) => this.onMessage(raw.toString()));

    ws.on('close', () => {
      if (this.closed) return;
      // Mid-turn drops reconnect with sinceSeq so the durable log replays what
      // we missed; idle drops just reconnect lazily on the next turn.
      this.isReady = false;
      if (this.turnActive) {
        setTimeout(() => this.openSocket(), RECONNECT_DELAY_MS).unref();
      }
    });

    ws.on('error', (err) => {
      console.warn(`[hallBrain ${this.chatId}] ws error:`, (err as Error).message);
    });
  }

  private sendJson(obj: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private emit(ev: BrainEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(ev);
    else this.queue.push(ev);
  }

  private nextEvent(): Promise<BrainEvent> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<BrainEvent>((resolve) => this.waiters.push(resolve));
  }

  private onMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg?.seq === 'number') this.lastSeq = Math.max(this.lastSeq, msg.seq);

    switch (msg?.type) {
      case 'ready': {
        this.isReady = true;
        this.busy = msg.busy === true;
        for (const resolve of this.readyResolvers.splice(0)) resolve(true);
        return;
      }
      case 'turnStart': {
        this.busy = true;
        return;
      }
      case 'turnEnd': {
        this.busy = false;
        if (this.turnActive) {
          this.turnActive = false;
          this.emit({ kind: 'turnEnd' });
        }
        return;
      }
      case 'error': {
        if (this.turnActive) {
          this.turnActive = false;
          this.busy = false;
          this.emit({ kind: 'error', message: String(msg.message ?? 'unknown error') });
        }
        return;
      }
      case 'sessionClosed': {
        if (this.turnActive) {
          this.turnActive = false;
          this.busy = false;
          this.emit({ kind: 'error', message: 'the session dropped mid-turn' });
        }
        return;
      }
      case 'stream': {
        if (this.turnActive) this.onStreamEvent(msg.event);
        return;
      }
      default:
        return;
    }
  }

  /** Mirrors src/chat/hooks/useChat.ts reduce(). */
  private onStreamEvent(ev: any): void {
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'stream_event' && ev.event) {
      this.onStreamEvent(ev.event);
      return;
    }
    if (ev.type === 'message_start') {
      this.sawTextThisTurn = false;
      return;
    }
    if (ev.type === 'content_block_start') {
      const cb = ev.content_block;
      if (cb?.type === 'tool_use' && typeof cb.name === 'string') {
        this.emit({ kind: 'tool', name: cb.name });
      }
      return;
    }
    if (ev.type === 'content_block_delta') {
      const delta = ev.delta;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
        this.sawTextThisTurn = true;
        this.emit({ kind: 'text', text: delta.text });
      }
      return;
    }
    // xAI's Anthropic-compatible stream skips deltas and delivers full text in
    // the final assistant event — same fallback the Hall UI uses.
    if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
      if (this.sawTextThisTurn) return;
      const fullText = (ev.message.content as any[])
        .filter((c) => c?.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('');
      if (fullText) {
        this.sawTextThisTurn = true;
        this.emit({ kind: 'text', text: fullText });
      }
    }
  }

  /**
   * Run one spoken turn: sends (or steers, when the brain is mid-work) and
   * yields BrainEvents until turnEnd. The generator's return (barge-in cancel)
   * leaves the underlying Hall turn running on purpose — the work continues,
   * the speech stops, and the transcript still lands in Hall.
   */
  async *runTurn(text: string): AsyncGenerator<BrainEvent> {
    if (this.closed) {
      yield { kind: 'error', message: 'brain connection closed' };
      return;
    }
    if (!this.isReady || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const ok = await this.connect();
      if (!ok) {
        yield { kind: 'error', message: 'could not reach the Rivendell brain' };
        return;
      }
    }

    // Fresh turn: drop any stale tail events from a cancelled prior turn.
    this.queue = [];
    this.turnActive = true;
    this.sawTextThisTurn = false;

    if (this.busy) {
      this.sendJson({
        type: 'steer',
        cli: this.settings.cli,
        repo: this.repo,
        chatId: this.chatId,
        text,
        model: this.settings.model,
        effort: this.settings.effort,
      });
    } else {
      this.sendJson({
        type: 'send',
        chatId: this.chatId,
        text,
        model: this.settings.model,
        effort: this.settings.effort,
      });
    }

    try {
      while (true) {
        const ev = await this.nextEvent();
        yield ev;
        if (ev.kind === 'turnEnd' || ev.kind === 'error') return;
      }
    } finally {
      this.turnActive = false;
    }
  }

  /** Hard-stop the current Hall turn (explicit "stop"/dismiss, not barge-in). */
  stopTurn(): void {
    this.sendJson({ type: 'stop', cli: this.settings.cli, repo: this.repo, chatId: this.chatId });
    this.busy = false;
  }

  close(): void {
    this.closed = true;
    this.turnActive = false;
    try {
      this.ws?.close();
    } catch {
      /* already closing */
    }
    this.ws = null;
  }
}
