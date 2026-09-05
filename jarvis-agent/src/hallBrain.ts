// Speech bridge to Rivendell's normal Hall chat pipeline. A named call uses the
// teammate's real bot-* chatId and repository, so speech is only I/O around the
// same engine, tools, memory, durable event log, and provider session as typing.

import WebSocket from 'ws';

export type BrainSettings = { cli: string; model?: string; effort?: string };

export type BrainEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'turnEnd' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

type QueueWaiter = (value: BrainEvent) => void;
type VoiceAttempt = {
  id: string;
  text: string;
  submitted: boolean;
  admitted: boolean;
  serverOwns: boolean;
  kind?: 'send' | 'steer';
};

const RECONNECT_DELAY_MS = 1500;
const HELLO_READY_TIMEOUT_MS = 20_000;

export class HallBrain {
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private readonly repo: string;
  readonly chatId: string;
  private settings: BrainSettings;

  private lastSeq = -1;
  private serverBusy = false;
  private activeCli: string | null = null;
  private closed = false;
  /** True only while LiveKit is consuming events for the latest utterance. */
  private turnActive = false;
  /** The active server turn was admitted from this voice call, not typed chat. */
  private voiceOwnsBusyTurn = false;
  private sawTextThisMessage = false;
  private currentAttempt: VoiceAttempt | null = null;
  private nextClientMessage = 0;
  private readonly threadVoice: boolean;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private queue: BrainEvent[] = [];
  private waiters: QueueWaiter[] = [];
  private readyResolvers: Array<(ok: boolean) => void> = [];
  private isReady = false;

  constructor(opts: { wsUrl: string; repo: string; chatId: string; settings: BrainSettings; threadVoice?: boolean }) {
    this.wsUrl = opts.wsUrl;
    this.repo = opts.repo;
    this.chatId = opts.chatId;
    this.settings = opts.settings;
    this.threadVoice = opts.threadVoice === true;
  }

  get isBusy(): boolean {
    return this.serverBusy;
  }

  get exactSpokenTranscript(): boolean {
    return this.threadVoice;
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
    if (this.isReady && this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(true);
    const readyPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const index = this.readyResolvers.indexOf(finish);
        if (index >= 0) this.readyResolvers.splice(index, 1);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), HELLO_READY_TIMEOUT_MS);
      timer.unref();
      this.readyResolvers.push(finish);
    });
    this.openSocket();
    return readyPromise;
  }

  private openSocket(): void {
    if (this.closed) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws || this.closed) return;
      ws.send(JSON.stringify({
        type: 'hello',
        cli: this.settings.cli,
        repo: this.repo,
        chatId: this.chatId,
        sinceSeq: this.lastSeq,
        model: this.settings.model,
        effort: this.settings.effort,
      }));
    });
    ws.on('message', (raw) => {
      if (this.ws === ws && !this.closed) this.onMessage(raw.toString());
    });
    ws.on('close', () => {
      if (this.ws !== ws || this.closed) return;
      this.ws = null;
      this.isReady = false;
      if (this.turnActive || this.currentAttempt || this.serverBusy) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.openSocket();
        }, RECONNECT_DELAY_MS);
        this.reconnectTimer.unref();
      }
    });
    ws.on('error', (err) => {
      console.warn(`[hallBrain ${this.chatId}] ws error:`, (err as Error).message);
    });
  }

  private async rebindSelectedEngine(): Promise<void> {
    if (this.closed) return;
    this.isReady = false;
    this.activeCli = null;
    const old = this.ws;
    this.ws = null;
    try { old?.close(); } catch { /* already closed */ }
    await this.connect();
  }

  private sendJson(obj: object): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isReady) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  private emit(ev: BrainEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(ev);
    else this.queue.push(ev);
  }

  private nextEvent(signal?: AbortSignal): Promise<BrainEvent> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (signal?.aborted) return Promise.resolve({ kind: 'cancelled' });
    return new Promise<BrainEvent>((resolve) => {
      const finish = (event: BrainEvent) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(event);
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(finish);
        if (index >= 0) this.waiters.splice(index, 1);
        finish({ kind: 'cancelled' });
      };
      this.waiters.push(finish);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private completeCurrentAttempt(): void {
    this.currentAttempt = null;
    this.voiceOwnsBusyTurn = false;
    if (!this.turnActive) return;
    this.turnActive = false;
    this.emit({ kind: 'turnEnd' });
  }

  private failCurrentAttempt(message: string, busy = false): void {
    this.currentAttempt = null;
    this.serverBusy = busy;
    if (!this.turnActive) return;
    this.turnActive = false;
    this.emit({ kind: 'error', message });
  }

  /** Submit or idempotently retry the current utterance. External typed work is
   * never absorbed: an unsubmitted attempt waits for that turn to end first. */
  private submitCurrentAttempt(): void {
    const attempt = this.currentAttempt;
    if (!attempt || attempt.admitted || !this.isReady) return;
    if (this.serverBusy && !this.voiceOwnsBusyTurn && !attempt.submitted) return;

    const kind = attempt.kind ?? (this.serverBusy && this.voiceOwnsBusyTurn ? 'steer' : 'send');
    attempt.kind = kind;
    const payload = {
      type: kind,
      cli: this.settings.cli,
      repo: this.repo,
      chatId: this.chatId,
      text: attempt.text,
      clientMsgId: attempt.id,
      voice: this.threadVoice,
      reconfigure: this.threadVoice,
      selectionRevision: this.threadVoice ? 1 : undefined,
      model: this.settings.model,
      effort: this.settings.effort,
      ...(kind === 'send' ? { sinceSeq: this.lastSeq } : {}),
    };
    if (this.sendJson(payload)) attempt.submitted = true;
  }

  private onMessage(raw: string): void {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    if (typeof msg?.seq === 'number') this.lastSeq = Math.max(this.lastSeq, msg.seq);
    if (typeof msg?.latestSeq === 'number') this.lastSeq = Math.max(this.lastSeq, msg.latestSeq);

    switch (msg?.type) {
      case 'replayReset':
        this.lastSeq = 0;
        return;
      case 'ready': {
        this.isReady = true;
        if (this.threadVoice && typeof msg.cli === 'string') {
          this.settings = {
            cli: msg.cli,
            model: typeof msg.model === 'string' ? msg.model : undefined,
            effort: typeof msg.effort === 'string' ? msg.effort : undefined,
          };
        }
        this.activeCli = typeof msg.activeCli === 'string' ? msg.activeCli : this.settings.cli;
        const attempt = this.currentAttempt;
        const queued = Boolean(
          attempt
          && Array.isArray(msg.queuedClientMsgIds)
          && msg.queuedClientMsgIds.includes(attempt.id),
        );
        if (queued && attempt) attempt.serverOwns = true;
        this.serverBusy = msg.busy === true || queued;
        for (const resolve of this.readyResolvers.splice(0)) resolve(true);

        if (!attempt) return;
        if (attempt.admitted && !this.serverBusy) {
          this.completeCurrentAttempt();
          return;
        }
        if (!attempt.admitted && !queued) this.submitCurrentAttempt();
        return;
      }
      case 'selectionApplied': {
        if (this.threadVoice && typeof msg.cli === 'string') {
          this.settings = {
            cli: msg.cli,
            model: typeof msg.model === 'string' ? msg.model : undefined,
            effort: typeof msg.effort === 'string' ? msg.effort : undefined,
          };
          this.activeCli = msg.cli;
        }
        return;
      }
      case 'turnStart': {
        this.serverBusy = true;
        const attempt = this.currentAttempt;
        if (attempt && msg.clientMsgId && msg.clientMsgId === attempt.id) {
          attempt.serverOwns = true;
        }
        return;
      }
      case 'working': {
        if (typeof msg.activeCli === 'string') this.activeCli = msg.activeCli;
        if (msg.busy === true) this.serverBusy = true;
        return;
      }
      case 'sendAdmission': {
        const attempt = this.currentAttempt;
        if (!attempt || msg.clientMsgId !== attempt.id) return;
        if (msg.state === 'pending') {
          attempt.serverOwns = true;
          this.serverBusy = true;
          return;
        }
        if (msg.state === 'accepted') {
          attempt.admitted = true;
          attempt.serverOwns = true;
          this.voiceOwnsBusyTurn = msg.busy === true;
          this.serverBusy = msg.busy === true;
          if (!this.serverBusy) this.completeCurrentAttempt();
        }
        return;
      }
      case 'sendRejected':
      case 'steerRejected': {
        const attempt = this.currentAttempt;
        if (!attempt || msg.clientMsgId !== attempt.id) return;
        this.failCurrentAttempt(String(msg.message ?? 'voice message was not delivered'), msg.busy === true);
        return;
      }
      case 'turnEnd': {
        this.serverBusy = false;
        this.activeCli = null;
        this.voiceOwnsBusyTurn = false;
        const attempt = this.currentAttempt;
        if (!attempt) return;
        if (attempt.admitted) {
          this.completeCurrentAttempt();
          return;
        }
        // A submitted steer belongs to the next correlated turn; this terminal
        // event closes only the preceding typed/voice turn.
        if (attempt.submitted && attempt.kind === 'steer') return;
        void this.rebindSelectedEngine().then(() => this.submitCurrentAttempt());
        return;
      }
      case 'error': {
        const attempt = this.currentAttempt;
        if (!attempt) return;
        if (msg.code === 'HANDSHAKE_PENDING' && !attempt.admitted) {
          attempt.submitted = false;
          this.isReady = false;
          void this.rebindSelectedEngine().then(() => this.submitCurrentAttempt());
          return;
        }
        // Uncorrelated errors can belong to the preceding typed turn while our
        // steer is merely queued. Only a matching id or a durably admitted
        // voice turn may terminate this speech attempt.
        if (msg.clientMsgId === attempt.id || attempt.admitted) {
          this.failCurrentAttempt(String(msg.message ?? 'unknown error'));
        }
        return;
      }
      case 'sessionClosed': {
        if (this.currentAttempt?.admitted) {
          this.failCurrentAttempt('the session dropped mid-turn');
        }
        return;
      }
      case 'stream': {
        this.onStreamEvent(msg.event);
        return;
      }
      default:
        return;
    }
  }

  /** Mirrors the visible text/tool subset of src/chat/hooks/useChat.ts. */
  private onStreamEvent(ev: any): void {
    if (!ev || typeof ev !== 'object') return;
    if ((ev.type === 'stream_event' || ev.type === 'event') && ev.event) {
      this.onStreamEvent(ev.event);
      return;
    }
    const attempt = this.currentAttempt;
    if (ev.type === '_user_echo') {
      if (attempt && ev.clientMsgId === attempt.id) {
        attempt.admitted = true;
        attempt.serverOwns = true;
        this.serverBusy = true;
        this.voiceOwnsBusyTurn = true;
      }
      return;
    }
    // Never speak the preceding typed turn while a voice utterance is waiting
    // for its own durable admission boundary.
    if (!this.turnActive || !attempt?.admitted) return;
    if (ev.type === 'message_start') {
      this.sawTextThisMessage = false;
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
        this.sawTextThisMessage = true;
        this.emit({ kind: 'text', text: delta.text });
      }
      return;
    }
    // xAI's Anthropic-compatible stream skips deltas and supplies full text in
    // the final assistant event.
    if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
      if (this.sawTextThisMessage) return;
      const fullText = (ev.message.content as any[])
        .filter((content) => content?.type === 'text' && typeof content.text === 'string')
        .map((content) => content.text)
        .join('');
      if (fullText) {
        this.sawTextThisMessage = true;
        this.emit({ kind: 'text', text: fullText });
      }
    }
  }

  /** Run one spoken turn. Barge-in stops only TTS consumption; the admitted
   * Hall turn keeps working and the next utterance safely steers it. */
  async *runTurn(text: string, signal?: AbortSignal): AsyncGenerator<BrainEvent> {
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

    if (signal?.aborted) return;
    this.queue = [];
    this.turnActive = true;
    this.sawTextThisMessage = false;
    const attempt: VoiceAttempt = {
      id: `voice-${Date.now().toString(36)}-${++this.nextClientMessage}`,
      text,
      submitted: false,
      admitted: false,
      serverOwns: false,
    };
    this.currentAttempt = attempt;
    this.submitCurrentAttempt();

    try {
      while (true) {
        const event = await this.nextEvent(signal);
        yield event;
        if (event.kind === 'turnEnd' || event.kind === 'error' || event.kind === 'cancelled') return;
      }
    } finally {
      // A newer utterance replaces this pointer. Do not let an obsolete
      // generator clear or react to the newer attempt's correlated events.
      if (this.currentAttempt?.id === attempt.id && !this.turnActive) {
        this.currentAttempt = null;
      }
      if (this.currentAttempt?.id === attempt.id) this.turnActive = false;
    }
  }

  /** Explicit legacy dismiss stops work. Named-call hangup uses close() only. */
  stopTurn(): void {
    this.sendJson({
      type: 'stop',
      cli: this.activeCli ?? this.settings.cli,
      repo: this.repo,
      chatId: this.chatId,
    });
    this.serverBusy = false;
    this.voiceOwnsBusyTurn = false;
    this.currentAttempt = null;
  }

  close(): void {
    this.closed = true;
    this.turnActive = false;
    this.queue = [];
    for (const resolve of this.waiters.splice(0)) resolve({ kind: 'cancelled' });
    this.currentAttempt = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const resolve of this.readyResolvers.splice(0)) resolve(false);
    try { this.ws?.close(); } catch { /* already closing */ }
    this.ws = null;
  }
}
