// Grok realtime voice calls — the TRUE xAI voice agent (grok-voice-think-fast-2.0),
// adapted from Operly's CabinetGrokSession. One call = one WebSocket to
// wss://api.x.ai/v1/realtime, server-side VAD + barge-in, 16 kHz mic in
// (upsampled here), 24 kHz PCM out. Browser protocol (JSON):
//
//   client → server: {type:'start', agentId, voice}
//                     {type:'audio', b64}        16 kHz PCM chunks
//                     {type:'setVoice', voice}    swap the voice mid-call
//                     {type:'stop'}
//   server → client: {type:'state', state}       connecting|listening|working|speaking|ended
//                     {type:'audio', b64}        24 kHz PCM deltas
//                     {type:'transcript', role, text, replace?}
//                     {type:'greeting'}
//                     {type:'error', message}
//                     {type:'ended', reason}
//
// No function tools on calls (v1): the voice agent talks; teammates' hands
// stay in their threads. Instructions = the agent's scope document.

import { WebSocket as WsClient, WebSocketServer } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from '../config.ts';
import { listAgents } from '../chat/agents.ts';
import { personaScopeFor } from '../chat/personaPrompts.ts';
import { trustedWebSocketOrigin } from '../lib/origin.ts';

export const GROK_REALTIME_URL = 'wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-2.0';
export const GROK_VOICE_IDS = ['ara', 'eve', 'leo', 'rex', 'sal', 'atlas', 'aurora', 'luna', 'orion', 'carina'] as const;

const CALL_RULES =
  'You are a named companion aboard the TARDIS, on a voice call with the user. Stay in character. ' +
  'Speak as I or me; never address yourself by your own name in the third person. Do not mention being an AI, Grok, or xAI unless asked. ' +
  'Keep spoken replies short and conversational — one or two sentences unless the user asks for depth. ' +
  'If a request needs files, tools, or teammates, say you will handle it in the thread after the call and keep talking.';

export function grokApiKey(): string {
  const env = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  if (env) return env;
  try {
    const fromFile = readFileSync(join(STATE_DIR, 'xai-key'), 'utf8').trim();
    if (fromFile) return fromFile;
  } catch { /* no key file */ }
  return '';
}

/** Linear upsample of 16-bit LE mono PCM from 16 kHz to 24 kHz (3/2). */
function upsamplePcm16kTo24k(base64: string): string {
  const src = Buffer.from(base64, 'base64');
  const samples = Math.floor(src.length / 2);
  if (samples <= 0) return base64;
  const outSamples = Math.floor((samples * 3) / 2);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const srcPos = (i * 2) / 3;
    const i0 = Math.min(Math.floor(srcPos), samples - 1);
    const i1 = Math.min(i0 + 1, samples - 1);
    const frac = srcPos - Math.floor(srcPos);
    const s0 = src.readInt16LE(i0 * 2);
    const s1 = src.readInt16LE(i1 * 2);
    out.writeInt16LE(Math.round(s0 + (s1 - s0) * frac), i * 2);
  }
  return out.toString('base64');
}

function sessionConfig(voice: string, instructions: string): Record<string, unknown> {
  return {
    instructions,
    voice,
    reasoning: { effort: 'none' },
    audio: {
      input: { format: { type: 'audio/pcm', rate: 24000 } },
      output: { format: { type: 'audio/pcm', rate: 24000 } },
    },
    turn_detection: { type: 'server_vad', threshold: 0.6, prefix_padding_ms: 300, silence_duration_ms: 400 },
  };
}

type CallState = 'connecting' | 'listening' | 'working' | 'speaking' | 'ended';

class GrokCall {
  private ws: WsClient | null = null;
  private closed = false;
  private assistantBuf = '';
  private responseActive = false;
  private discardResponseText = false;
  private greetingPhase: 'off' | 'pending' | 'playing' | 'done' = 'off';
  private greetingText = '';
  private voice: string;

  constructor(
    private readonly client: WsClient,
    private readonly instructions: string,
    private readonly greeting: string,
    voice: string,
  ) {
    this.voice = GROK_VOICE_IDS.includes(voice as (typeof GROK_VOICE_IDS)[number]) ? voice : 'ara';
    this.greetingText = this.greeting.trim();
    this.greetingPhase = this.greetingText ? 'pending' : 'off';
  }

  private send(msg: Record<string, unknown>): void {
    if (this.client.readyState === WsClient.OPEN) this.client.send(JSON.stringify(msg));
  }

  private sendGrok(obj: Record<string, unknown>): void {
    if (process.env.RIVENDELL_VOICE_DEBUG === '1') {
      console.log(`[voice] >> ${JSON.stringify(obj).slice(0, 160)}`);
    }
    this.ws?.send(JSON.stringify(obj));
  }

  async connect(): Promise<void> {
    const key = grokApiKey();
    if (!key) {
      this.send({ type: 'error', message: 'No xAI API key configured' });
      return;
    }
    await new Promise<void>((resolve) => {
      const ws = new WsClient(GROK_REALTIME_URL, { headers: { Authorization: `Bearer ${key}` } });
      this.ws = ws;
      ws.on('open', () => {
        this.sendGrok({ type: 'session.update', session: sessionConfig(this.voice, this.instructions) });
        this.greetingPhase = this.greetingText ? 'pending' : 'off';
        if (this.greetingText) {
          setTimeout(() => this.speakGreeting(), 450);
          setTimeout(() => this.finishGreeting(), 12000).unref?.();
        }
        this.send({ type: 'state', state: 'listening' });
        this.send({ type: 'greeting' });
        resolve();
      });
      ws.on('message', (data) => this.handle(String(data)));
      ws.on('error', (err) => {
        this.send({ type: 'error', message: err.message });
        resolve();
      });
      ws.on('close', () => {
        if (this.assistantBuf) {
          this.send({ type: 'transcript', role: 'assistant', text: this.assistantBuf });
          this.assistantBuf = '';
        }
        this.send({ type: 'state', state: 'ended' });
        this.send({ type: 'ended', reason: 'line closed' });
      });
    });
  }

  private micChunks = 0;
  private micDropped = 0;

  sendMic(base64: string): void {
    if (!this.ws || this.ws.readyState !== WsClient.OPEN) return;
    if (this.greetingPhase === 'pending' || this.greetingPhase === 'playing') {
      this.micDropped += 1;
      if (this.micDropped === 50) console.log('[voice] 50 mic chunks dropped during greeting phase');
      return;
    }
    this.micChunks += 1;
    if (this.micChunks === 1 || this.micChunks % 50 === 0) {
      console.log(`[voice] mic chunk #${this.micChunks} received (${base64.length} b64 chars)`);
    }
    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: upsamplePcm16kTo24k(base64) }));
  }

  setVoice(voice: string): void {
    if (!GROK_VOICE_IDS.includes(voice as (typeof GROK_VOICE_IDS)[number])) return;
    this.voice = voice;
    if (this.ws && this.ws.readyState === WsClient.OPEN) {
      this.ws.send(JSON.stringify({ type: 'session.update', session: sessionConfig(this.voice, this.instructions) }));
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.ws?.close(); } catch { /* already gone */ }
    this.send({ type: 'ended', reason: 'hangup' });
  }

  private finishGreeting(): void {
    if (this.greetingPhase === 'done' || this.greetingPhase === 'off') return;
    this.greetingPhase = 'done';
    if (!this.closed && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
    }
  }

  private speakGreeting(): void {
    if (this.closed || !this.ws || this.ws.readyState !== WsClient.OPEN || !this.greetingText) return;
    this.sendGrok({ type: 'input_audio_buffer.clear' });
    this.sendGrok({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: 'Speak this opening as one continuous utterance with no pause after the first word. Do not add anything. Say exactly: ' + this.greetingText,
      },
    });
  }

  private handle(raw: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return; }
    const type = String(msg.type || '');
    if (process.env.RIVENDELL_VOICE_DEBUG === '1') {
      console.log(`[voice] << ${type} ${raw.slice(0, 180)}`);
    }

    if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
      const delta = typeof msg.delta === 'string' ? msg.delta : '';
      if (delta) {
        this.send({ type: 'audio', b64: delta });
        this.send({ type: 'state', state: 'speaking' });
      }
      return;
    }
    if (type === 'input_audio_buffer.speech_started') {
      if (this.greetingPhase === 'pending' || this.greetingPhase === 'playing') return;
      this.send({ type: 'interrupt' }); // client drops queued playback NOW
      this.discardResponseText = true;
      if (this.assistantBuf) {
        this.send({ type: 'transcript', role: 'assistant', text: this.assistantBuf, replace: true, interrupted: true });
        this.assistantBuf = '';
      }
      this.discardResponseText = true;
      return;
    }
    if (type === 'response.created') {
      this.responseActive = true;
      this.discardResponseText = false;
      if (this.greetingPhase === 'pending') this.greetingPhase = 'playing';
      return;
    }
    if (type === 'response.output_audio.done' || type === 'response.audio.done') return;
    if (type === 'response.cancelled' || (type === 'response.done' && (msg.response as { status?: string })?.status === 'cancelled')) {
      this.assistantBuf = '';
      this.responseActive = false;
      this.send({ type: 'state', state: 'listening' });
      return;
    }
    if (type === 'response.done') {
      const output = (msg.response as { output?: unknown[] })?.output;
      if (Array.isArray(output) && output.length === 0 && (this.responseActive || this.assistantBuf) && this.greetingPhase !== 'pending' && this.greetingPhase !== 'playing') {
        this.assistantBuf = '';
        this.responseActive = false;
        this.send({ type: 'state', state: 'listening' });
        return;
      }
      if (this.assistantBuf) {
        this.send({ type: 'transcript', role: 'assistant', text: this.assistantBuf });
        this.assistantBuf = '';
      } else if ((this.greetingPhase === 'playing' || this.greetingPhase === 'pending') && this.greetingText) {
        // force_message greeting: attribute the scripted line (Operly parity).
        this.send({ type: 'transcript', role: 'assistant', text: this.greetingText });
      }
      this.responseActive = false;
      if (this.greetingPhase === 'playing' || this.greetingPhase === 'pending') this.finishGreeting();
      this.send({ type: 'state', state: 'listening' });
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const text = String((msg as { transcript?: string }).transcript || '').trim();
      if (text) this.send({ type: 'transcript', role: 'user', text });
      return;
    }
    if (type === 'response.output_text.delta' || type === 'response.audio_transcript.delta' || type === 'response.output_audio_transcript.delta') {
      const delta = typeof msg.delta === 'string' ? msg.delta : '';
      if (delta && !this.discardResponseText) this.assistantBuf += delta;
      return;
    }
    if (type === 'error') {
      const err = msg.error as { code?: string; message?: string };
      if (String(err?.code || '').toLowerCase().includes('cancel')) return;
      this.send({ type: 'error', message: String(err?.message || 'Grok error') });
    }
  }
}

export function registerVoiceCalls(server: HttpServer): void {
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws/voice') return;
    if (!trustedWebSocketOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const wss = new WebSocketServer({ noServer: true });
    wss.handleUpgrade(req, socket, head, (client: WsClient) => {
      let call: GrokCall | null = null;
      client.on('message', (raw: WsClient.RawData) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        if (msg.type === 'start') {
          if (call) return; // exactly one call per browser socket
          const agentId = String(msg.agentId ?? '');
          const agent = listAgents().find((a) => a.id === agentId);
          if (!agent) { client.send(JSON.stringify({ type: 'error', message: 'unknown agent' })); return; }
          const scope = agent ? personaScopeFor(agent.home) : '';
          const name = agent?.name ?? 'TARDIS';
          const instructions = [CALL_RULES, scope || `You are ${name}, a companion aboard the TARDIS.`].filter(Boolean).join('\n\n');
          const greeting = `Hey — ${name} here. What's up?`;
          call = new GrokCall(client, instructions, greeting, String(msg.voice ?? agent?.voice ?? 'ara'));
          void call.connect();
          return;
        }
        if (msg.type === 'audio' && call) { call.sendMic(String(msg.b64 ?? '')); return; }
        if (msg.type === 'setVoice' && call) { call.setVoice(String(msg.voice ?? '')); return; }
        if (msg.type === 'stop' && call) { call.close(); call = null; return; }
      });
      client.on('close', () => { call?.close(); call = null; });
      client.send(JSON.stringify({ type: 'state', state: 'connecting' }));
    });
  });
}
