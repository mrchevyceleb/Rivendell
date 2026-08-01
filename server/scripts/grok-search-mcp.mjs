#!/usr/bin/env node

/**
 * Grok scoped web-search MCP proxy.
 *
 * A fork of the assistant-mcp stdio<->HTTP proxy (proxy/mcp-proxy.js) that
 * exposes ONLY a read-only search surface from the Railway assistant-mcp server.
 *
 * Why this exists:
 *   Grok (xAI) in Rivendell runs through the `claude` CLI pointed at xAI's
 *   Anthropic-compatible /v1/messages endpoint. Claude Code's built-in WebSearch
 *   is an Anthropic SERVER tool (web_search_20250305) whose wire shape carries no
 *   `description`, and xAI's strict tool deserializer 422s any tool without one
 *   ("tools[0]: missing field `description`") — so every Grok WebSearch call
 *   fails. xAI's Anthropic endpoint has no server-side search of its own (it
 *   silently ignores `search_parameters`), so the only way to give Grok working
 *   web search is a CLIENT-side tool, i.e. MCP.
 *
 *   But the full assistant-mcp is 65 tools including gmail_send, calendar
 *   mutation, task delete, cron, cloudflare, supabase, etc. Under
 *   --dangerously-skip-permissions Grok would be able to fire those with no
 *   prompt. We do NOT want that by default, so this proxy is default-deny: it
 *   filters tools/list to the allow-list and refuses tools/call for anything
 *   outside it. Grok gets search and nothing else.
 *
 * Everything else (session re-init on expiry, retries with backoff, SSE parsing,
 * request timeouts, notification handling, crash safety nets) is inherited
 * verbatim from proxy/mcp-proxy.js.
 */

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'https://matt-assistant-production.up.railway.app/mcp';
const HEALTH_URL = MCP_SERVER_URL.replace(/\/mcp$/, '/health');
const DEBUG = process.env.DEBUG === 'true';

// The ONLY tools Grok may see or call. Read-only search surface. Override with
// GROK_SEARCH_TOOLS="a,b,c". Deliberately excludes `browser` (Browserbase
// automation) and every write/send/delete tool on the assistant-mcp server.
const ALLOWED_TOOLS = new Set(
  (process.env.GROK_SEARCH_TOOLS || 'web_search,deep_research,quick_search')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// Configurable timeouts (ms)
const REQUEST_TIMEOUT = parseInt(process.env.MCP_REQUEST_TIMEOUT || '90000', 10); // 90s default
const MAX_RETRIES = parseInt(process.env.MCP_MAX_RETRIES || '3', 10);
const RETRY_BASE_DELAY = 1000; // 1s, doubles each retry

function debug(...args) {
  if (DEBUG) {
    console.error('[grok-search:debug]', ...args);
  }
}

function logError(...args) {
  console.error('[grok-search:error]', ...args);
}

function logInfo(...args) {
  console.error('[grok-search:info]', ...args);
}

// Buffer for accumulating stdin data
let inputBuffer = '';

// Session ID from server (captured from initialize response)
let sessionId = null;

// Track whether we've successfully initialized
let isInitialized = false;

// Store the protocol version and client info for re-initialization
let lastInitializeParams = null;

// Queue for sequential message processing
const messageQueue = [];
let isProcessing = false;

// Track consecutive failures for backoff
let consecutiveFailures = 0;

// Read from stdin
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;

  // Process complete JSON-RPC messages (newline-delimited)
  const lines = inputBuffer.split('\n');
  inputBuffer = lines.pop(); // Keep incomplete line in buffer

  for (const line of lines) {
    if (line.trim()) {
      queueMessage(line.trim());
    }
  }
});

process.stdin.on('end', () => {
  // Process any remaining data
  if (inputBuffer.trim()) {
    queueMessage(inputBuffer.trim());
  }
});

function queueMessage(message) {
  messageQueue.push(message);
  processQueue();
}

async function processQueue() {
  if (isProcessing || messageQueue.length === 0) return;

  isProcessing = true;

  while (messageQueue.length > 0) {
    const message = messageQueue.shift();
    await processMessage(message);
  }

  isProcessing = false;
}

/**
 * Check if an error is a transient network issue worth retrying
 */
function isTransientError(error) {
  if (!error) return false;
  const msg = error.message || '';
  return (
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('EAI_AGAIN') ||
    msg.includes('UND_ERR_SOCKET') ||
    msg.includes('network') ||
    msg.includes('abort') ||
    msg.includes('socket hang up') ||
    msg.includes('EPIPE')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a request to Railway with timeout and retry logic
 */
async function sendToServer(message, { retries = MAX_RETRIES, timeout = REQUEST_TIMEOUT } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
        debug(`Retry ${attempt}/${retries} after ${delay}ms...`);
        await sleep(delay);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };

      if (sessionId) {
        headers['mcp-session-id'] = sessionId;
      }

      const response = await fetch(MCP_SERVER_URL, {
        method: 'POST',
        headers,
        body: message,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const newSessionId = response.headers.get('mcp-session-id');
      if (newSessionId) {
        sessionId = newSessionId;
        debug('Session ID:', sessionId);
      }

      consecutiveFailures = 0;

      return response;
    } catch (error) {
      lastError = error;

      if (error.name === 'AbortError') {
        lastError = new Error(`Request timed out after ${timeout}ms`);
      }

      if (attempt < retries && (isTransientError(error) || error.name === 'AbortError')) {
        logError(`Attempt ${attempt + 1} failed (${error.message}), will retry...`);
        continue;
      }

      break;
    }
  }

  consecutiveFailures++;
  throw lastError;
}

/**
 * Perform a fresh initialize handshake with the server
 */
async function reinitialize() {
  debug('Re-initializing session...');

  sessionId = null;
  isInitialized = false;

  const initParams = lastInitializeParams || {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'grok-search-mcp', version: '1.0.0' },
  };

  const initRequest = JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialize',
    params: initParams,
    id: `reinit-${consecutiveFailures}-${messageQueue.length}`,
  });

  const response = await sendToServer(initRequest, { retries: 2 });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Re-initialize failed: ${response.status} - ${errorText}`);
  }

  const responseText = await response.text();
  debug('Re-initialize response:', responseText.substring(0, 200));

  const result = parseSSEResponse(responseText);
  try {
    const parsed = JSON.parse(result);
    if (parsed.result && parsed.result.serverInfo) {
      isInitialized = true;
      debug('Re-initialization successful. Server:', parsed.result.serverInfo.name);

      const notifyRequest = JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });
      await sendToServer(notifyRequest, { retries: 1 });
      debug('Sent initialized notification');

      return true;
    }
  } catch {}

  throw new Error('Re-initialize returned unexpected response');
}

/**
 * Check if an error response indicates a stale/expired session
 */
function isSessionExpiredError(statusCode, responseText) {
  if (statusCode === 400 || statusCode === 404 || statusCode === 406) {
    const lower = responseText.toLowerCase();
    return lower.includes('not initialized') || lower.includes('session') || lower.includes('not acceptable');
  }
  return false;
}

/**
 * Check if a JSON-RPC message is a notification (no id = no response expected)
 */
function isNotification(request) {
  return request.id === undefined || request.id === null;
}

/**
 * Filter a tools/list JSON-RPC response down to the allow-list. Falls back to
 * the original text (unfiltered) only if it can't be parsed — never fails open
 * to a broken response.
 */
function filterToolsList(resultText) {
  try {
    const parsed = JSON.parse(resultText);
    const tools = parsed?.result?.tools;
    if (Array.isArray(tools)) {
      const kept = tools.filter((t) => t && ALLOWED_TOOLS.has(t.name));
      parsed.result.tools = kept;
      debug(`tools/list filtered ${tools.length} -> ${kept.length} (${kept.map((t) => t.name).join(', ')})`);
      return JSON.stringify(parsed);
    }
  } catch (error) {
    logError('tools/list filter failed, passing through:', error.message);
  }
  return resultText;
}

async function processMessage(message) {
  let request;
  try {
    request = JSON.parse(message);
  } catch (parseError) {
    logError('Failed to parse incoming message:', parseError.message);
    return;
  }

  const isNotif = isNotification(request);
  debug('Processing:', request.method, isNotif ? '(notification)' : `id=${request.id}`, 'sessionId:', sessionId);

  // Default-deny gate: refuse any tools/call outside the allow-list without ever
  // touching Railway. tools/list already hides everything else, but this makes
  // sure a stray or model-hallucinated call can never reach a write tool.
  if (request.method === 'tools/call' && !ALLOWED_TOOLS.has(request.params?.name)) {
    logInfo(`Blocked out-of-scope tool call: ${request.params?.name}`);
    if (!isNotif) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [
              {
                type: 'text',
                text: `Tool "${request.params?.name}" is not available here. This companion has a search-only toolset (${[...ALLOWED_TOOLS].join(', ')}).`,
              },
            ],
            isError: true,
          },
        }) + '\n',
      );
    }
    return;
  }

  try {
    if (request.method === 'initialize') {
      lastInitializeParams = request.params;
    }

    let response = await sendToServer(message);
    let responseBody = await response.text();

    if (!response.ok && isSessionExpiredError(response.status, responseBody)) {
      debug('Session expired or invalid. Attempting re-initialization...');

      try {
        if (request.method === 'initialize') {
          sessionId = null;
          isInitialized = false;
          response = await sendToServer(message);
          responseBody = await response.text();
        } else {
          await reinitialize();
          response = await sendToServer(message);
          responseBody = await response.text();
        }

        if (!response.ok) {
          if (!isNotif) {
            sendError(request.id, -32603, `HTTP error after re-init: ${response.status} - ${responseBody}`);
          }
          return;
        }
      } catch (reinitError) {
        logError('Re-initialization failed:', reinitError.message);
        if (!isNotif) {
          sendError(request.id, -32603, `Session expired and re-init failed: ${reinitError.message}`);
        }
        return;
      }
    } else if (!response.ok) {
      logError(`HTTP ${response.status} for ${request.method}:`, responseBody.substring(0, 200));
      if (!isNotif) {
        sendError(request.id, -32603, `HTTP error: ${response.status} - ${responseBody}`);
      }
      return;
    }

    if (request.method === 'initialize') {
      isInitialized = true;
    }

    debug('Response text:', responseBody.substring(0, 200));

    let result = parseSSEResponse(responseBody);

    // The only place this proxy diverges from the stock bridge: strip every tool
    // outside the allow-list from tools/list so Grok never even sees them.
    if (request.method === 'tools/list' && result) {
      result = filterToolsList(result);
    }

    if (!isNotif && result) {
      process.stdout.write(result + '\n');
    }
  } catch (error) {
    logError(`Error processing ${request.method}:`, error.message);
    if (!isNotif) {
      sendError(request.id, -32603, `Proxy error: ${error.message}`);
    }
  }
}

/**
 * Parse SSE-formatted response to extract JSON data.
 * SSE format: "event: message\ndata: {...}\n\n"
 */
function parseSSEResponse(text) {
  if (!text || !text.trim()) return text;

  try {
    JSON.parse(text);
    return text;
  } catch {}

  const lines = text.split('\n');
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6));
    }
  }

  if (dataLines.length > 0) {
    return dataLines[dataLines.length - 1];
  }

  return text;
}

function sendError(id, code, message) {
  if (id === undefined || id === null) return;
  const errorResponse = {
    jsonrpc: '2.0',
    id: id,
    error: {
      code: code,
      message: message,
    },
  };
  process.stdout.write(JSON.stringify(errorResponse) + '\n');
}

/**
 * Startup health check - verify Railway server is reachable
 */
async function startupHealthCheck() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      logInfo(
        `Server healthy: ${data.tools?.total || '?'} tools upstream, exposing ${ALLOWED_TOOLS.size} (${[...ALLOWED_TOOLS].join(', ')})`,
      );
    } else {
      logError(`Server health check returned ${response.status}`);
    }
  } catch (error) {
    logError(`Server health check failed: ${error.message} (will retry on first request)`);
  }
}

startupHealthCheck();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

process.on('uncaughtException', (error) => {
  logError('Uncaught exception:', error.message);
});

process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection:', reason);
});
