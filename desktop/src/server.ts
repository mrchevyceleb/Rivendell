// Server address handling shared by the connect flow and the menu.
import { net } from 'electron';

export interface ProbeResult {
  ok: boolean;
  error?: string;
  brand?: string;
  version?: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Turn what a person types into an origin. Bare hosts get HTTPS, the only
 *  boundary TARDIS trusts off the box; loopback alone defaults to plain HTTP.
 *  Paths and query strings are dropped: the app is always mounted at the
 *  origin root. */
export function normalizeServerUrl(raw: string): string | null {
  let input = raw.trim();
  if (!input) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    const host = input.split('/')[0].split(':')[0].toLowerCase();
    input = `${LOOPBACK.has(host) ? 'http' : 'https'}://${input}`;
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  return url.origin;
}

export function sameOrigin(url: string, origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** Ask /api/health whether there is a TARDIS at this origin. */
export async function probeServer(origin: string, timeoutMs = 6000): Promise<ProbeResult> {
  try {
    const response = await net.fetch(`${origin}/api/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, error: `The server at ${origin} answered ${response.status}.` };
    const body = (await response.json()) as { ok?: unknown; app?: unknown; brand?: unknown; version?: unknown };
    if (body.ok !== true || body.app !== 'rivendell') {
      return { ok: false, error: 'That address answers, but it is not a TARDIS.' };
    }
    return {
      ok: true,
      brand: typeof body.brand === 'string' ? body.brand : undefined,
      version: typeof body.version === 'string' ? body.version : undefined,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Couldn't reach ${origin} (${reason}).` };
  }
}
