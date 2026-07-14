import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const xaiOauthRouter = Router();

// xAI SuperGrok subscription OAuth (PKCE). Mirrors the pi-grok extension flow
// so the access token draws on Matt's SuperGrok subscription instead of the
// metered GROK_PERSONAL_API_KEY. One-time browser login; the token refreshes
// itself (refresh logic lives in the chat runner on spawn).
const ISSUER = 'https://auth.x.ai';
const CLIENT_ID = process.env.XAI_OAUTH_CLIENT_ID || 'b1a00492-073a-47ea-816f-4c329264a828';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const REDIRECT_URI = 'http://127.0.0.1:56121/callback';
const TOKEN_PATH = join(homedir(), '.rivendell', 'xai-oauth.json');
const REFRESH_SKEW_MS = 5 * 60 * 1000;

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Pending PKCE state between GET (build URL) and POST (exchange).
let pending: { verifier: string; state: string; tokenEndpoint: string } | null = null;

/** Read + (if expired) refresh the stored OAuth token. Returns the access token
 *  or null. Exported so the chat runner can use the subscription token. */
export async function getXaiOauthToken(): Promise<string | null> {
  if (!existsSync(TOKEN_PATH)) return null;
  let creds: { access: string; refresh?: string; expires?: number; tokenEndpoint?: string };
  try { creds = JSON.parse(readFileSync(TOKEN_PATH, 'utf8')); } catch { return null; }
  if (!creds.access) return null;
  if (!creds.expires || creds.expires > Date.now()) return creds.access;
  if (!creds.refresh) return null;
  // Refresh.
  const tokenEndpoint = creds.tokenEndpoint || `${ISSUER}/oauth2/token`;
  try {
    const resp = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: creds.refresh }),
    });
    if (!resp.ok) return null;
    const j = await resp.json() as any;
    if (!j.access_token) return null;
    const next = {
      access: j.access_token,
      refresh: j.refresh_token || creds.refresh,
      expires: Date.now() + (j.expires_in || 3600) * 1000 - REFRESH_SKEW_MS,
      tokenEndpoint,
    };
    writeFileSync(TOKEN_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
    return next.access;
  } catch { return null; }
}

/** Synchronous reader for the cached OAuth token. Used at spawn time where we
 *  can't await. Returns the stored access token if present (the background
 *  refresh in the chat runner keeps it fresh); null if never logged in. */
export function getXaiOauthTokenSync(): string | null {
  if (!existsSync(TOKEN_PATH)) return null;
  try {
    const creds = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
    return typeof creds.access === 'string' && creds.access ? creds.access : null;
  } catch {
    return null;
  }
}

/** Has a SuperGrok OAuth token ever been stored? */
export function hasXaiOauthToken(): boolean {
  return existsSync(TOKEN_PATH);
}

async function discover(): Promise<{ authorization_endpoint: string; token_endpoint: string }> {
  const r = await fetch(`${ISSUER}/.well-known/openid-configuration`);
  if (!r.ok) throw new Error(`xAI discovery failed: ${r.status}`);
  return await r.json() as any;
}

// GET /xai-oauth — clickable login page (browser, not TUI).
xaiOauthRouter.get('/', async (_req, res) => {
  let connected = false;
  if (existsSync(TOKEN_PATH)) {
    try { connected = !!JSON.parse(readFileSync(TOKEN_PATH, 'utf8')).access; } catch {}
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html><head><meta charset="utf-8">
<title>Connect SuperGrok · Rivendell</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-sans-serif, system-ui; background:#0f1419; color:#e6e1cf; margin:0; padding:40px 20px; }
  .card { max-width:560px; margin:0 auto; background:#161b22; border:1px solid #2a3441; border-radius:14px; padding:28px; }
  h1 { font-size:20px; margin:0 0 6px; }
  .sub { color:#8b97a6; font-size:14px; margin:0 0 22px; }
  .ok { color:#7ee787; font-weight:600; }
  a.btn, button { display:inline-block; background:#2f6fed; color:#fff; padding:12px 18px; border-radius:9px; text-decoration:none; font-weight:600; border:0; cursor:pointer; font-size:15px; }
  ol { line-height:1.7; font-size:14px; }
  textarea { width:100%; box-sizing:border-box; background:#0d1117; color:#e6e1cf; border:1px solid #2a3441; border-radius:8px; padding:10px; font-family:ui-monospace,monospace; font-size:12px; min-height:54px; }
  #result { margin-top:14px; font-size:14px; white-space:pre-wrap; }
  .muted { color:#8b97a6; font-size:13px; }
</style></head><body><div class="card">
<h1>Connect SuperGrok <span id="status">${connected ? '<span class="ok">✓ connected</span>' : ''}</span></h1>
<p class="sub">Use your xAI SuperGrok subscription instead of metered API credits. One-time login.</p>
<ol>
  <li>Click <b>Authorize xAI</b> below. Approve in the xAI page.</li>
  <li>Your browser will show <b>"This site can't be reached"</b> at <code>127.0.0.1:56121/callback?code=...</code> — that's expected.</li>
  <li>Copy the <b>entire URL</b> from the address bar, paste it below, and click <b>Connect</b>.</li>
</ol>
<p style="margin-bottom:8px"><a class="btn" href="/xai-oauth/start" target="_blank">Authorize xAI →</a></p>
<textarea id="paste" placeholder="http://127.0.0.1:56121/callback?code=...&state=..."></textarea>
<p style="margin:10px 0"><button id="go">Connect</button></p>
<div id="result"></div>
<p class="muted">Token stored locally on Moria at ~/.rivendell/xai-oauth.json. Never leaves the machine.</p>
</div>
<script>
document.getElementById('go').onclick = async () => {
  const url = document.getElementById('paste').value.trim();
  const r = document.getElementById('result');
  if (!url) { r.textContent = 'Paste the redirect URL first.'; return; }
  r.textContent = 'Exchanging…';
  try {
    const resp = await fetch('/xai-oauth/exchange', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ url }) });
    const j = await resp.json();
    if (resp.ok) { r.innerHTML = '<span class="ok">✓ Connected! SuperGrok subscription is active.</span>'; }
    else r.textContent = 'Failed: ' + (j.error || resp.status);
  } catch (e) { r.textContent = 'Error: ' + e.message; }
};
</script></body></html>`);
});

// GET /xai-oauth/start — mint PKCE + redirect to xAI authorization.
xaiOauthRouter.get('/start', async (_req, res) => {
  try {
    const disc = await discover();
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = b64url(randomBytes(16));
    pending = { verifier, state, tokenEndpoint: disc.token_endpoint };
    const u = new URL(disc.authorization_endpoint);
    for (const [k, v] of Object.entries({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: SCOPE,
      code_challenge: challenge, code_challenge_method: 'S256', state, plan: 'generic', referrer: 'rivendell',
    })) u.searchParams.set(k, v);
    res.redirect(302, u.toString());
  } catch (err: any) {
    res.status(500).send(`OAuth start failed: ${err?.message || err}`);
  }
});

// POST /xai-oauth/exchange { url } — exchange the pasted redirect URL for tokens.
xaiOauthRouter.post('/exchange', async (req, res) => {
  try {
    const pasted = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!pending) return res.status(400).json({ error: 'No pending login. Reload /xai-oauth and click Authorize first.' });
    let code: string | null = null;
    let state: string | null = null;
    try {
      const cu = new URL(pasted);
      code = cu.searchParams.get('code');
      state = cu.searchParams.get('state');
    } catch {
      const qs = new URLSearchParams(pasted.includes('?') ? pasted.slice(pasted.indexOf('?') + 1) : pasted);
      code = qs.get('code'); state = qs.get('state');
    }
    if (state && state !== pending.state) return res.status(400).json({ error: 'State mismatch — start over (reload and click Authorize again).' });
    if (!code) return res.status(400).json({ error: 'No code found in that URL. Paste the full 127.0.0.1:56121/callback?code=... URL.' });
    const tok = await fetch(pending.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: CLIENT_ID, code,
        redirect_uri: REDIRECT_URI, code_verifier: pending.verifier,
      }),
    });
    if (!tok.ok) {
      const t = await tok.text().catch(() => '');
      return res.status(400).json({ error: `xAI token exchange failed (${tok.status}): ${t.slice(0, 200)}` });
    }
    const j = await tok.json() as any;
    if (!j.access_token) return res.status(400).json({ error: 'No access_token in xAI response.' });
    const creds = {
      access: j.access_token,
      refresh: j.refresh_token,
      expires: Date.now() + (j.expires_in || 3600) * 1000 - REFRESH_SKEW_MS,
      tokenEndpoint: pending.tokenEndpoint,
    };
    mkdirSync(dirname(TOKEN_PATH), { recursive: true });
    writeFileSync(TOKEN_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
    pending = null;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});
