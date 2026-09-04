// jarvis-agent configuration. Everything is environment-driven so operators
// can rotate keys without code changes. LIVEKIT_URL / LIVEKIT_API_KEY /
// LIVEKIT_API_SECRET are consumed by the agents CLI runner directly from env.

import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_VOICE_ID = 'cjVigY5qzO86Huf0OWal';

// Agent records predate the Hall-backed voice path and store xAI's short voice
// names. Preserve those user choices by mapping them onto distinct ElevenLabs
// premade voices for speech I/O; the reasoning model still comes from Hall.
const TEAMMATE_VOICE_IDS: Record<string, string> = {
  ara: 'EXAVITQu4vr4xnSDxMaL',      // Sarah
  eve: 'cgSgspJ2msm6clMCkdW9',      // Jessica
  leo: 'TX3LPaxmHKxFdv7VOQHJ',      // Liam
  rex: 'nPczCjzI2devNBz1zQrb',      // Brian
  sal: 'SAz9YHcvj6GT2YYXdXww',      // River
  atlas: 'onwK4e9ZLuTAKqWW03F9',    // Daniel
  aurora: 'FGY2WhTYpPnrIDTdsKH5',   // Laura
  luna: 'pFZP5JQG7iQjIQuC4Bku',     // Lily
  orion: 'JBFqnCBsd6RMkjVDRZzb',    // George
  carina: 'XrExE9yKIg1WjnnlVkGX',   // Matilda
};

export function teammateVoiceId(voice: string | undefined): string {
  return (voice && TEAMMATE_VOICE_IDS[voice]) || CONFIG.voiceId;
}

export const CONFIG = {
  /** ElevenLabs TTS */
  elevenApiKey: process.env.ELEVENLABS_API_KEY ?? '',
  voiceId: process.env.JARVIS_VOICE_ID || DEFAULT_VOICE_ID,
  ttsModel: process.env.JARVIS_TTS_MODEL || 'eleven_flash_v2_5',
  /** Direct ElevenLabs realtime STT. Normalize the old LiveKit Inference
   * descriptor so existing deployments migrate without an env change. */
  sttModel: (process.env.JARVIS_STT || 'scribe_v2_realtime').replace(/^.*\//, '').split(':')[0],
  sttLanguage: (process.env.JARVIS_STT || '').split(':')[1] || 'en',
  /** Rivendell Hall chat bridge */
  rivendellWsUrl: process.env.RIVENDELL_WS_URL || 'ws://127.0.0.1:8091/api/ws',
  rivendellRepo: process.env.RIVENDELL_REPO || join(homedir(), 'ASSISTANT-HUB'),
  /** Engine defaults: Grok 4.6 at max effort via Rivendell's xai engine.
   *  Model stays undefined so the runner's engine config (engines.json /
   *  RIVENDELL_XAI_MODEL) supplies the baked-in Grok id. */
  defaultCli: process.env.JARVIS_DEFAULT_CLI || 'xai',
  defaultModel: process.env.JARVIS_DEFAULT_MODEL || undefined,
  defaultEffort: process.env.JARVIS_DEFAULT_EFFORT || 'max',
  /** Auto-dismiss: agent-side belt-and-suspenders guard (client owns the UX). */
  idleShutdownMs: Number(process.env.JARVIS_IDLE_SHUTDOWN_MS || 180_000),
  agentName: process.env.JARVIS_AGENT_NAME || 'jarvis',
};

export function assertConfig(): void {
  const missing: string[] = [];
  if (!CONFIG.elevenApiKey) missing.push('ELEVENLABS_API_KEY');
  if (!process.env.LIVEKIT_URL) missing.push('LIVEKIT_URL');
  if (!process.env.LIVEKIT_API_KEY) missing.push('LIVEKIT_API_KEY');
  if (!process.env.LIVEKIT_API_SECRET) missing.push('LIVEKIT_API_SECRET');
  if (missing.length) throw new Error(`jarvis-agent missing env: ${missing.join(', ')}`);
}
