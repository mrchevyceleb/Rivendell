// Data-channel protocol with jarvis-agent. Mirror of jarvis-agent/src/protocol.ts
// until Phase 4 extracts a shared jarvis-client package.

export const JARVIS_TOPIC = 'jarvis';

export type JarvisAgentState = 'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking';

/** agent -> client */
export type JarvisAgentMessage =
  | { type: 'state'; agentState: JarvisAgentState; userState?: 'speaking' | 'listening' | 'away' }
  | { type: 'caption'; role: 'user' | 'jarvis'; text: string; final: boolean }
  | { type: 'tool'; name: string; phrase: string }
  | { type: 'status'; message: string }
  | { type: 'settings'; cli: string; model?: string; effort?: string }
  | { type: 'closing'; reason: string };

/** client -> agent */
export type JarvisClientMessage =
  | { type: 'settings'; cli?: string; model?: string; effort?: string }
  | { type: 'hangup' }
  | { type: 'dismiss' };

export function encodeMessage(msg: JarvisClientMessage): Uint8Array<ArrayBuffer> {
  // TextEncoder always yields a plain ArrayBuffer-backed view; the cast
  // reconciles TS 5.9's ArrayBufferLike generic with livekit-client's type.
  return new TextEncoder().encode(JSON.stringify(msg)) as Uint8Array<ArrayBuffer>;
}

export function decodeAgentMessage(payload: Uint8Array): JarvisAgentMessage | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    return parsed && typeof parsed.type === 'string' ? (parsed as JarvisAgentMessage) : null;
  } catch {
    return null;
  }
}

export type JarvisEngineSettings = { cli: string; model?: string; effort?: string };

// Grok 4.6 via Rivendell's xai engine (model id comes from the server's engine
// config). "deep" (max effort) is the default; "snappy" trades some
// reasoning depth for faster spoken turns.
export const JARVIS_PRESETS: Record<'snappy' | 'deep', JarvisEngineSettings> = {
  snappy: { cli: 'xai', effort: 'high' },
  deep: { cli: 'xai', effort: 'max' },
};
