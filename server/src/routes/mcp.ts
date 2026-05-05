import type { Request } from 'express';
import { Router } from 'express';
import {
  ASSISTANT_ADMIN_BASE_URL,
  RAILWAY_API_TOKEN,
  RAILWAY_ENVIRONMENT_ID,
  RAILWAY_SERVICE_ID,
} from '../config.ts';
import { asyncHandler } from './helpers.ts';

export const mcpRouter = Router();

const HEALTH_TIMEOUT_MS = 8000;
const ACTION_HEADER = 'x-rivendell-action';
const REDEPLOY_ACTION = 'redeploy';

/** True only when the request comes from the same origin as the Rivendell
 *  server. Browsers always set Origin on cross-site fetches, so a missing
 *  Origin (curl, server-side calls) or a matching Origin both pass. */
function sameOrigin(req: Request): boolean {
  const origin = req.get('origin');
  const host = req.get('host');
  if (!origin) return true;
  if (!host) return false;
  try {
    const url = new URL(origin);
    return url.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

mcpRouter.get('/health', asyncHandler(async (_req, res) => {
  const url = `${ASSISTANT_ADMIN_BASE_URL.replace(/\/$/, '')}/health`;
  const startedAt = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: ctrl.signal });
    const ms = Date.now() - startedAt;
    res.json({
      ok: response.ok,
      status: response.status,
      ms,
      url,
      checkedAt: Date.now(),
    });
  } catch (err: any) {
    res.json({
      ok: false,
      ms: Date.now() - startedAt,
      url,
      error: err?.name === 'AbortError' ? 'timeout' : (err?.message || 'unreachable'),
      checkedAt: Date.now(),
    });
  } finally {
    clearTimeout(timer);
  }
}));

mcpRouter.post('/redeploy', asyncHandler(async (req, res) => {
  // Guard against CSRF: a webpage Matt happens to visit can submit a form or
  // no-cors POST, but it cannot set a custom header without a CORS preflight,
  // and the same-origin check rejects cross-site fetches that try.
  if (!sameOrigin(req)) {
    res.status(403).json({ error: 'cross-origin redeploys are not permitted' });
    return;
  }
  if ((req.get(ACTION_HEADER) || '').toLowerCase() !== REDEPLOY_ACTION) {
    res.status(403).json({ error: `missing ${ACTION_HEADER} header` });
    return;
  }
  if (!RAILWAY_API_TOKEN) {
    res.status(400).json({
      error: 'Railway token not configured. Set RAILWAY_API_TOKEN or run `railway login` on the host.',
    });
    return;
  }
  try {
    const response = await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RAILWAY_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `mutation Redeploy($serviceId: String!, $environmentId: String!) {
          serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
        }`,
        variables: {
          serviceId: RAILWAY_SERVICE_ID,
          environmentId: RAILWAY_ENVIRONMENT_ID,
        },
      }),
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok || body?.errors) {
      const detail = body?.errors?.[0]?.message || `HTTP ${response.status}`;
      res.status(502).json({ error: `Railway redeploy failed: ${detail}` });
      return;
    }
    res.json({ ok: true, queuedAt: Date.now() });
  } catch (err: any) {
    res.status(502).json({ error: `Railway redeploy failed: ${err?.message || 'unknown error'}` });
  }
}));
