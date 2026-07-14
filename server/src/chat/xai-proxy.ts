import http from 'node:http';
import https from 'node:https';

// xAI's Anthropic-compatible endpoint (https://api.x.ai/v1/messages) rejects
// `role: "system"` entries inside the `messages` array with a 400
// "Invalid message role." The stock `claude` CLI, however, sends the system
// prompt as BOTH a top-level `system` field (just the billing header) AND a
// `role: "system"` message in `messages` (Anthropic accepts this as a system
// reminder; z.ai does too, which is why the zai engine needs no proxy). xAI
// does not, so a direct ANTHROPIC_BASE_URL=https://api.x.ai spawn 400s on the
// very first turn.
//
// This is a tiny localhost transform proxy that sits between the claude CLI
// and xAI: it folds every `role: "system"` message into the top-level `system`
// field, then forwards the request verbatim to xAI and streams the response
// back unchanged. Auth (Authorization: Bearer <GROK_PERSONAL_API_KEY>) is set
// by claude via ANTHROPIC_AUTH_TOKEN and forwarded as-is; xAI accepts Bearer.
//
// Started once per server process on an ephemeral 127.0.0.1 port and reused by
// every xAI chat session (xaiEnv points ANTHROPIC_BASE_URL at it).

const XAI_UPSTREAM = process.env.RIVENDELL_XAI_UPSTREAM?.trim() || 'https://api.x.ai';

let server: http.Server | null = null;
let port = 0;
let readyPromise: Promise<string> | null = null;

/** Normalize a system content payload (string | content blocks) into text blocks. */
function toSystemBlocks(value: unknown): Array<Record<string, unknown>> {
  if (typeof value === 'string') {
    return value ? [{ type: 'text', text: value }] : [];
  }
  if (Array.isArray(value)) {
    return value.filter((b) => b && typeof b === 'object') as Array<Record<string, unknown>>;
  }
  return [];
}

/** Fold `role: "system"` messages into the top-level `system` field, and
 *  coerce tool input_schema.required to an array. xAI's validator rejects a
 *  missing/null `required` ("/required: null is not of type array"); Anthropic
 *  accepts both. Returns the original string if the body isn't JSON. */
function transformRequest(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body; // not JSON — forward unchanged
  }
  // JSON.parse('null') -> null; JSON.parse('"x"') -> string. Only transform
  // object-shaped requests; anything else forwards unchanged.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return body;
  const obj = parsed as Record<string, unknown>;
  const messages = Array.isArray(obj.messages) ? (obj.messages as Array<Record<string, unknown>>) : null;
  if (messages) {
    const systemBlocks = toSystemBlocks(obj.system);
    const kept: Array<Record<string, unknown>> = [];
    for (const msg of messages) {
      if (msg && msg.role === 'system') {
        for (const block of toSystemBlocks(msg.content)) systemBlocks.push(block);
      } else {
        kept.push(msg);
      }
    }
    obj.messages = kept;
    if (systemBlocks.length > 0) obj.system = systemBlocks;
  }
  if (Array.isArray(obj.tools)) {
    for (const tool of obj.tools as Array<Record<string, unknown>>) {
      const schema = tool?.input_schema as Record<string, unknown> | undefined;
      if (schema && !Array.isArray(schema.required)) schema.required = [];
    }
  }
  return JSON.stringify(obj);
}

function startServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    // Cap request bodies so a runaway/malformed local caller can't exhaust
    // memory. Claude's largest payloads (big system prompt + tool defs) are
    // well under 10MB; abort anything bigger.
    const MAX_BODY_BYTES = 10 * 1024 * 1024;
    const srv = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      let upstream: http.ClientRequest | null = null;
      // If the claude CLI disconnects mid-stream (stop/interrupt/shutdown), tear
      // down the upstream too so xAI stops generating (and billing) into a void.
      // Guarded by res.writableEnded so a NORMAL completion (response fully sent)
      // never destroys a finished upstream — req/res 'close' fire on success too.
      const cleanup = () => {
        if (aborted || res.writableEnded) return;
        aborted = true;
        try { upstream?.destroy(); } catch {}
      };
      req.on('data', (c: Buffer) => {
        if (aborted) return;
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          aborted = true;
          try { res.writeHead(413, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 413, message: 'xAI proxy: request body too large' } })); } catch {}
          try { upstream?.destroy(); } catch {}
          try { req.destroy(); } catch {}
          return;
        }
        chunks.push(c);
      });
      req.on('error', cleanup);
      req.on('aborted', cleanup);
      res.on('close', cleanup);
      req.on('end', () => {
        if (aborted) return;
        let outBody: string;
        try {
          outBody = transformRequest(Buffer.concat(chunks).toString('utf8'));
        } catch (err) {
          console.warn(`[xai-proxy] transform error: ${(err as Error).message}`);
          try { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 400, message: 'xAI proxy: failed to parse request' } })); } catch {}
          return;
        }
        const headers: Record<string, string> = {
          'content-type': req.headers['content-type'] || 'application/json',
          'content-length': Buffer.byteLength(outBody).toString(),
        };
        // Forward auth + anthropic version headers claude set; drop hop-by-hop.
        if (req.headers['authorization']) headers['authorization'] = String(req.headers['authorization']);
        if (req.headers['x-api-key']) headers['x-api-key'] = String(req.headers['x-api-key']);
        if (req.headers['anthropic-version']) headers['anthropic-version'] = String(req.headers['anthropic-version']);
        if (req.headers['anthropic-beta']) headers['anthropic-beta'] = String(req.headers['anthropic-beta']);

        upstream = https.request(
          XAI_UPSTREAM + (req.url || ''),
          { method: req.method, headers },
          (up) => {
            try { res.writeHead(up.statusCode ?? 200, up.headers); } catch { cleanup(); return; }
            up.on('error', () => cleanup());
            up.pipe(res);
          },
        );
        upstream.on('error', (err) => {
          console.warn(`[xai-proxy] upstream error: ${(err as Error).message}`);
          // Headers may already be sent (mid-stream) — only write a 502 body if
          // the response is still writable and unset.
          if (!res.headersSent) {
            try { res.writeHead(502, { 'content-type': 'application/json' }); } catch {}
            try { res.end(JSON.stringify({ error: { code: 502, message: 'xAI proxy upstream error' } })); } catch {}
          } else {
            try { res.destroy(); } catch {}
          }
        });
        upstream.on('aborted', () => cleanup());
        try { upstream.write(outBody); upstream.end(); } catch { cleanup(); }
      });
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      server = srv;
      console.log(`[xai-proxy] listening on 127.0.0.1:${port} -> ${XAI_UPSTREAM}`);
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/** Ensure the proxy is up and return its base URL. Safe to call repeatedly.
 *  A failed startup resets so the next call retries rather than latching a
 *  permanent rejection. */
export function ensureXaiProxy(): Promise<string> {
  if (server && port) return Promise.resolve(`http://127.0.0.1:${port}`);
  if (!readyPromise) {
    readyPromise = startServer().catch((err) => {
      readyPromise = null; // allow retry on the next call
      throw err;
    });
  }
  return readyPromise;
}

/** Synchronous base URL for xaiEnv(). Only valid after ensureXaiProxy() resolved. */
export function xaiProxyBaseUrl(): string {
  return port ? `http://127.0.0.1:${port}` : '';
}

export function shutdownXaiProxy(): void {
  if (server) {
    try { server.close(); } catch {}
    server = null;
    port = 0;
    readyPromise = null;
  }
}
