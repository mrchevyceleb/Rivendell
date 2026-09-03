import { Router } from 'express';
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';

// Jarvis voice sessions: mints LiveKit Cloud room tokens with the jarvis-agent
// auto-dispatched via token RoomConfiguration, and serves client bootstrap
// config (Picovoice wake-word key + LiveKit URL) so those rotate without a
// frontend rebuild. Same trust model as every other /api/* route: tailnet-only,
// no auth.

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? '';
const PICOVOICE_ACCESS_KEY = process.env.PICOVOICE_ACCESS_KEY ?? '';
const JARVIS_AGENT_NAME = process.env.JARVIS_AGENT_NAME || 'jarvis';
const TOKEN_TTL = '15m';

const enabled = Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);

function sanitizeIdentity(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  return safe || 'device';
}

export const jarvisRouter = Router();

jarvisRouter.get('/config', (_req, res) => {
  res.json({
    enabled,
    livekitUrl: enabled ? LIVEKIT_URL : null,
    picovoiceKey: PICOVOICE_ACCESS_KEY || null,
  });
});

jarvisRouter.get('/token', async (req, res) => {
  if (!enabled) {
    res.status(503).json({ error: 'jarvis disabled: LIVEKIT_URL/API_KEY/API_SECRET not configured' });
    return;
  }
  try {
    const identity = sanitizeIdentity(req.query.identity);
    const face = req.query.face === '1' || req.query.face === 'true';
    const cli = typeof req.query.cli === 'string' && req.query.cli.trim() ? req.query.cli.trim() : 'xai';
    const model = typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : undefined;
    const effort = typeof req.query.effort === 'string' && req.query.effort.trim() ? req.query.effort.trim() : undefined;

    // Room is unique per conversation, but the Hall chatId is STABLE per
    // device: the spawned claude CLI (30-70s MCP cold start) stays warm across
    // summons, so only the first conversation in a while pays the boot cost.
    // The `jarvis-` prefix still triggers voice mode (normalizeChatId-safe).
    const room = `jarvis-${identity}-${Date.now().toString(36)}`;
    const chatId = `jarvis-${identity}`;
    const metadata = JSON.stringify({ face, cli, model, effort, chatId });

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, ttl: TOKEN_TTL });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    at.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: JARVIS_AGENT_NAME, metadata })],
    });

    res.json({ url: LIVEKIT_URL, room, token: await at.toJwt(), identity });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
