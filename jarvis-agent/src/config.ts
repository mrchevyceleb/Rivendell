// jarvis-agent configuration. Everything env-driven so Doppler rotates keys
// without code changes. LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are
// consumed by the agents CLI runner directly from env.

const DANIEL_VOICE_ID = 'cjVigY5qzO86Huf0OWal'; // ElevenLabs "Daniel", British, authoritative

export const CONFIG = {
  /** ElevenLabs TTS */
  elevenApiKey: process.env.ELEVENLABS_API_KEY ?? '',
  voiceId: process.env.JARVIS_VOICE_ID || DANIEL_VOICE_ID,
  ttsModel: process.env.JARVIS_TTS_MODEL || 'eleven_flash_v2_5',
  /** STT: LiveKit Inference descriptor string (or a future plugin swap). */
  stt: process.env.JARVIS_STT || 'elevenlabs/scribe_v2_realtime:en',
  /** Rivendell Hall chat bridge */
  rivendellWsUrl: process.env.RIVENDELL_WS_URL || 'ws://127.0.0.1:8091/api/ws',
  rivendellRepo: process.env.RIVENDELL_REPO || '/home/mrchevyceleb/ASSISTANT-HUB',
  /** Engine defaults: Grok 4.5 at max effort via Rivendell's xai engine.
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
