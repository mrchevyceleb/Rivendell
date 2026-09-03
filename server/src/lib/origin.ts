import type { IncomingMessage } from 'node:http';

const configuredOrigins = new Set(
  (process.env.RIVENDELL_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean),
);
const configuredHosts = new Set(
  [...configuredOrigins].flatMap((origin) => {
    try { return [new URL(origin).host.toLowerCase()]; } catch { return []; }
  }),
);

function isLoopback(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function requestHost(req: IncomingMessage): URL | null {
  const host = req.headers.host;
  if (!host) return null;
  try { return new URL(`http://${host}`); } catch { return null; }
}

/** Browsers send Origin during WebSocket upgrades. Accept loopback development
 * and exact origins explicitly trusted by the operator. Arbitrary matching
 * Origin/Host pairs are rejected to prevent DNS rebinding into the local agent
 * control plane. Non-browser clients without Origin must still address either
 * loopback or a configured host. */
export function trustedWebSocketOrigin(req: IncomingMessage): boolean {
  const target = requestHost(req);
  if (!target) return false;
  const targetIsLoopback = isLoopback(target.hostname);
  const targetIsConfigured = configuredHosts.has(target.host.toLowerCase());
  if (!targetIsLoopback && !targetIsConfigured) return false;

  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const normalizedOrigin = originUrl.origin.replace(/\/$/, '');
    if (targetIsLoopback && isLoopback(originUrl.hostname)) return true;
    return configuredOrigins.has(normalizedOrigin)
      && originUrl.host.toLowerCase() === target.host.toLowerCase();
  } catch {
    return false;
  }
}
