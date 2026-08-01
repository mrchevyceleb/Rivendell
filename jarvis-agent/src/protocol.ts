// Data-channel protocol between jarvis-agent and Jarvis clients.
// The Rivendell frontend keeps a mirrored copy (src/jarvis/protocol.ts) until
// Phase 4 extracts a shared jarvis-client package as the single source of truth.

export const JARVIS_TOPIC = 'jarvis';

/** agent -> client */
export type JarvisAgentMessage =
  | { type: 'state'; agentState: 'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking'; userState?: 'speaking' | 'listening' | 'away' }
  | { type: 'caption'; role: 'user' | 'jarvis'; text: string; final: boolean }
  | { type: 'tool'; name: string; phrase: string }
  | { type: 'status'; message: string }
  | { type: 'settings'; cli: string; model?: string; effort?: string }
  | { type: 'closing'; reason: string };

/** client -> agent */
export type JarvisClientMessage =
  | { type: 'settings'; cli?: string; model?: string; effort?: string }
  | { type: 'dismiss' };

export function encodeMessage(msg: JarvisAgentMessage | JarvisClientMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

export function decodeMessage(payload: Uint8Array): JarvisClientMessage | JarvisAgentMessage | null {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
}
