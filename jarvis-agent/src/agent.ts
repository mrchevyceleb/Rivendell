// Jarvis voice agent: LiveKit Agents worker whose "LLM" is the Rivendell Hall
// chat pipeline (full Elrond parity — same engines, tools, and history). STT
// and TTS are stock framework nodes; llmNode is overridden to stream text from
// the Hall brain, with tool narration and keep-alives woven in for long
// agentic turns.

import { fileURLToPath } from 'node:url';
import { ReadableStream } from 'node:stream/web';
import {
  ServerOptions,
  cli,
  defineAgent,
  llm,
  voice,
  type JobContext,
  type JobProcess,
} from '@livekit/agents';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as silero from '@livekit/agents-plugin-silero';
import { RoomEvent } from '@livekit/rtc-node';
import { CONFIG, assertConfig } from './config.ts';
import { HallBrain, type BrainEvent } from './hallBrain.ts';
import { ack, greeting, nextKeepAlive, phraseForTool } from './narration.ts';
import { JARVIS_TOPIC, decodeMessage, encodeMessage, type JarvisAgentMessage } from './protocol.ts';

// Speak an ack only if the brain hasn't produced anything within this window:
// fast replies ("Anytime, sir.") come straight through with no "One moment—"
// collision; anything slower still gets acknowledged near-instantly.
const FIRST_ACK_MS = 2_500;
// Sparse spoken filler: every phrase queued into TTS plays SERIALLY behind
// real answer text, so chatty filler makes the voice narrate the past.
const KEEPALIVE_MS = 30_000;
const NARRATE_QUIET_MS = 10_000;
// The framework force-closes a TTS stream that goes quiet for ttsReadIdleTimeout
// (default 10s). Our brain legitimately pauses mid-reply for tool work, so the
// default watchdog was killing answers mid-turn ("TTS stream stalled").
const TTS_IDLE_TIMEOUT_MS = 180_000;

const TIMEOUT = Symbol('timeout');

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
    timer.unref?.();
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout]);
}

/**
 * One spoken turn: brain events -> spoken text. Tool activity is published to
 * the HUD always, but only SPOKEN when the model has been quiet (it usually
 * narrates its own work per the voice prompt). Keep-alives fire when nothing
 * has been said for a while during tool churn.
 */
async function* narratedTurn(
  brain: HallBrain,
  text: string,
  publish: (msg: JarvisAgentMessage) => void,
): AsyncGenerator<string> {
  const events = brain.runTurn(text);
  let pending: Promise<IteratorResult<BrainEvent>> | null = null;

  // Jarvis acknowledges INSTANTLY on every request, then thinks. This also
  // stops the user from prodding "you there?" during a slow brain start —
  // which would barge-in and kill the very reply they're waiting for.
  let lastSpokenAt = Date.now();
  let firstEventSeen = false;

  // Sentence buffer: slow token trickle (deep reasoning) fed straight to TTS
  // starves the audio buffer mid-word, and WebRTC's jitter recovery
  // time-stretches phonemes to cover — the "slooow mooootion" artifact. Only
  // release complete sentences so synthesis happens in clean bursts.
  let buf = '';
  const SENTENCE_END = /[.!?…]["')\]]?\s*$/;

  try {
    while (true) {
      pending ??= events.next();
      const winner = await raceTimeout(pending, firstEventSeen ? KEEPALIVE_MS : FIRST_ACK_MS);
      if (winner === TIMEOUT) {
        if (buf.trim()) {
          const flushed = buf;
          buf = '';
          yield flushed;
        }
        const phrase = firstEventSeen ? nextKeepAlive() : ack();
        firstEventSeen = true;
        publish({ type: 'status', message: phrase });
        lastSpokenAt = Date.now();
        yield ` ${phrase} `;
        continue;
      }
      pending = null;
      firstEventSeen = true;
      if (winner.done) break;
      const ev = winner.value;

      if (ev.kind === 'text') {
        lastSpokenAt = Date.now();
        buf += ev.text;
        if (SENTENCE_END.test(buf) || buf.length > 300) {
          const flushed = buf;
          buf = '';
          yield flushed;
        }
      } else if (ev.kind === 'tool') {
        const phrase = phraseForTool(ev.name);
        publish({ type: 'tool', name: ev.name, phrase });
        if (Date.now() - lastSpokenAt > NARRATE_QUIET_MS) {
          if (buf.trim()) {
            const flushed = buf;
            buf = '';
            yield flushed;
          }
          lastSpokenAt = Date.now();
          yield ` ${phrase} `;
        }
      } else if (ev.kind === 'error') {
        publish({ type: 'status', message: `brain error: ${ev.message}` });
        yield ' I hit a snag with that one, sir. The details are in Hall.';
        return;
      } else if (ev.kind === 'turnEnd') {
        break;
      }
    }
    if (buf.trim()) yield buf;
  } finally {
    void events.return(undefined);
  }
}

/**
 * The framework SILENTLY skips reply generation when no `llm` is configured
 * (agent_activity onEndOfTurn: `if (this.llm === undefined) return;`), even
 * with an llmNode override in place. This stub exists purely to pass that
 * guard; JarvisAgent.llmNode intercepts the actual generation, so chat() must
 * never run.
 */
class HallBrainLLM extends llm.LLM {
  label(): string {
    return 'hall-brain';
  }

  override get model(): string {
    return 'rivendell-hall';
  }

  override get provider(): string {
    return 'rivendell';
  }

  chat(): llm.LLMStream {
    throw new Error('HallBrainLLM.chat must never run: JarvisAgent.llmNode overrides generation');
  }
}

class JarvisAgent extends voice.Agent {
  constructor(
    private readonly brain: HallBrain,
    private readonly publish: (msg: JarvisAgentMessage) => void,
  ) {
    super({
      // llmNode is overridden; these instructions are not sent anywhere, but
      // the field is required by the framework.
      instructions: 'Jarvis: responses are produced by the Rivendell Hall brain.',
      llm: new HallBrainLLM(),
    });
  }

  override async llmNode(
    chatCtx: llm.ChatContext,
    _toolCtx: llm.ToolContext,
    _modelSettings: voice.ModelSettings,
  ): Promise<ReadableStream<llm.ChatChunk | string> | null> {
    const lastUser = [...chatCtx.items]
      .reverse()
      .find((item): item is llm.ChatMessage => item.type === 'message' && item.role === 'user');
    const text = lastUser?.textContent?.trim();
    if (!text) return null;

    const iterator = narratedTurn(this.brain, text, this.publish)[Symbol.asyncIterator]();
    return new ReadableStream<string>({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel() {
        // Barge-in: stop speaking, keep the Hall turn working. A follow-up
        // utterance steers it; silence lets it finish into Hall history.
        void iterator.return?.(undefined);
      },
    });
  }
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    assertConfig();
    await ctx.connect();

    let meta: { face?: boolean; cli?: string; model?: string; effort?: string; chatId?: string } = {};
    try {
      meta = JSON.parse(ctx.job.metadata || '{}');
    } catch {
      /* default meta */
    }
    const chatId = meta.chatId || ctx.room.name || `jarvis-${Date.now().toString(36)}`;

    const brain = new HallBrain({
      wsUrl: CONFIG.rivendellWsUrl,
      repo: CONFIG.rivendellRepo,
      chatId,
      settings: {
        cli: meta.cli || CONFIG.defaultCli,
        model: meta.model || CONFIG.defaultModel,
        effort: meta.effort || CONFIG.defaultEffort,
      },
    });

    const publish = (msg: JarvisAgentMessage): void => {
      void ctx.room.localParticipant
        ?.publishData(encodeMessage(msg), { reliable: true, topic: JARVIS_TOPIC })
        .catch(() => {});
    };

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: CONFIG.stt,
      tts: new elevenlabs.TTS({
        apiKey: CONFIG.elevenApiKey,
        voiceId: CONFIG.voiceId,
        model: CONFIG.ttsModel,
      }),
      userAwayTimeout: 30,
      ttsReadIdleTimeout: TTS_IDLE_TIMEOUT_MS,
      forwardAudioIdleTimeout: TTS_IDLE_TIMEOUT_MS,
      // Preemptive generation fires llmNode on the INTERIM transcript, then
      // scraps and re-runs on the final one. Our llmNode drives a stateful
      // Hall turn, so the scrap surfaced phantom "No."/"Yes." captions and the
      // re-run steered/restarted the brain mid-work (45-60s of extra silence).
      preemptiveGeneration: false,
    });

    let lastActivityAt = Date.now();
    let shuttingDown = false;

    const shutdown = async (reason: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[jarvis ${chatId}] shutting down: ${reason}`);
      publish({ type: 'closing', reason });
      brain.close();
      try {
        await session.close();
      } catch {
        /* already closed */
      }
      (ctx as unknown as { shutdown?: (reason?: string) => void }).shutdown?.(reason);
    };

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      lastActivityAt = Date.now();
      publish({ type: 'state', agentState: ev.newState, userState: session.userState });
    });
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      lastActivityAt = Date.now();
      publish({ type: 'caption', role: 'user', text: ev.transcript, final: ev.isFinal });
    });
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = (ev as { item?: llm.ChatMessage }).item;
      // Skip interrupted partials — they were never (fully) spoken and showing
      // them as Jarvis's "answer" is worse than showing nothing.
      if (item?.type === 'message' && item.role === 'assistant' && item.textContent && !item.interrupted) {
        publish({ type: 'caption', role: 'jarvis', text: item.textContent, final: true });
      }
    });

    ctx.room.on(RoomEvent.DataReceived, (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== JARVIS_TOPIC) return;
      const msg = decodeMessage(payload);
      if (!msg) return;
      if (msg.type === 'dismiss') {
        brain.stopTurn();
        void session.interrupt({ force: true });
        void shutdown('dismissed');
      } else if (msg.type === 'settings') {
        brain.updateSettings(msg);
        publish({ type: 'settings', ...brain.currentSettings });
      }
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, () => {
      // Room emptied of humans (avatar participants come in Phase 2) -> close
      // out fast so LiveKit/Anam minutes stop burning.
      const remotes = ctx.room.remoteParticipants;
      const humanCount = remotes ? remotes.size : 0;
      if (humanCount === 0) void shutdown('room empty');
    });

    // Belt-and-suspenders idle guard; the client owns the visible 45s
    // auto-dismiss countdown and sends `dismiss` itself.
    const idleGuard = setInterval(() => {
      const idleFor = Date.now() - lastActivityAt;
      if (idleFor > CONFIG.idleShutdownMs && session.agentState !== 'thinking' && session.agentState !== 'speaking') {
        void shutdown('idle timeout');
      }
    }, 10_000);
    idleGuard.unref();

    const agent = new JarvisAgent(brain, publish);

    // Connect the brain in parallel with session start; the greeting covers
    // the gap, and the first turn awaits readiness inside runTurn anyway.
    void brain.connect().then((ok) => {
      if (!ok) publish({ type: 'status', message: 'brain connection failed; retrying on first turn' });
    });

    await session.start({ agent, room: ctx.room, record: false });
    publish({ type: 'settings', ...brain.currentSettings });
    session.say(greeting());
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: CONFIG.agentName,
  }),
);
