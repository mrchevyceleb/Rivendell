import { Router } from 'express';
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import { brainForAgent, cliForAgentEngine, listAgents } from '../chat/agents.ts';
import { ELROND_WORKSPACE_PATH } from '../config.ts';
import { discoverRepos } from '../chat/repos.ts';

// LiveKit voice sessions. Legacy generic Jarvis summons still use their stable
// device thread; named teammate calls resolve agentId server-side to that
// teammate's real bot-* thread and run through the exact Hall chat pipeline.
// Same trust model as every other /api/* route: tailnet-only, no app auth.

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
    const requestedAgentId = typeof req.query.agentId === 'string' ? req.query.agentId.trim() : '';
    const agent = requestedAgentId
      ? listAgents().find((candidate) => candidate.id === requestedAgentId)
      : undefined;
    if (requestedAgentId && !agent) {
      res.status(404).json({ error: 'voice teammate not found' });
      return;
    }
    const storedBrain = agent ? brainForAgent(agent) : null;
    const cli = storedBrain
      ? cliForAgentEngine(storedBrain.engine)
      : typeof req.query.cli === 'string' && req.query.cli.trim() ? req.query.cli.trim() : 'xai';
    const model = storedBrain?.model
      ?? (typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : undefined);
    const effort = storedBrain?.effort
      ?? (typeof req.query.effort === 'string' && req.query.effort.trim() ? req.query.effort.trim() : undefined);
    const repo = typeof req.query.repo === 'string' && req.query.repo.trim()
      ? req.query.repo.trim()
      : ELROND_WORKSPACE_PATH;
    if (agent && repo !== ELROND_WORKSPACE_PATH) {
      const allowed = (await discoverRepos()).some((candidate) => candidate.path === repo);
      if (!allowed) {
        res.status(400).json({ error: 'voice workspace is not a registered repository' });
        return;
      }
    }

    // Each audio room is ephemeral. Its Hall chatId is not: named calls use the
    // exact agent home, while deprecated generic summons keep a device thread.
    const room = `${agent ? 'voice' : 'jarvis'}-${identity}-${Date.now().toString(36)}`;
    const chatId = agent?.home ?? `jarvis-${identity}`;
    const metadata = JSON.stringify({
      face,
      cli,
      model,
      effort,
      chatId,
      repo,
      threadVoice: Boolean(agent),
      agentId: agent?.id,
      agentName: agent?.name,
      voice: agent?.voice,
    });

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
