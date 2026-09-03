import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const xaiOauthRouter = Router();

// xAI SuperGrok subscription OAuth (PKCE). Mirrors the pi-grok extension flow
// so the access token draws on the operator's SuperGrok subscription instead of the
// metered GROK_PERSONAL_API_KEY. One-time browser login; the token refreshes
// itself (refresh logic lives in the chat runner on spawn).
const ISSUER = 'https://auth.x.ai';
// OAuth client identifiers are public metadata, not credentials. Operators can
// override this known CLI client without checking a client secret into Git.
const CLIENT_ID = process.env.XAI_OAUTH_CLIENT_ID || 'b1a00492-073a-47ea-816f-4c329264a828';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const REDIRECT_URI = 'http://127.0.0.1:56121/callback';
const TOKEN_PATH = join(homedir(), '.rivendell', 'xai-oauth.json');
// Guards the read-modify-write around a refresh. The token file is shared with
// a SEPARATE process (assistant-mcp cron), and xAI rotates refresh tokens, so
// two processes refreshing at once can invalidate the whole family and force
// the operator through browser login again. An in-process promise cannot see the
// other process; a lock file can.
const LOCK_PATH = `${TOKEN_PATH}.lock`;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 20_000;
const LOCK_STALE_MS = 60_000;
const LOCK_WAIT_MS = 30_000;

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Pending PKCE state between GET (build URL) and POST (exchange).
let pending: { verifier: string; state: string; tokenEndpoint: string } | null = null;

type XaiCreds = { access: string; refresh?: string; expires?: number; tokenEndpoint?: string };

/** Why the caller can (or can't) have a subscription token right now.
 *  `unconfigured` is the ONLY state that may fall back to the metered API key —
 *  every other failure must surface, never quietly bill the operator per token. */
export type XaiAuth =
  | { mode: 'oauth'; token: string }
  | { mode: 'unconfigured' }
  | { mode: 'error'; reason: string };

type ReadResult = { state: 'ok'; creds: XaiCreds } | { state: 'missing' } | { state: 'invalid' };

function parseCreds(raw: string): XaiCreds | null {
  try {
    const creds = JSON.parse(raw) as XaiCreds;
    return creds && typeof creds.access === 'string' && creds.access ? creds : null;
  } catch { return null; }
}

/** Async read for the per-request hot path — keeps blocking fs off the event
 *  loop that also drives every live chat stream. */
async function readCredsAsync(): Promise<ReadResult> {
  let raw: string;
  try {
    raw = await readFile(TOKEN_PATH, 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'missing' } : { state: 'invalid' };
  }
  const creds = parseCreds(raw);
  return creds ? { state: 'ok', creds } : { state: 'invalid' };
}

function readCredsSync(): XaiCreds | null {
  if (!existsSync(TOKEN_PATH)) return null;
  try { return parseCreds(readFileSync(TOKEN_PATH, 'utf8')); } catch { return null; }
}

/** Decode a JWT's `exp` (ms). Lets us recover a real expiry from legacy or
 *  half-written files whose `expires` field is missing or nonsense. */
function jwtExpiryMs(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch { return null; }
}

/** Effective expiry (ms). An absent/zero/garbage `expires` must NOT read as
 *  "valid forever" — that would stamp a dead token onto every request and never
 *  refresh. Fall back to the JWT's own exp, and treat truly unknown as expired. */
function expiryOf(creds: XaiCreds): number {
  if (typeof creds.expires === 'number' && Number.isFinite(creds.expires) && creds.expires > 0) return creds.expires;
  const exp = jwtExpiryMs(creds.access);
  return exp ? exp - REFRESH_SKEW_MS : 0;
}

/** Replace the token file atomically. writeFileSync truncates in place, which
 *  lets a concurrent reader (assistant-mcp) observe empty or partial JSON. */
function writeCreds(creds: XaiCreds): void {
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  const tmp = `${TOKEN_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  renameSync(tmp, TOKEN_PATH); // same dir -> atomic; readers see old or new, never torn
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hold the cross-process credential lock for the duration of `fn`.
 *  Returns null if the lock could not be taken before LOCK_WAIT_MS. */
async function withCredLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;
  while (Date.now() < deadline) {
    try {
      mkdirSync(dirname(LOCK_PATH), { recursive: true });
      closeSync(openSync(LOCK_PATH, 'wx')); // O_EXCL — fails if any process holds it
      held = true;
      break;
    } catch {
      // Reclaim a lock abandoned by a crashed process.
      try {
        const st = statSync(LOCK_PATH);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) { unlinkSync(LOCK_PATH); continue; }
      } catch { /* vanished between open and stat — just retry */ }
      await sleep(100);
    }
  }
  if (!held) return null;
  try { return await fn(); } finally { try { unlinkSync(LOCK_PATH); } catch {} }
}

// One refresh in flight per process. The proxy calls this on every upstream
// request and the claude CLI fires several in parallel; the lock file stops
// cross-process races, this stops us from queueing on our own lock.
let refreshInFlight: Promise<XaiAuth> | null = null;

async function refreshLocked(): Promise<XaiAuth> {
  const result = await withCredLock(async (): Promise<XaiAuth> => {
    // Re-read under the lock: another process may have refreshed while we waited.
    const read = await readCredsAsync();
    if (read.state === 'missing') return { mode: 'unconfigured' };
    if (read.state === 'invalid') return { mode: 'error', reason: 'token file is unreadable or malformed' };
    const creds = read.creds;
    if (expiryOf(creds) > Date.now()) return { mode: 'oauth', token: creds.access }; // someone beat us to it
    if (!creds.refresh) return { mode: 'error', reason: 'no refresh token stored' };
    const tokenEndpoint = creds.tokenEndpoint || `${ISSUER}/oauth2/token`;
    try {
      const resp = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: creds.refresh }),
        // Without this a hung token endpoint pins refreshInFlight (and every
        // Grok request behind it) until the transport-level timeout.
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        return { mode: 'error', reason: `xAI refused the refresh: ${resp.status} ${body.slice(0, 200)}`.trim() };
      }
      const j = await resp.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!j.access_token) return { mode: 'error', reason: 'refresh response carried no access_token' };
      const next: XaiCreds = {
        access: j.access_token,
        refresh: j.refresh_token || creds.refresh,
        expires: Date.now() + (j.expires_in || 3600) * 1000 - REFRESH_SKEW_MS,
        tokenEndpoint,
      };
      writeCreds(next);
      return { mode: 'oauth', token: next.access };
    } catch (err) {
      return { mode: 'error', reason: `refresh request failed: ${(err as Error).message}` };
    }
  });
  if (!result) return { mode: 'error', reason: 'timed out waiting for the credential lock' };
  if (result.mode === 'error') console.warn(`[xai-oauth] ${result.reason}`);
  return result;
}

/** Resolve the current subscription auth, refreshing if we're inside the expiry
 *  skew. Call it per request — never cache the result across a token lifetime. */
export async function getXaiAuth(): Promise<XaiAuth> {
  const read = await readCredsAsync();
  if (read.state === 'missing') return { mode: 'unconfigured' };
  if (read.state === 'invalid') return { mode: 'error', reason: 'token file is unreadable or malformed' };
  if (expiryOf(read.creds) > Date.now()) return { mode: 'oauth', token: read.creds.access };
  if (!refreshInFlight) {
    refreshInFlight = refreshLocked().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/** Access token, or null if unavailable for any reason. Prefer getXaiAuth()
 *  where the reason matters (null can't tell "never logged in" from "broken"). */
export async function getXaiOauthToken(): Promise<string | null> {
  const auth = await getXaiAuth();
  return auth.mode === 'oauth' ? auth.token : null;
}

/** Synchronous reader for the stored token. MAY BE EXPIRED — only used on the
 *  RIVENDELL_XAI_BASE_URL override path, where requests bypass our proxy and
 *  nothing can re-stamp the header. The normal path seeds the child with the
 *  proxy secret instead, so no expirable material is ever frozen into an env. */
export function getXaiOauthTokenSync(): string | null {
  return readCredsSync()?.access ?? null;
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
<p class="muted">Token stored locally on this server at ~/.rivendell/xai-oauth.json. Never leaves the machine.</p>
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
    writeCreds(creds);
    pending = null;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});
