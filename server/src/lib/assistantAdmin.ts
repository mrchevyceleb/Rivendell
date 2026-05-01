import { ASSISTANT_ADMIN_BASE_URL, ASSISTANT_ADMIN_TOKEN } from '../config.ts';

export class AssistantAdminError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(path: string, status: number, body: string) {
    super(`assistant admin ${path} failed: ${status} ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

export function assistantAdminConfigured(): boolean {
  return Boolean(ASSISTANT_ADMIN_BASE_URL && ASSISTANT_ADMIN_TOKEN);
}

export function assistantAdminUrl(path: string): string {
  const base = ASSISTANT_ADMIN_BASE_URL.replace(/\/$/, '');
  return path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function assistantAdminJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await assistantAdminFetch(path, init);
  const body = await response.text();
  if (!response.ok) {
    throw new AssistantAdminError(path, response.status, body);
  }
  if (!body) return {} as T;
  return JSON.parse(body) as T;
}

export async function assistantAdminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!assistantAdminConfigured()) {
    throw new Error('ASSISTANT_ADMIN_BASE_URL and ASSISTANT_ADMIN_TOKEN are required');
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${ASSISTANT_ADMIN_TOKEN}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(assistantAdminUrl(path), {
    ...init,
    headers,
  });
}
