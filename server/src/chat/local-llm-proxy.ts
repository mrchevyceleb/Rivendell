import http from 'node:http';
import https from 'node:https';

// LM Studio converts OpenAI tool JSON schemas into a sampling grammar. The
// full Rivendell tool surface contains validation-only bounds such as
// maxLength: 4000 and large numeric maxima; llama.cpp expands those into GBNF
// repetitions and rejects the entire request before inference. The MCP server
// still validates every real tool call, so strip only grammar-hostile schema
// constraints on the local transport while preserving tool names, shapes,
// required fields, enums, and descriptions.
const GRAMMAR_HOSTILE_KEYS = new Set([
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);

const SCHEMA_MAP_KEYS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
]);
const SCHEMA_VALUE_KEYS = new Set([
  'items',
  'additionalProperties',
  'contains',
  'propertyNames',
  'if',
  'then',
  'else',
  'not',
]);
const SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

function stripSchemaConstraints(schema: unknown): number {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 0;
  const node = schema as Record<string, unknown>;
  let removed = 0;
  for (const key of GRAMMAR_HOSTILE_KEYS) {
    if (!(key in node)) continue;
    delete node[key];
    removed += 1;
  }
  for (const key of SCHEMA_MAP_KEYS) {
    const map = node[key];
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    // Keys in a `properties`/definitions map are PARAMETER NAMES, not schema
    // keywords. Recurse into each value without ever deleting those names.
    for (const child of Object.values(map as Record<string, unknown>)) {
      removed += stripSchemaConstraints(child);
    }
  }
  for (const key of SCHEMA_VALUE_KEYS) {
    removed += stripSchemaConstraints(node[key]);
  }
  for (const key of SCHEMA_ARRAY_KEYS) {
    const variants = node[key];
    if (!Array.isArray(variants)) continue;
    for (const child of variants) removed += stripSchemaConstraints(child);
  }
  return removed;
}

function stripGrammarHostileConstraints(tools: unknown[]): number {
  let removed = 0;
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const fn = (tool as Record<string, unknown>).function;
    if (!fn || typeof fn !== 'object' || Array.isArray(fn)) continue;
    removed += stripSchemaConstraints((fn as Record<string, unknown>).parameters);
  }
  return removed;
}

export function transformLocalLlmRequest(body: string): { body: string; removed: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { body, removed: 0 };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { body, removed: 0 };
  }
  const tools = (parsed as Record<string, unknown>).tools;
  if (!Array.isArray(tools) || tools.length === 0) return { body, removed: 0 };
  const removed = stripGrammarHostileConstraints(tools);
  return { body: removed > 0 ? JSON.stringify(parsed) : body, removed };
}

let server: http.Server | null = null;
let ready: Promise<string> | null = null;
let upstreamBase = '';

export function ensureLocalLlmProxy(baseUrl: string): Promise<string> {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (ready && upstreamBase === normalized) return ready;
  if (server) shutdownLocalLlmProxy();
  upstreamBase = normalized;
  const upstream = new URL(normalized);
  const transport = upstream.protocol === 'https:' ? https : http;
  const basePath = upstream.pathname.replace(/\/+$/, '');

  ready = new Promise((resolve, reject) => {
    const proxy = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let oversized = false;
      let finished = false;
      let upstreamRequest: http.ClientRequest | null = null;
      const fail = (status: number, message: string) => {
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'local_proxy_error', message } }));
      };
      const abort = () => {
        if (finished || res.writableEnded) return;
        try { upstreamRequest?.destroy(); } catch {}
      };
      req.on('data', (chunk: Buffer) => {
        if (oversized) return; // keep draining without retaining more bytes
        size += chunk.length;
        if (size > 32 * 1024 * 1024) {
          oversized = true;
          chunks.length = 0;
          fail(413, 'local model request body exceeded 32MB');
          return;
        }
        chunks.push(chunk);
      });
      req.on('aborted', abort);
      req.on('error', abort);
      res.on('close', abort);
      req.on('end', () => {
        if (oversized || res.writableEnded) return;
        const input = Buffer.concat(chunks).toString('utf8');
        const transformed = input ? transformLocalLlmRequest(input) : { body: '', removed: 0 };
        if (transformed.removed > 0) {
          console.log(`[local-llm-proxy] removed ${transformed.removed} grammar-only schema constraint(s)`);
        }
        const headers: Record<string, string | string[]> = {};
        const connectionNamedHeaders = new Set(
          String(req.headers.connection ?? '')
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean),
        );
        const hopByHopHeaders = new Set([
          'host', 'content-length', 'connection', 'transfer-encoding',
          'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te',
          'trailer', 'upgrade',
        ]);
        for (const [key, value] of Object.entries(req.headers)) {
          if (value === undefined || hopByHopHeaders.has(key) || connectionNamedHeaders.has(key)) continue;
          headers[key] = value;
        }
        if (transformed.body) headers['content-length'] = String(Buffer.byteLength(transformed.body));
        const requestPath = req.url || '/';
        const targetPath = !basePath || requestPath === basePath || requestPath.startsWith(`${basePath}/`)
          ? requestPath
          : `${basePath}${requestPath.startsWith('/') ? '' : '/'}${requestPath}`;
        upstreamRequest = transport.request({
          protocol: upstream.protocol,
          hostname: upstream.hostname,
          port: upstream.port,
          method: req.method,
          path: targetPath,
          headers,
        }, (upstreamResponse) => {
          res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.on('error', (error) => {
            if (!res.writableEnded) res.destroy(error);
          });
          upstreamResponse.on('end', () => { finished = true; });
          upstreamResponse.pipe(res);
        });
        upstreamRequest.on('error', (error) => {
          console.warn(`[local-llm-proxy] upstream request failed: ${error.message}`);
          fail(502, 'local model server request failed');
        });
        if (transformed.body) upstreamRequest.write(transformed.body);
        upstreamRequest.end();
      });
    });
    proxy.once('error', (error) => {
      if (server === proxy) server = null;
      ready = null;
      reject(error);
    });
    proxy.listen(0, '127.0.0.1', () => {
      server = proxy;
      const address = proxy.address();
      if (!address || typeof address === 'string') {
        reject(new Error('local LLM proxy did not receive a TCP port'));
        return;
      }
      const url = `http://127.0.0.1:${address.port}${basePath}`;
      console.log(`[local-llm-proxy] ${url} -> ${upstream.origin}${basePath}`);
      resolve(url);
    });
  });
  return ready;
}

export function shutdownLocalLlmProxy(): void {
  const active = server;
  server = null;
  ready = null;
  upstreamBase = '';
  if (!active) return;
  try { active.closeAllConnections(); } catch {}
  try { active.close(); } catch {}
}
